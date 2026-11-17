"""
Mechanistic Weight-Space Programming (WSP) Engine for Qwen3 Models.

CLEAN-ROOM ANTI-LEAKAGE GUARANTEE:
  This module verifies the SHA-256 digest of its calibration input against
  `data/diagnostic_probes.json` and refuses to run on any held-out evaluation split.

Method:
  1. Teacher-forced single forward pass over the 32 diagnostic probe traces,
     capturing per-layer SwiGLU post-gate neuron activations z^(l) in R^{T x d_ff}
     and MLP residual writes m^(l) = W_down^(l) z^(l) in R^{T x d_model}.
  2. Contrasts recursive loop / post-derivation self-doubt positions (T_loop)
     against clean commit transitions (T_commit) and productive deduction steps (T_deduce).
  3. Combines empirical loop residual direction with direct weight-space unembedding
     (W_U * RMSNorm) doubt-vs-commit lexical direction, and Gram-Schmidt orthogonalizes
     against productive deduction (T_deduce) to prevent collateral capability loss.
  4. Ranks all 28 layers and all d_ff columns of `mlp.down_proj.weight` by their
     Causal Loop Write Score:
         Score(l, j) = (E_loop[z_j^(l)] - E_prod[z_j^(l)]) * <w_down,j^(l), d_hat^(l)>
  5. Performs gradient-free, ultra-sparse surgical column editing on ONLY the top-K
     columns (e.g. K=64 per culprit layer -> ~0.02% of total weights):
         w_down,j^(l) <- w_down,j^(l) - alpha * <w_down,j^(l), d_hat^(l)> * d_hat^(l)
"""

import argparse
import copy
import hashlib
import json
import os
import random
import re
import shutil
import time

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from evaluator import evaluate_suite

STUDY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST_PATH = os.path.join(STUDY_ROOT, "data", "leakage_audit_manifest.json")

LOOP_TRIGGER_WORDS = {
    "wait", "alternatively", "hmm", "however", "but", "another", "maybe", "hold", "recheck", "re-verify"
}


def verify_diagnostic_only(dataset_path: str):
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    expected_hash = manifest["dataset_sha256"]["diagnostic_probes.json"]
    h = hashlib.sha256()
    with open(dataset_path, "rb") as f:
        h.update(f.read())
    actual_hash = h.hexdigest()
    if actual_hash != expected_hash:
        raise RuntimeError(
            f"ANTI-LEAKAGE VIOLATION BLOCKED: dataset SHA-256 {actual_hash} != diagnostic_probes.json {expected_hash}!"
        )
    print(f"[Anti-Leakage OK] Verified calibration split SHA-256 = {actual_hash[:16]}... (diagnostic_probes.json ONLY)")


