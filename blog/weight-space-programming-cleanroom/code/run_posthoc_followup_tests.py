"""
Post-Hoc Follow-Up Experimental Suite (run strictly AFTER Phase 1 REPORT.md & frozen_checkpoint_lock.json):
  1. Built-in Non-Thinking Mode (`enable_thinking=False`) on `heldout_paired_suite.json` (n=64, Greedy)
     for untouched `Qwen3-0.6B` and `Qwen3-1.7B`.
  2. Gentler `alpha=2.0` Weight-Space Edit on `Qwen3-0.6B` (`Qwen3-0.6B-CleanWSP-Gentle-a2.0`:
     Layers [22, 24, 25, 26], 64 cols/layer = 0.04398% params, skipping Layer 21 bilingual pivot)
     evaluated across Diagnostic (n=32), Blind (n=32, Greedy & Sampled), and Paired (n=64, Greedy & Sampled).
  3. 2x / 4x-Argon Window (`max_new_tokens=4096`, `sandbox_turn_tokens=2560`, Greedy) for ALL FOUR
     before/after models (`0.6B` Base, `0.6B-CleanWSP`, `1.7B` Base, `1.7B-CleanWSP`) across
     `heldout_blind_post_suite.json` (n=32) and `heldout_paired_suite.json` (n=64).
  4. 4x Carbon Window (`max_new_tokens=8192`, `sandbox_turn_tokens=5120`, Greedy) for ALL FOUR
     before/after models (`0.6B` Base, `0.6B-CleanWSP`, `1.7B` Base, `1.7B-CleanWSP`) across
     `heldout_blind_post_suite.json` (n=32) and `heldout_paired_suite.json` (n=64).

Runs each GPU job in a fresh isolated subprocess with homogeneous domain batching (`B=4`, peak VRAM < 7 GiB
even at 8,192 tokens) and automatic batch-halving fallback if external GPU workloads contend for VRAM.
"""
import gc
import json
import os
import subprocess
import sys
import time

import torch

from pathlib import Path
STUDY_ROOT = str(Path(__file__).resolve().parent.parent)
REPO_ROOT = str(Path(__file__).resolve().parent.parent.parent)
OUT_DIR = os.path.join(STUDY_ROOT, "results", "posthoc_followup")
os.makedirs(OUT_DIR, exist_ok=True)

sys.path.insert(0, os.path.join(STUDY_ROOT, "src"))
sys.stdout.reconfigure(encoding="utf-8")

SHORT_DOMAINS = {
    "instruction_following",
    "data_extraction",
    "creative_and_synthesis",
    "computer_usage",
}


def load_tasks(split_filename: str) -> list[dict]:
    p = os.path.join(STUDY_ROOT, "data", split_filename)
    with open(p, "r", encoding="utf-8") as f:
        d = json.load(f)
    return d["tasks"] if isinstance(d, dict) and "tasks" in d else d


def run_worker_job(cfg: dict) -> None:
    import evaluator
    from transformers import AutoTokenizer

    enable_thinking = bool(cfg["enable_thinking"])
    sandbox_turn_tokens = int(cfg["sandbox_turn_tokens"])
    max_new_tokens = int(cfg["max_new_tokens"])
    batch_size = int(cfg["batch_size"])
    do_sample = bool(cfg["do_sample"])
    label = cfg["label"]
    out_path = os.path.join(OUT_DIR, cfg["out_name"])

    orig_from_pretrained = AutoTokenizer.from_pretrained
    orig_generate_batch = evaluator.generate_batch

    def wrapped_from_pretrained(*args, **kwargs):
        tok = orig_from_pretrained(*args, **kwargs)
        orig_apply = tok.apply_chat_template

        def wrapped_apply(conversation, *a, **kw):
            kw["enable_thinking"] = enable_thinking
            return orig_apply(conversation, *a, **kw)

        tok.apply_chat_template = wrapped_apply
        return tok

    def wrapped_generate_batch(model, tokenizer, messages_list, max_new_tokens=2048, **kwargs):
        if max_new_tokens == 1280 and sandbox_turn_tokens != 1280:
            max_new_tokens = sandbox_turn_tokens
        return orig_generate_batch(model, tokenizer, messages_list, max_new_tokens=max_new_tokens, **kwargs)

    evaluator.AutoTokenizer.from_pretrained = wrapped_from_pretrained
    evaluator.generate_batch = wrapped_generate_batch

    tasks = load_tasks(cfg["split_file"])
    canonical_ids = [t["id"] for t in tasks]

    # For deterministic greedy runs, group short-output domains separately from long-reasoning domains
    # so short tasks never sit idle behind an 8,192-token trace, then restore exact canonical task order.
    if not do_sample:
        tasks_ordered = sorted(
            tasks,
            key=lambda t: (0 if t.get("domain") in SHORT_DOMAINS else 1, canonical_ids.index(t["id"])),
        )
    else:
        tasks_ordered = tasks

    t0 = time.perf_counter()
    res = evaluator.evaluate_suite(
        model_path=cfg["model_path"],
        tasks=tasks_ordered,
        do_sample=do_sample,
        max_new_tokens=max_new_tokens,
        batch_size=batch_size,
        seed=42,
        label=label,
    )
    by_id = {r["task_id"]: r for r in res["results"]}
    res["results"] = [by_id[tid] for tid in canonical_ids]
    res["followup_meta"] = {
        "enable_thinking": enable_thinking,
        "max_new_tokens": max_new_tokens,
        "sandbox_turn_tokens": sandbox_turn_tokens,
        "batch_size": batch_size,
        "elapsed_wall_sec": round(time.perf_counter() - t0, 2),
    }

    tmp_path = out_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, out_path)

    s = res["summary"]
    print(
        f"[SAVED] {cfg['out_name']}: pass={s['pass_count']}/{s['num_tasks']} ({s['pass_rate']*100:.1f}%), "
        f"partial={s['mean_partial_score']:.3f}, trunc={s['truncation_rate']*100:.1f}%, "
        f"mean_toks={s['mean_generated_tokens']:.1f}, doubt={s['mean_doubt_markers']:.2f}, "
        f"wall={time.perf_counter()-t0:.1f}s",
        flush=True,
    )


