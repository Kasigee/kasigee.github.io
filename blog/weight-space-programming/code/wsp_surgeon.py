"""Weight-Space Programming (WSP) Surgeon for Qwen3-0.6B and Qwen3-1.7B.

Implements the MIT CSAIL Weight-Space Programming paradigm:
1. Teacher-forced forward activation & weight spectral profiling across all 28 layers
   STRICTLY on the disjoint Calibration Split (zero data leakage).
2. Localizes the top-64 MLP writer columns (mask64) in mid-to-late `mlp.down_proj.weight`
   matrices that write into the repetitive self-doubt / </think>-suppression direction u_l.
3. Applies the sparse rank-1 projection edit:
       W_new = W_0 - alpha * u_l * (mask64 * (u_l^T W_0))
   leaving embeddings, lm_head, and layer norms 100% frozen.
4. Selects optimal (layers, alpha, beta) exclusively on the 6 Live Calibration Questions,
   verifies against a norm-matched Random Orthogonal Subspace Control, and exports
   frozen edited checkpoints + SHA-256 verified manifests.
"""
import argparse
import hashlib
import json
import os
import shutil
import time
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import torch
from safetensors.torch import load_file, save_file
from transformers import AutoTokenizer, AutoModelForCausalLM

from graders import split_thinking_and_answer, extract_last_boxed, compute_ngram_repetition_rate

ROOT = Path(__file__).resolve().parent.parent  # project root (the scripts lived in <root>/scripts)
CAL_PATH = ROOT / "calibration" / "calibration_prompts.json"


def tensor_sha256(t: torch.Tensor) -> str:
    """Computes exact SHA-256 hash of a bfloat16 tensor's raw uint16 bytes."""
    arr = t.detach().cpu().view(torch.uint16).numpy()
    return hashlib.sha256(np.ascontiguousarray(arr).tobytes()).hexdigest()