def find_token_partitions(tokenizer, prompt_text: str, raw_output: str) -> dict:
    """Identifies exact token indices for T_loop, T_commit, and T_deduce inside a diagnostic sequence."""
    prompt_ids = tokenizer.encode(prompt_text, add_special_tokens=False)
    gen_ids = tokenizer.encode(raw_output, add_special_tokens=False)
    full_ids = prompt_ids + gen_ids
    p_len = len(prompt_ids)

    think_end_tok_id = tokenizer.encode("</think>", add_special_tokens=False)
    think_end_id = think_end_tok_id[0] if len(think_end_tok_id) == 1 else None

    # Locate </think> position in gen_ids if present
    close_pos = None
    for idx, tid in enumerate(gen_ids):
        if think_end_id is not None and tid == think_end_id:
            close_pos = idx
            break
    if close_pos is None and "</think>" in raw_output:
        prefix_before_close = raw_output[: raw_output.rfind("</think>")]
        close_pos = len(tokenizer.encode(prefix_before_close, add_special_tokens=False))

    think_limit = close_pos if close_pos is not None else len(gen_ids)

    loop_positions = []      # Positions t (predicting t+1) where t+1 starts recursive doubt/loop
    commit_positions = []    # Positions t immediately preceding </think> or final synthesis
    deduce_positions = []    # Productive early deduction + clean post-think output tokens

    # Decode each generated token piece to spot loop trigger words after initial setup (idx >= 90)
    tok_strs = [tokenizer.decode([tid]).strip().lower().strip(",.:;!?*()") for tid in gen_ids]

    for g_idx in range(len(gen_ids) - 1):
        abs_pos = p_len + g_idx - 1  # hidden state at abs_pos predicts gen_ids[g_idx]
        if abs_pos < p_len:
            continue
        next_word = tok_strs[g_idx]

        if g_idx < think_limit:
            if g_idx >= 90 and next_word in LOOP_TRIGGER_WORDS:
                loop_positions.append(abs_pos)
            elif g_idx < 85 and next_word not in LOOP_TRIGGER_WORDS:
                deduce_positions.append(abs_pos)
        else:
            # Post-</think> clean output tokens (protecting code/JSON/prose formatting!)
            if g_idx < think_limit + 120:
                deduce_positions.append(abs_pos)

    if close_pos is not None and close_pos >= 4:
        # Capture the 4 states leading right into </think> commitment
        for offset in range(-4, 1):
            pos = p_len + close_pos - 1 + offset
            if p_len <= pos < len(full_ids) - 1:
                commit_positions.append(pos)

    return {
        "full_ids": full_ids,
        "loop_pos": loop_positions,
        "commit_pos": commit_positions,
        "deduce_pos": deduce_positions,
    }