def ensure_gentle_06b_checkpoint() -> str:
    from weight_space_programmer import save_surgical_checkpoint

    gentle_dir = os.path.join(STUDY_ROOT, "models", "Qwen3-0.6B-CleanWSP-Gentle-a2.0")
    if os.path.exists(os.path.join(gentle_dir, "model.safetensors")):
        print(f"[Gentle 0.6B] Using existing checkpoint at {gentle_dir}", flush=True)
        return gentle_dir
    analysis_pt = os.path.join(STUDY_ROOT, "results", "wsp_analysis_0.6B.pt")
    base_06b = os.path.join(REPO_ROOT, "models", "Qwen3-0.6B")
    analysis = torch.load(analysis_pt, map_location="cpu", weights_only=False)
    save_surgical_checkpoint(
        base_model_path=base_06b,
        output_dir=gentle_dir,
        analysis=analysis,
        target_layers=[22, 24, 25, 26],
        num_cols=64,
        alpha=2.0,
    )
    return gentle_dir


def dispatch_job(
    out_name: str,
    model_path: str,
    split_file: str,
    enable_thinking: bool,
    max_new_tokens: int,
    sandbox_turn_tokens: int,
    batch_size: int,
    do_sample: bool,
    label: str,
) -> None:
    out_path = os.path.join(OUT_DIR, out_name)
    if os.path.exists(out_path) and os.path.getsize(out_path) > 1024:
        with open(out_path, "r", encoding="utf-8") as f:
            cached = json.load(f)
        s = cached["summary"]
        print(
            f"[SKIP CACHED] {out_name}: pass={s['pass_count']}/{s['num_tasks']} "
            f"({s['pass_rate']*100:.1f}%), mean_toks={s['mean_generated_tokens']:.1f}",
            flush=True,
        )
        return

    cur_bs = batch_size
    while cur_bs >= 1:
        cfg = {
            "out_name": out_name,
            "model_path": model_path,
            "split_file": split_file,
            "enable_thinking": enable_thinking,
            "max_new_tokens": max_new_tokens,
            "sandbox_turn_tokens": sandbox_turn_tokens,
            "batch_size": cur_bs,
            "do_sample": do_sample,
            "label": label,
        }
        print(
            f"\n================ DISPATCHING {label} (B={cur_bs}, cap={max_new_tokens}) ================",
            flush=True,
        )
        proc = subprocess.run([sys.executable, __file__, "--worker", json.dumps(cfg)])
        if proc.returncode == 0 and os.path.exists(out_path):
            return
        if cur_bs == 1:
            raise RuntimeError(f"Job {label} failed even at batch_size=1 (exit={proc.returncode})")
        cur_bs = max(1, cur_bs // 2)
        print(f"[RETRY] {label} exited with {proc.returncode}; retrying in 5s with batch_size={cur_bs}...", flush=True)
        time.sleep(5)


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--worker":
        run_worker_job(json.loads(sys.argv[2]))
        return

    base_06b = os.path.join(REPO_ROOT, "models", "Qwen3-0.6B")
    base_17b = os.path.join(REPO_ROOT, "models", "Qwen3-1.7B")
    wsp_06b = os.path.join(STUDY_ROOT, "models", "Qwen3-0.6B-CleanWSP")
    wsp_17b = os.path.join(STUDY_ROOT, "models", "Qwen3-1.7B-CleanWSP")
    gentle_06b = ensure_gentle_06b_checkpoint()

    jobs = [
        # 1. Non-Thinking Mode (Paired n=64)
        ("paired_nothink_0.6B_greedy.json", base_06b, "heldout_paired_suite.json", False, 2048, 1280, 8, False, "Paired-0.6B-NoThink-Greedy"),
        ("paired_nothink_1.7B_greedy.json", base_17b, "heldout_paired_suite.json", False, 2048, 1280, 8, False, "Paired-1.7B-NoThink-Greedy"),
        # 2. Gentle alpha=2.0 0.6B checkpoint
        ("diag_gentle_a2.0_0.6B_greedy.json", gentle_06b, "diagnostic_probes.json", True, 2048, 1280, 8, False, "Diag-0.6B-Gentle-a2.0-Greedy"),
        ("blind_gentle_a2.0_0.6B_greedy.json", gentle_06b, "heldout_blind_post_suite.json", True, 2048, 1280, 8, False, "Blind-0.6B-Gentle-a2.0-Greedy"),
        ("blind_gentle_a2.0_0.6B_sampled.json", gentle_06b, "heldout_blind_post_suite.json", True, 2048, 1280, 8, True, "Blind-0.6B-Gentle-a2.0-Sampled"),
        ("paired_gentle_a2.0_0.6B_greedy.json", gentle_06b, "heldout_paired_suite.json", True, 2048, 1280, 8, False, "Paired-0.6B-Gentle-a2.0-Greedy"),
        ("paired_gentle_a2.0_0.6B_sampled.json", gentle_06b, "heldout_paired_suite.json", True, 2048, 1280, 8, True, "Paired-0.6B-Gentle-a2.0-Sampled"),
        # 3. Blind (n=32) Before/After @ 4,096 (2x Carbon / 4x Argon) AND 8,192 (4x Carbon!)
        ("blind_base_0.6B_4096_greedy.json", base_06b, "heldout_blind_post_suite.json", True, 4096, 2560, 8, False, "Blind-0.6B-Base-4096-Greedy"),
        ("blind_wsp_0.6B_4096_greedy.json", wsp_06b, "heldout_blind_post_suite.json", True, 4096, 2560, 8, False, "Blind-0.6B-WSP-4096-Greedy"),
        ("blind_base_1.7B_4096_greedy.json", base_17b, "heldout_blind_post_suite.json", True, 4096, 2560, 6, False, "Blind-1.7B-Base-4096-Greedy"),
        ("blind_wsp_1.7B_4096_greedy.json", wsp_17b, "heldout_blind_post_suite.json", True, 4096, 2560, 6, False, "Blind-1.7B-WSP-4096-Greedy"),
        ("blind_base_0.6B_8192_greedy.json", base_06b, "heldout_blind_post_suite.json", True, 8192, 5120, 4, False, "Blind-0.6B-Base-8192-Greedy"),
        ("blind_wsp_0.6B_8192_greedy.json", wsp_06b, "heldout_blind_post_suite.json", True, 8192, 5120, 4, False, "Blind-0.6B-WSP-8192-Greedy"),
        ("blind_base_1.7B_8192_greedy.json", base_17b, "heldout_blind_post_suite.json", True, 8192, 5120, 4, False, "Blind-1.7B-Base-8192-Greedy"),
        ("blind_wsp_1.7B_8192_greedy.json", wsp_17b, "heldout_blind_post_suite.json", True, 8192, 5120, 4, False, "Blind-1.7B-WSP-8192-Greedy"),
        # 4. Paired (n=64) Before/After @ 4,096 (2x Carbon / 4x Argon) AND 8,192 (4x Carbon!)
        ("paired_base_0.6B_4096_greedy.json", base_06b, "heldout_paired_suite.json", True, 4096, 2560, 8, False, "Paired-0.6B-Base-4096-Greedy"),
        ("paired_wsp_0.6B_4096_greedy.json", wsp_06b, "heldout_paired_suite.json", True, 4096, 2560, 8, False, "Paired-0.6B-WSP-4096-Greedy"),
        ("paired_base_1.7B_4096_greedy.json", base_17b, "heldout_paired_suite.json", True, 4096, 2560, 6, False, "Paired-1.7B-Base-4096-Greedy"),
        ("paired_wsp_1.7B_4096_greedy.json", wsp_17b, "heldout_paired_suite.json", True, 4096, 2560, 6, False, "Paired-1.7B-WSP-4096-Greedy"),
        ("paired_base_0.6B_8192_greedy.json", base_06b, "heldout_paired_suite.json", True, 8192, 5120, 4, False, "Paired-0.6B-Base-8192-Greedy"),
        ("paired_wsp_0.6B_8192_greedy.json", wsp_06b, "heldout_paired_suite.json", True, 8192, 5120, 4, False, "Paired-0.6B-WSP-8192-Greedy"),
        ("paired_base_1.7B_8192_greedy.json", base_17b, "heldout_paired_suite.json", True, 8192, 5120, 4, False, "Paired-1.7B-Base-8192-Greedy"),
        ("paired_wsp_1.7B_8192_greedy.json", wsp_17b, "heldout_paired_suite.json", True, 8192, 5120, 4, False, "Paired-1.7B-WSP-8192-Greedy"),
    ]

    t_all = time.perf_counter()
    for job in jobs:
        dispatch_job(*job)
    print(f"\nALL FOLLOW-UP JOBS COMPLETED SUCCESSFULLY in {(time.perf_counter()-t_all)/60:.1f} min.", flush=True)


if __name__ == "__main__":
    main()