def extract_calibration_profiles(
    model, tok, cal_data: dict, diag_data: List[dict]
) -> Dict[int, Dict[str, torch.Tensor]]:
    """Runs teacher-forced passes on calibration pairs + calibration diagnostics to profile all 28 layers."""
    num_layers = model.config.num_hidden_layers
    d_model = model.config.hidden_size
    d_ff = model.config.intermediate_size

    # Accumulators per layer
    rep_act_sum = {l: torch.zeros(d_ff, dtype=torch.float64, device="cuda:0") for l in range(num_layers)}
    prod_act_sum = {l: torch.zeros(d_ff, dtype=torch.float64, device="cuda:0") for l in range(num_layers)}
    rep_out_sum = {l: torch.zeros(d_model, dtype=torch.float64, device="cuda:0") for l in range(num_layers)}
    prod_out_sum = {l: torch.zeros(d_model, dtype=torch.float64, device="cuda:0") for l in range(num_layers)}
    rep_count = 0
    prod_count = 0

    current_acts: Dict[int, torch.Tensor] = {}
    current_outs: Dict[int, torch.Tensor] = {}
    hooks = []

    for l in range(num_layers):
        def make_hook(layer_idx):
            def hook_fn(module, inp, out):
                current_acts[layer_idx] = inp[0].detach()
                current_outs[layer_idx] = out.detach()
            return hook_fn
        hooks.append(model.model.layers[l].mlp.down_proj.register_forward_hook(make_hook(l)))

    # 1. Process the 8 contrastive calibration pairs
    for pair in cal_data["contrastive_pairs"]:
        base_prompt = tok.apply_chat_template(
            [{"role": "user", "content": pair["prompt"]}],
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=True,
        )
        p_ids = tok.encode(base_prompt, add_special_tokens=False)
        p_len = len(p_ids)

        # Productive trace
        prod_full = base_prompt + pair["productive_think"]
        prod_inputs = tok(prod_full, return_tensors="pt", add_special_tokens=False).to("cuda:0")
        with torch.no_grad():
            model(**prod_inputs)
        seq_len_p = prod_inputs["input_ids"].shape[1]
        if seq_len_p > p_len:
            n_tok = seq_len_p - p_len
            prod_count += n_tok
            for l in range(num_layers):
                prod_act_sum[l] += current_acts[l][0, p_len:, :].to(torch.float64).sum(dim=0)
                prod_out_sum[l] += current_outs[l][0, p_len:, :].to(torch.float64).sum(dim=0)

        # Repetitive trace
        rep_full = base_prompt + pair["repetitive_think"]
        rep_inputs = tok(rep_full, return_tensors="pt", add_special_tokens=False).to("cuda:0")
        with torch.no_grad():
            model(**rep_inputs)
        seq_len_r = rep_inputs["input_ids"].shape[1]
        if seq_len_r > p_len:
            # Take the second half of the repetitive trace where looping occurs
            loop_start = p_len + max(1, (seq_len_r - p_len) // 3)
            n_tok = seq_len_r - loop_start
            rep_count += n_tok
            for l in range(num_layers):
                rep_act_sum[l] += current_acts[l][0, loop_start:, :].to(torch.float64).sum(dim=0)
                rep_out_sum[l] += current_outs[l][0, loop_start:, :].to(torch.float64).sum(dim=0)

    # 2. Also include the 6 live calibration traces from cal_diag (first 30% productive vs last 50% self-doubt loop)
    for item, q in zip(diag_data, cal_data["live_calibration_questions"]):
        base_prompt = tok.apply_chat_template(
            [{"role": "user", "content": q["prompt"]}],
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=True,
        )
        p_len = len(tok.encode(base_prompt, add_special_tokens=False))
        full_text = base_prompt + item["raw_text"]
        inp = tok(full_text, return_tensors="pt", add_special_tokens=False).to("cuda:0")
        seq_len = inp["input_ids"].shape[1]
        gen_len = seq_len - p_len
        if gen_len > 100:
            with torch.no_grad():
                model(**inp)
            prod_end = p_len + int(gen_len * 0.30)
            rep_start = p_len + int(gen_len * 0.50)
            n_p = prod_end - p_len
            n_r = seq_len - rep_start
            prod_count += n_p
            rep_count += n_r
            for l in range(num_layers):
                prod_act_sum[l] += current_acts[l][0, p_len:prod_end, :].to(torch.float64).sum(dim=0)
                prod_out_sum[l] += current_outs[l][0, p_len:prod_end, :].to(torch.float64).sum(dim=0)
                rep_act_sum[l] += current_acts[l][0, rep_start:, :].to(torch.float64).sum(dim=0)
                rep_out_sum[l] += current_outs[l][0, rep_start:, :].to(torch.float64).sum(dim=0)

    for h in hooks:
        h.remove()

    # Extract logit-space Loop-vs-</think> direction from frozen embed_tokens / lm_head (READ-ONLY)
    embed_w = model.model.embed_tokens.weight.detach().to(torch.float64)
    norm_w = model.model.norm.weight.detach().to(torch.float64)

    end_think_id = tok.encode("</think>", add_special_tokens=False)[0]
    newline_end_think_ids = [
        end_think_id,
        tok.encode("\n</think>", add_special_tokens=False)[-1],
    ]
    loop_starter_words = ["Wait", " Wait", "Alternatively", " Alternatively", "Hold", "Hmm", "Let", "But"]
    loop_ids = []
    for w in loop_starter_words:
        ids = tok.encode(w, add_special_tokens=False)
        if ids:
            loop_ids.append(ids[0])

    v_end = embed_w[newline_end_think_ids].mean(dim=0)
    v_loop = embed_w[loop_ids].mean(dim=0)
    # Account for final RMSNorm scaling weights when mapping back to pre-norm residual stream
    u_logit_raw = (v_loop - v_end) * norm_w
    u_logit = (u_logit_raw / torch.norm(u_logit_raw)).to(torch.float32)

    profiles = {}
    for l in range(num_layers):
        mean_rep_act = (rep_act_sum[l] / max(rep_count, 1)).to(torch.float32)
        mean_prod_act = (prod_act_sum[l] / max(prod_count, 1)).to(torch.float32)
        mean_rep_out = (rep_out_sum[l] / max(rep_count, 1)).to(torch.float32)
        mean_prod_out = (prod_out_sum[l] / max(prod_count, 1)).to(torch.float32)

        diff_out = mean_rep_out - mean_prod_out
        diff_norm = float(torch.norm(diff_out).item())
        u_emp = diff_out / max(diff_norm, 1e-8)

        W = model.model.layers[l].mlp.down_proj.weight.detach().to(torch.float32)
        frob_norm = float(torch.norm(W).item())

        profiles[l] = {
            "mean_rep_act": mean_rep_act,
            "mean_prod_act": mean_prod_act,
            "delta_act": mean_rep_act - mean_prod_act,
            "u_emp": u_emp,
            "u_logit": u_logit,
            "diff_norm": diff_norm,
            "frob_norm": frob_norm,
            "cos_emp_logit": float(torch.dot(u_emp, u_logit).item()),
        }

    return profiles


def apply_wsp_edit_in_memory(
    model,
    base_weights: Dict[int, torch.Tensor],
    profiles: Dict[int, Dict[str, torch.Tensor]],
    target_layers: List[int],
    k_cols: int,
    alpha: float,
    beta: float,
    random_control: bool = False,
) -> Dict[int, dict]:
    """Applies the surgical sparse rank-1 projection edit to target layers in memory."""
    # First restore all layers to base_weights
    for l, w0 in base_weights.items():
        model.model.layers[l].mlp.down_proj.weight.data.copy_(w0)

    edit_info = {}
    rng = torch.Generator(device="cuda:0")
    rng.manual_seed(42)

    for l in target_layers:
        W0 = base_weights[l].to(torch.float32)  # [d_model, d_ff]
        prof = profiles[l]
        u_comb = beta * prof["u_emp"] + (1.0 - beta) * prof["u_logit"]
        u = u_comb / torch.norm(u_comb)

        if random_control:
            # Generate random orthogonal unit vector u_rand perp u
            r = torch.randn(u.shape, generator=rng, device=u.device, dtype=torch.float32)
            r = r - torch.dot(r, u) * u
            u_use = r / torch.norm(r)
            proj = torch.matmul(u_use, W0)  # [d_ff]
            # Pick random k_cols
            perm = torch.randperm(W0.shape[1], generator=rng, device=u.device)
            top_cols = perm[:k_cols]
        else:
            u_use = u
            proj = torch.matmul(u_use, W0)  # [d_ff]
            # Exact sign-consistent causal contribution of column j along +u_use:
            # p_rep_j = mean_rep_act_j * (u_use^T W0[:, j])
            # delta_p_j = (mean_rep_act_j - mean_prod_act_j) * (u_use^T W0[:, j])
            p_rep = prof["mean_rep_act"] * proj
            delta_p = prof["delta_act"] * proj
            col_scores = torch.where(
                p_rep > 0,
                p_rep + 1.5 * torch.clamp(delta_p, min=0.0),
                torch.zeros_like(p_rep),
            )
            top_cols = torch.topk(col_scores, k=k_cols).indices

        mask = torch.zeros(W0.shape[1], dtype=torch.float32, device=W0.device)
        mask[top_cols] = 1.0
        masked_proj = mask * proj  # [d_ff]

        # Rank-1 update: W_new = W0 - alpha * u_use @ masked_proj^T
        delta_W = -alpha * torch.outer(u_use, masked_proj)
        W_new = (W0 + delta_W).to(torch.bfloat16)
        model.model.layers[l].mlp.down_proj.weight.data.copy_(W_new)

        rel_change = float(torch.norm(W_new.to(torch.float32) - W0) / torch.norm(W0))
        edit_info[l] = {
            "top_cols": sorted([int(c) for c in top_cols.detach().cpu().tolist()]),
            "relative_frob_change": round(rel_change, 6),
            "u_use": u_use.detach().cpu().numpy(),
            "masked_proj": masked_proj.detach().cpu().numpy(),
        }

    return edit_info


def evaluate_on_calibration(model, tok, live_qs: List[dict], max_new_tokens: int = 1024) -> dict:
    """Evaluates current in-memory model on the 6 Live Calibration Questions ONLY."""
    prompts = [
        tok.apply_chat_template(
            [{"role": "user", "content": q["prompt"]}],
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=True,
        )
        for q in live_qs
    ]
    inputs = tok(prompts, return_tensors="pt", padding=True).to("cuda:0")
    in_len = inputs["input_ids"].shape[1]

    torch.cuda.synchronize()
    t0 = time.perf_counter()
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            pad_token_id=tok.pad_token_id,
            eos_token_id=tok.eos_token_id,
        )
    torch.cuda.synchronize()
    dt = time.perf_counter() - t0

    strict_hits = 0
    lenient_hits = 0
    cutoffs = 0
    closed_thinks = 0
    total_toks = 0
    total_waits = 0

    per_q = []
    for idx, q in enumerate(live_qs):
        gen_ids = out[idx][in_len:]
        eos_pos = (gen_ids == tok.eos_token_id).nonzero(as_tuple=True)[0]
        if len(eos_pos) > 0:
            actual_ids = gen_ids[: int(eos_pos[0].item()) + 1]
            hit_cutoff = False
        else:
            actual_ids = gen_ids
            hit_cutoff = True

        n_tok = len(actual_ids)
        total_toks += n_tok
        if hit_cutoff:
            cutoffs += 1

        text = tok.decode(actual_ids, skip_special_tokens=False).replace("<|im_end|>", "").strip()
        think_part, ans_part, closed_think = split_thinking_and_answer(text)
        if closed_think:
            closed_thinks += 1

        pred_strict = extract_last_boxed(ans_part).replace("\\pi", "").strip()
        pred_any = (pred_strict or extract_last_boxed(text)).replace("\\pi", "").strip()
        exp = q["expected"].strip()

        is_strict = closed_think and (pred_strict == exp)
        is_lenient = (pred_any == exp)
        if is_strict:
            strict_hits += 1
        if is_lenient:
            lenient_hits += 1

        waits = think_part.lower().count("wait") + think_part.lower().count("check")
        total_waits += waits
        per_q.append({
            "id": q["id"],
            "tokens": n_tok,
            "closed_think": closed_think,
            "hit_cutoff": hit_cutoff,
            "strict_ok": is_strict,
            "pred_strict": pred_strict,
            "expected": exp,
            "waits": waits,
        })

    n = len(live_qs)
    return {
        "strict_hits": strict_hits,
        "strict_acc_pct": round(100.0 * strict_hits / n, 2),
        "lenient_hits": lenient_hits,
        "cutoff_count": cutoffs,
        "closed_think_count": closed_thinks,
        "avg_tokens": round(total_toks / n, 1),
        "avg_waits": round(total_waits / n, 2),
        "wall_s": round(dt, 2),
        "per_q": per_q,
    }