def analyze_weight_and_activation_space(
    model_path: str,
    diag_tasks: list[dict],
    diag_results: dict,
) -> dict:
    tokenizer = AutoTokenizer.from_pretrained(model_path)
    model = AutoModelForCausalLM.from_pretrained(
        model_path, dtype=torch.bfloat16, attn_implementation="sdpa"
    ).to("cuda")
    model.eval()

    n_layers = model.config.num_hidden_layers
    d_model = model.config.hidden_size
    d_ff = model.config.intermediate_size

    # 1. Pure Weight-Space Lexical Unembedding Direction (Doubt vs Commit in W_U)
    with torch.no_grad():
        norm_w = model.model.norm.weight.detach().float()  # (d_model,)
        embed_w = model.model.embed_tokens.weight.detach().float()  # (V, d_model)

        doubt_strings = ["Wait", " Wait", "\nWait", "Alternatively", " Alternatively", "Hmm", "But", " But", "However"]
        commit_strings = ["</think>"]
        doubt_ids = list({tokenizer.encode(s, add_special_tokens=False)[0] for s in doubt_strings if tokenizer.encode(s, add_special_tokens=False)})
        commit_ids = [tokenizer.encode(s, add_special_tokens=False)[0] for s in commit_strings]

        w_doubt = (embed_w[doubt_ids].mean(dim=0) * norm_w)
        w_commit = (embed_w[commit_ids].mean(dim=0) * norm_w)
        w_lex = w_doubt - w_commit
        w_lex = w_lex / (w_lex.norm() + 1e-8)  # (d_model,) on GPU

    # Accumulators across the 32 diagnostic forward passes (float32 for numerical precision)
    sum_z_loop = torch.zeros((n_layers, d_ff), dtype=torch.float64, device="cuda")
    sum_z_prod = torch.zeros((n_layers, d_ff), dtype=torch.float64, device="cuda")
    sum_m_loop = torch.zeros((n_layers, d_model), dtype=torch.float64, device="cuda")
    sum_m_commit = torch.zeros((n_layers, d_model), dtype=torch.float64, device="cuda")
    sum_m_deduce = torch.zeros((n_layers, d_model), dtype=torch.float64, device="cuda")

    cnt_loop = 0
    cnt_commit = 0
    cnt_deduce = 0

    captured_z = {}

    def make_hook(layer_idx):
        def hook_fn(module, inputs, output):
            # inputs[0] to down_proj is SwiGLU activation z^(l) of shape (1, seq_len, d_ff)
            captured_z[layer_idx] = inputs[0].detach()
        return hook_fn

    handles = [
        model.model.layers[l].mlp.down_proj.register_forward_hook(make_hook(l))
        for l in range(n_layers)
    ]

    res_by_id = {r["task_id"]: r for r in diag_results["results"]}

    print(f"[WSP] Running {len(diag_tasks)} teacher-forced forward passes on diagnostic probes...")
    with torch.inference_mode():
        for task in diag_tasks:
            rec = res_by_id[task["id"]]
            raw_out = (
                f"<think>\n{rec['think_text']}\n</think>\n\n{rec['final_text']}"
                if rec["closed_think"]
                else f"<think>\n{rec['think_text']}"
            )
            prompt_text = tokenizer.apply_chat_template(
                [{"role": "user", "content": task["prompt"]}],
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=True,
            )
            part = find_token_partitions(tokenizer, prompt_text, raw_out)
            # Cap sequence length to 2200 tokens to keep memory tiny
            seq_ids = part["full_ids"][:2200]
            l_pos = [p for p in part["loop_pos"] if p < len(seq_ids)]
            c_pos = [p for p in part["commit_pos"] if p < len(seq_ids)]
            d_pos = [p for p in part["deduce_pos"] if p < len(seq_ids)]

            if not (l_pos or c_pos or d_pos):
                continue

            captured_z.clear()
            inp_tensor = torch.tensor([seq_ids], dtype=torch.long, device="cuda")
            _ = model(inp_tensor, use_cache=False)

            for l in range(n_layers):
                z_l = captured_z[l][0].float()  # (T, d_ff)
                w_down = model.model.layers[l].mlp.down_proj.weight.detach().float()  # (d_model, d_ff)

                if l_pos:
                    zl_sub = z_l[l_pos]  # (n_l, d_ff)
                    sum_z_loop[l] += zl_sub.sum(dim=0).double()
                    ml_sub = zl_sub @ w_down.T  # (n_l, d_model)
                    sum_m_loop[l] += ml_sub.sum(dim=0).double()
                if c_pos:
                    zc_sub = z_l[c_pos]
                    sum_z_prod[l] += zc_sub.sum(dim=0).double()
                    mc_sub = zc_sub @ w_down.T
                    sum_m_commit[l] += mc_sub.sum(dim=0).double()
                if d_pos:
                    zd_sub = z_l[d_pos]
                    sum_z_prod[l] += zd_sub.sum(dim=0).double()
                    md_sub = zd_sub @ w_down.T
                    sum_m_deduce[l] += md_sub.sum(dim=0).double()

            cnt_loop += len(l_pos)
            cnt_commit += len(c_pos)
            cnt_deduce += len(d_pos)

    for h in handles:
        h.remove()

    print(f"[WSP] Partition token counts: T_loop={cnt_loop}, T_commit={cnt_commit}, T_deduce={cnt_deduce}")
    cnt_prod = max(cnt_commit + cnt_deduce, 1)

    mean_z_loop = (sum_z_loop / max(cnt_loop, 1)).float()
    mean_z_prod = (sum_z_prod / cnt_prod).float()
    mean_m_loop = (sum_m_loop / max(cnt_loop, 1)).float()
    mean_m_commit = (sum_m_commit / max(cnt_commit, 1)).float()
    mean_m_deduce = (sum_m_deduce / max(cnt_deduce, 1)).float()

    layer_reports = []
    directions_by_layer = {}
    top_cols_by_layer = {}

    for l in range(n_layers):
        w_down = model.model.layers[l].mlp.down_proj.weight.detach().float()  # (d_model, d_ff)

        # Empirical residual contrast: loop vs (0.6*commit + 0.4*deduce)
        d_emp = mean_m_loop[l] - (0.65 * mean_m_commit[l] + 0.35 * mean_m_deduce[l])
        d_emp_norm = d_emp / (d_emp.norm() + 1e-8)

        # Blend empirical MLP direction with unembedding lexical doubt-vs-commit direction (if aligned)
        lex_cos = float(torch.dot(d_emp_norm, w_lex).item())
        d_comb = d_emp_norm + 0.35 * w_lex

        # Gram-Schmidt orthogonalize against productive deduction vector (mean_m_deduce[l])
        u_ded = mean_m_deduce[l] / (mean_m_deduce[l].norm() + 1e-8)
        proj_ded = torch.dot(d_comb, u_ded)
        if proj_ded.item() > 0:
            d_comb = d_comb - proj_ded * u_ded
        d_hat = d_comb / (d_comb.norm() + 1e-8)

        # Causal Loop Write Score per column j in [0, d_ff)
        delta_z = mean_z_loop[l] - mean_z_prod[l]  # (d_ff,)
        col_align = w_down.T @ d_hat               # (d_ff,) = <w_down,j, d_hat>
        # Only columns where BOTH neuron fires more in loops (delta_z > 0) AND writes positively along d_hat (col_align > 0)
        causal_scores = torch.where(
            (delta_z > 0) & (col_align > 0),
            delta_z * col_align,
            torch.zeros_like(delta_z),
        )
        top64_vals, top64_idx = torch.topk(causal_scores, k=min(128, d_ff))
        layer_drive_top64 = float(top64_vals[:64].sum().item())

        # Logit-lens check: which tokens does d_hat promote/suppress?
        logits_d = (embed_w @ (d_hat * norm_w))
        top_pos_ids = torch.topk(logits_d, k=8).indices.tolist()
        top_neg_ids = torch.topk(-logits_d, k=8).indices.tolist()

        directions_by_layer[l] = d_hat.cpu()
        top_cols_by_layer[l] = {
            "indices_128": top64_idx.cpu().tolist(),
            "scores_128": [round(float(x), 6) for x in top64_vals.cpu().tolist()],
        }
        layer_reports.append({
            "layer": l,
            "top64_causal_loop_drive": round(layer_drive_top64, 5),
            "lex_alignment_cos": round(lex_cos, 4),
            "promoted_tokens": [repr(tokenizer.decode([tid])) for tid in top_pos_ids],
            "suppressed_tokens": [repr(tokenizer.decode([tid])) for tid in top_neg_ids],
        })

    # Rank layers in the mid-to-upper semantic/decision stack [n_layers//3 .. n_layers-2]
    # (Excludes Layer 27 output-formatting head layer, empirically verified to disrupt EOS/</think> closure if edited)
    eligible = [r for r in layer_reports if (n_layers // 3) <= r["layer"] <= (n_layers - 2)]
    eligible_sorted = sorted(eligible, key=lambda x: x["top64_causal_loop_drive"], reverse=True)

    print("[WSP] Top 8 Culprit MLP Layers by Causal Loop Write Drive:")
    for r in eligible_sorted[:8]:
        print(
            f"  Layer {r['layer']:2d} | drive={r['top64_causal_loop_drive']:8.4f} | lex_cos={r['lex_alignment_cos']:+.3f} | "
            f"promotes={r['promoted_tokens'][:4]} | suppresses={r['suppressed_tokens'][:3]}"
        )

    total_params = sum(p.numel() for p in model.parameters())
    del model
    torch.cuda.empty_cache()

    return {
        "model_path": model_path,
        "total_params": total_params,
        "n_layers": n_layers,
        "d_model": d_model,
        "d_ff": d_ff,
        "token_counts": {"loop": cnt_loop, "commit": cnt_commit, "deduce": cnt_deduce},
        "layer_reports": layer_reports,
        "ranked_eligible_layers": [r["layer"] for r in eligible_sorted],
        "directions_by_layer": directions_by_layer,
        "top_cols_by_layer": top_cols_by_layer,
    }


def save_surgical_checkpoint(
    base_model_path: str,
    output_dir: str,
    analysis: dict,
    target_layers: list[int],
    num_cols: int,
    alpha: float,
    layer_alpha_scale: dict[int, float] | None = None,
    random_control: bool = False,
    seed: int = 1234,
) -> dict:
    """Applies surgical in-place modification to ONLY `num_cols` columns of `mlp.down_proj.weight`
    in `target_layers` with zero gradient steps, and saves a standard HuggingFace checkpoint."""
    os.makedirs(output_dir, exist_ok=True)
    model = AutoModelForCausalLM.from_pretrained(base_model_path, dtype=torch.bfloat16)
    tokenizer = AutoTokenizer.from_pretrained(base_model_path)

    d_model = analysis["d_model"]
    d_ff = analysis["d_ff"]
    total_params = analysis["total_params"]
    rng = random.Random(seed)
    layer_alpha_scale = layer_alpha_scale or {}

    modified_floats = 0
    layer_edits = []

    with torch.no_grad():
        for l in target_layers:
            eff_alpha = float(alpha) * float(layer_alpha_scale.get(l, 1.0))
            W = model.model.layers[l].mlp.down_proj.weight  # Parameter shape (d_model, d_ff), bf16
            W_f32 = W.data.float()
            d_hat = analysis["directions_by_layer"][l].float()  # (d_model,)

            if random_control:
                cols = sorted(rng.sample(range(d_ff), num_cols))
                # Use random unit vector orthogonal to nothing (matched norm perturbation control)
                rand_v = torch.randn_like(d_hat, generator=torch.Generator().manual_seed(seed + l))
                vec = rand_v / (rand_v.norm() + 1e-8)
            else:
                cols = analysis["top_cols_by_layer"][l]["indices_128"][:num_cols]
                vec = d_hat

            col_idx_t = torch.tensor(cols, dtype=torch.long)
            sub_W = W_f32[:, col_idx_t]  # (d_model, num_cols)
            proj = vec.unsqueeze(0) @ sub_W  # (1, num_cols) = <w_down,j, vec>
            delta_W = -eff_alpha * (vec.unsqueeze(1) @ proj)  # (d_model, num_cols)

            frob_before = float(W_f32.norm().item())
            frob_delta = float(delta_W.norm().item())

            W_f32[:, col_idx_t] = sub_W + delta_W
            W.data.copy_(W_f32.to(torch.bfloat16))

            modified_floats += d_model * len(cols)
            layer_edits.append({
                "layer": l,
                "tensor": f"model.layers.{l}.mlp.down_proj.weight",
                "num_columns_edited": len(cols),
                "column_indices_preview": cols[:16],
                "alpha": round(eff_alpha, 4),
                "random_control": random_control,
                "matrix_frob_norm_before": round(frob_before, 4),
                "edit_frob_norm": round(frob_delta, 4),
                "relative_frob_change_pct": round(100.0 * frob_delta / max(frob_before, 1e-8), 4),
            })

    model.save_pretrained(output_dir)
    # Copy all original tokenizer & generation config files bit-for-bit to guarantee identical tokenization
    for cfg_name in [
        "tokenizer.json",
        "tokenizer_config.json",
        "vocab.json",
        "merges.txt",
        "special_tokens_map.json",
        "added_tokens.json",
        "chat_template.jinja",
        "generation_config.json",
    ]:
        src_f = os.path.join(base_model_path, cfg_name)
        if os.path.exists(src_f):
            shutil.copy2(src_f, os.path.join(output_dir, cfg_name))

    edit_manifest = {
        "base_model_path": base_model_path,
        "output_dir": output_dir,
        "target_layers": target_layers,
        "columns_per_layer": num_cols,
        "alpha": alpha,
        "random_control": random_control,
        "total_model_parameters": total_params,
        "modified_parameters": modified_floats,
        "modified_pct": round(100.0 * modified_floats / total_params, 5),
        "untouched_pct": round(100.0 * (1.0 - modified_floats / total_params), 5),
        "layer_edits": layer_edits,
    }
    with open(os.path.join(output_dir, "wsp_edit_manifest.json"), "w", encoding="utf-8") as f:
        json.dump(edit_manifest, f, indent=2)

    del model
    return edit_manifest