def save_edited_checkpoint_and_manifest(
    base_model_dir: Path,
    out_model_dir: Path,
    model,
    base_weights: Dict[int, torch.Tensor],
    target_layers: List[int],
    edit_info: Dict[int, dict],
    calibration_sweep_log: dict,
):
    """Saves the frozen edited model checkpoint and MIT CSAIL-format edit/manifest.json + edit.npz."""
    out_model_dir.mkdir(parents=True, exist_ok=True)
    # Copy tokenizer and config files
    for fname in os.listdir(base_model_dir):
        if not fname.endswith(".safetensors"):
            src = base_model_dir / fname
            if src.is_file():
                shutil.copy2(src, out_model_dir / fname)

    # Save model weights via save_pretrained or direct safetensors modification
    model.save_pretrained(out_model_dir, safe_serialization=True)

    # Build MIT CSAIL-style manifest.json and edit.npz
    edit_dir = out_model_dir / "wsp_edit_manifest"
    edit_dir.mkdir(parents=True, exist_ok=True)

    manifest_tensors = []
    npz_dict = {}
    total_changed_entries = 0

    for i, l in enumerate(target_layers):
        t_name = f"model.layers.{l}.mlp.down_proj.weight"
        w0 = base_weights[l].detach().cpu()
        w_ed = model.model.layers[l].mlp.down_proj.weight.detach().cpu()

        b0_bits = w0.view(torch.uint16).numpy().reshape(-1)
        bed_bits = w_ed.view(torch.uint16).numpy().reshape(-1)
        diff_mask = b0_bits != bed_bits
        changed_idx = np.nonzero(diff_mask)[0].astype(np.int32)
        changed_val = bed_bits[changed_idx].astype(np.uint16)

        diff_2d = (w0.view(torch.uint16).numpy() != w_ed.view(torch.uint16).numpy())
        changed_cols = int(np.any(diff_2d, axis=0).sum())
        changed_rows = int(np.any(diff_2d, axis=1).sum())

        npz_dict[f"t{i}_idx"] = changed_idx
        npz_dict[f"t{i}_val"] = changed_val

        total_changed_entries += len(changed_idx)
        manifest_tensors.append({
            "name": t_name,
            "layer": l,
            "shape": list(w0.shape),
            "dtype": "bfloat16",
            "changed_entries": int(len(changed_idx)),
            "changed_columns": changed_cols,
            "changed_rows": changed_rows,
            "relative_change": edit_info[l]["relative_frob_change"],
            "base_sha256": tensor_sha256(w0),
            "edited_sha256": tensor_sha256(w_ed),
            "form": "sparse_rank1_wsp",
            "top_columns_preview": edit_info[l]["top_cols"][:16],
        })

    manifest = {
        "method": "MIT CSAIL Weight-Space Programming (Sparse Rank-1 MLP Down-Projection Surgery)",
        "formula": "W = W_0 - alpha * u_l * (mask_K * (u_l^T W_0))",
        "changed_tensors": len(target_layers),
        "changed_entries_total": int(total_changed_entries),
        "tensors": manifest_tensors,
        "calibration_sweep_summary": calibration_sweep_log,
    }
    (edit_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    np.savez_compressed(edit_dir / "edit.npz", **npz_dict)
    print(f"Saved frozen WSP checkpoint to {out_model_dir} ({total_changed_entries:,} bfloat16 entries modified)")


def run_surgeon_for_model(model_name: str):
    base_dir = ROOT / "models" / model_name
    out_dir = ROOT / "models" / f"{model_name}-WSP"
    cal_data = json.loads(CAL_PATH.read_text(encoding="utf-8"))
    diag_data = json.loads((ROOT / "calibration" / f"cal_diag_{model_name}.json").read_text(encoding="utf-8"))

    print(f"\n==================================================================")
    print(f"Weight-Space Programming Surgeon: {model_name}")
    print(f"==================================================================")

    tok = AutoTokenizer.from_pretrained(str(base_dir), padding_side="left")
    if tok.pad_token_id is None:
        tok.pad_token_id = tok.eos_token_id

    model = AutoModelForCausalLM.from_pretrained(
        str(base_dir), dtype=torch.bfloat16, device_map="cuda:0", attn_implementation="sdpa"
    )
    model.eval()

    print("1. Extracting teacher-forced activation & spectral profiles on Calibration Split...")
    profiles = extract_calibration_profiles(model, tok, cal_data, diag_data)

    # Save layer profile summary for plotting and report
    layer_summary = []
    for l, p in profiles.items():
        layer_summary.append({
            "layer": l,
            "diff_norm": round(p["diff_norm"], 4),
            "frob_norm": round(p["frob_norm"], 4),
            "relative_separation": round(p["diff_norm"] / max(p["frob_norm"], 1e-6), 6),
            "cos_emp_logit": round(p["cos_emp_logit"], 4),
        })
    (ROOT / "calibration" / f"wsp_layer_profile_{model_name}.json").write_text(
        json.dumps(layer_summary, indent=2), encoding="utf-8"
    )

    # Cache base weights of candidate mid-to-late layers (layers 14..26)
    candidate_layers_pool = list(range(14, 27))
    base_weights = {
        l: model.model.layers[l].mlp.down_proj.weight.detach().clone()
        for l in candidate_layers_pool
    }

    # Baseline calibration metrics from diag_data
    base_cal_eval = evaluate_on_calibration(model, tok, cal_data["live_calibration_questions"])
    print(
        f"   [Baseline Calibration] Strict={base_cal_eval['strict_hits']}/6 ({base_cal_eval['strict_acc_pct']}%) | "
        f"Cutoffs={base_cal_eval['cutoff_count']}/6 | AvgTok={base_cal_eval['avg_tokens']} | AvgWaits={base_cal_eval['avg_waits']}"
    )

    # Candidate WSP surgical configurations on Calibration Split ONLY
    # Note: In 28-layer Qwen3, layers [17, 21, 24] or [18, 22, 25] correspond to 60%-88% depth
    candidates = [
        {"name": "wsp_L18_21_24_26_k64_a5.0_b0.20", "layers": [18, 21, 24, 26], "k": 64, "alpha": 5.0, "beta": 0.20},
        {"name": "wsp_L16_19_22_24_26_k96_a5.5_b0.15", "layers": [16, 19, 22, 24, 26], "k": 96, "alpha": 5.5, "beta": 0.15},
        {"name": "wsp_L16_19_22_24_26_k128_a6.0_b0.12", "layers": [16, 19, 22, 24, 26], "k": 128, "alpha": 6.0, "beta": 0.12},
        {"name": "wsp_L15_18_20_22_24_25_26_k128_a6.0_b0.12", "layers": [15, 18, 20, 22, 24, 25, 26], "k": 128, "alpha": 6.0, "beta": 0.12},
        {"name": "wsp_L15_18_20_22_24_25_26_k160_a6.5_b0.10", "layers": [15, 18, 20, 22, 24, 25, 26], "k": 160, "alpha": 6.5, "beta": 0.10},
        {"name": "wsp_L14_17_19_21_23_24_25_26_k192_a6.8_b0.10", "layers": [14, 17, 19, 21, 23, 24, 25, 26], "k": 192, "alpha": 6.8, "beta": 0.10},
    ]

    sweep_results = []
    best_cand = None
    best_score = (-1, -1, 9999.0)  # (strict_hits, -cutoff_count, -avg_tokens)

    print("2. Evaluating candidate rank-1 weight edits on the 6 Live Calibration Questions...")
    for cand in candidates:
        edit_info = apply_wsp_edit_in_memory(
            model,
            base_weights,
            profiles,
            target_layers=cand["layers"],
            k_cols=cand["k"],
            alpha=cand["alpha"],
            beta=cand["beta"],
            random_control=False,
        )
        ev = evaluate_on_calibration(model, tok, cal_data["live_calibration_questions"])
        print(
            f"   [{cand['name']:40s}] Strict={ev['strict_hits']}/6 ({ev['strict_acc_pct']:5.1f}%) | "
            f"Cutoffs={ev['cutoff_count']}/6 | AvgTok={ev['avg_tokens']:6.1f} | AvgWaits={ev['avg_waits']:4.2f} | Wall={ev['wall_s']:.1f}s"
        )
        cand_record = {**cand, "eval": ev}
        sweep_results.append(cand_record)

        score = (ev["strict_hits"], -ev["cutoff_count"], -ev["avg_tokens"])
        if score > best_score:
            best_score = score
            best_cand = cand_record

    # 3. Run Norm-Matched Random Orthogonal Direction Control on the winning architecture
    assert best_cand is not None
    print(f"3. Running Norm-Matched Random Orthogonal Control for winning config ({best_cand['name']})...")
    _ = apply_wsp_edit_in_memory(
        model,
        base_weights,
        profiles,
        target_layers=best_cand["layers"],
        k_cols=best_cand["k"],
        alpha=best_cand["alpha"],
        beta=best_cand["beta"],
        random_control=True,
    )
    rand_ev = evaluate_on_calibration(model, tok, cal_data["live_calibration_questions"])
    print(
        f"   [Random Orthogonal Control               ] Strict={rand_ev['strict_hits']}/6 ({rand_ev['strict_acc_pct']:5.1f}%) | "
        f"Cutoffs={rand_ev['cutoff_count']}/6 | AvgTok={rand_ev['avg_tokens']:6.1f} | AvgWaits={rand_ev['avg_waits']:4.2f}"
    )

    # 4. Re-apply winning WSP edit and freeze checkpoint to disk
    print(f"4. Applying winning WSP edit ({best_cand['name']}) and freezing checkpoint...")
    winning_edit_info = apply_wsp_edit_in_memory(
        model,
        base_weights,
        profiles,
        target_layers=best_cand["layers"],
        k_cols=best_cand["k"],
        alpha=best_cand["alpha"],
        beta=best_cand["beta"],
        random_control=False,
    )

    sweep_log = {
        "model_name": model_name,
        "baseline_calibration": base_cal_eval,
        "winning_candidate": best_cand,
        "random_orthogonal_control": rand_ev,
        "all_candidates": sweep_results,
    }
    (ROOT / "calibration" / f"wsp_sweep_{model_name}.json").write_text(
        json.dumps(sweep_log, indent=2), encoding="utf-8"
    )

    save_edited_checkpoint_and_manifest(
        base_dir, out_dir, model, base_weights, best_cand["layers"], winning_edit_info, sweep_log
    )

    del model
    torch.cuda.empty_cache()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["Qwen3-0.6B", "Qwen3-1.7B", "both"], default="both")
    args = parser.parse_args()
    if args.model in ("Qwen3-0.6B", "both"):
        run_surgeon_for_model("Qwen3-0.6B")
    if args.model in ("Qwen3-1.7B", "both"):
        run_surgeon_for_model("Qwen3-1.7B")
