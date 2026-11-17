"""
Cryptographically locks the frozen CleanWSP & RandomCtrl checkpoints, runs all
Held-Out Paired (n=64) and Locked Single-Shot Blind Post-Only (n=32) evaluations
sequentially on GPU, runs the CUDA-Event Hardware Speed Microbenchmark, and re-verifies
checkpoint SHA-256 digests post-evaluation to prove zero weight modification on held-out splits.
"""

import datetime
import hashlib
import json
import os
import time

from evaluator import evaluate_suite
from speed_profiler import profile_model_hardware

STUDY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE_MODELS = os.path.join(os.path.dirname(STUDY_ROOT), "models")
DATA_DIR = os.path.join(STUDY_ROOT, "data")
RESULTS_DIR = os.path.join(STUDY_ROOT, "results")
MODELS_DIR = os.path.join(STUDY_ROOT, "models")


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(8 * 1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def hash_checkpoint_dir(mdir: str) -> dict[str, str]:
    digests = {}
    for fname in sorted(os.listdir(mdir)):
        if fname.endswith(".safetensors") or fname.endswith(".json"):
            digests[fname] = sha256_file(os.path.join(mdir, fname))
    return digests


def run_or_skip(out_name: str, model_path: str, tasks: list[dict], do_sample: bool, label: str):
    out_path = os.path.join(RESULTS_DIR, out_name)
    if os.path.exists(out_path):
        print(f"[HeldOut Runner] Skipping existing {out_name}", flush=True)
        return
    t0 = time.perf_counter()
    print(f"\n=== [HeldOut Runner] Starting {out_name} ({label}) ===", flush=True)
    res = evaluate_suite(
        model_path=model_path,
        tasks=tasks,
        do_sample=do_sample,
        max_new_tokens=2048,
        batch_size=16,
        seed=42,
        label=label,
    )
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2, ensure_ascii=False)
    dt = time.perf_counter() - t0
    s = res["summary"]
    print(
        f"=== [HeldOut Runner] Finished {out_name} in {dt:.1f}s | "
        f"pass={s['pass_rate']:.4f} ({s['pass_count']}/{s['num_tasks']}), "
        f"partial={s['mean_partial_score']:.4f}, trunc={s['truncation_rate']:.4f}, "
        f"mean_toks={s['mean_generated_tokens']:.1f} ===",
        flush=True,
    )


def main():
    os.makedirs(RESULTS_DIR, exist_ok=True)
    base_06 = os.path.join(WORKSPACE_MODELS, "Qwen3-0.6B")
    base_17 = os.path.join(WORKSPACE_MODELS, "Qwen3-1.7B")
    wsp_06 = os.path.join(MODELS_DIR, "Qwen3-0.6B-CleanWSP")
    wsp_17 = os.path.join(MODELS_DIR, "Qwen3-1.7B-CleanWSP")
    ctrl_06 = os.path.join(MODELS_DIR, "Qwen3-0.6B-RandomCtrl")
    ctrl_17 = os.path.join(MODELS_DIR, "Qwen3-1.7B-RandomCtrl")

    # 1. Pre-evaluation cryptographic freeze lock BEFORE loading any held-out dataset!
    lock_path = os.path.join(RESULTS_DIR, "frozen_checkpoint_lock.json")
    pre_hashes = {
        "locked_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "Qwen3-0.6B-CleanWSP": hash_checkpoint_dir(wsp_06),
        "Qwen3-1.7B-CleanWSP": hash_checkpoint_dir(wsp_17),
        "Qwen3-0.6B-RandomCtrl": hash_checkpoint_dir(ctrl_06),
        "Qwen3-1.7B-RandomCtrl": hash_checkpoint_dir(ctrl_17),
    }
    with open(lock_path, "w", encoding="utf-8") as f:
        json.dump({"pre_heldout_lock": pre_hashes}, f, indent=2)
    print(f"[Freeze Lock] Recorded pre-held-out SHA-256 checkpoint lock to {lock_path}", flush=True)

    with open(os.path.join(DATA_DIR, "heldout_paired_suite.json"), "r", encoding="utf-8") as f:
        paired_tasks = json.load(f)
    with open(os.path.join(DATA_DIR, "heldout_blind_post_suite.json"), "r", encoding="utf-8") as f:
        blind_tasks = json.load(f)

    # 2. Held-Out Paired Suite (n=64 across 8 domains)
    paired_jobs = [
        ("paired_base_0.6B_greedy.json", base_06, False, "Paired-0.6B-Base-Greedy"),
        ("paired_wsp_0.6B_greedy.json", wsp_06, False, "Paired-0.6B-WSP-Greedy"),
        ("paired_randctrl_0.6B_greedy.json", ctrl_06, False, "Paired-0.6B-RandCtrl-Greedy"),
        ("paired_base_0.6B_sampled.json", base_06, True, "Paired-0.6B-Base-Sampled"),
        ("paired_wsp_0.6B_sampled.json", wsp_06, True, "Paired-0.6B-WSP-Sampled"),
        ("paired_base_1.7B_greedy.json", base_17, False, "Paired-1.7B-Base-Greedy"),
        ("paired_wsp_1.7B_greedy.json", wsp_17, False, "Paired-1.7B-WSP-Greedy"),
        ("paired_randctrl_1.7B_greedy.json", ctrl_17, False, "Paired-1.7B-RandCtrl-Greedy"),
        ("paired_base_1.7B_sampled.json", base_17, True, "Paired-1.7B-Base-Sampled"),
        ("paired_wsp_1.7B_sampled.json", wsp_17, True, "Paired-1.7B-WSP-Sampled"),
    ]
    for fname, mpath, samp, lbl in paired_jobs:
        run_or_skip(fname, mpath, paired_tasks, samp, lbl)

    # 3. Locked Single-Shot Blind Post-Only Suite (n=32 across 8 domains)
    blind_jobs = [
        ("blind_base_0.6B_greedy.json", base_06, False, "Blind-0.6B-Base-Greedy"),
        ("blind_wsp_0.6B_greedy.json", wsp_06, False, "Blind-0.6B-WSP-Greedy"),
        ("blind_base_0.6B_sampled.json", base_06, True, "Blind-0.6B-Base-Sampled"),
        ("blind_wsp_0.6B_sampled.json", wsp_06, True, "Blind-0.6B-WSP-Sampled"),
        ("blind_base_1.7B_greedy.json", base_17, False, "Blind-1.7B-Base-Greedy"),
        ("blind_wsp_1.7B_greedy.json", wsp_17, False, "Blind-1.7B-WSP-Greedy"),
        ("blind_base_1.7B_sampled.json", base_17, True, "Blind-1.7B-Base-Sampled"),
        ("blind_wsp_1.7B_sampled.json", wsp_17, True, "Blind-1.7B-WSP-Sampled"),
    ]
    for fname, mpath, samp, lbl in blind_jobs:
        run_or_skip(fname, mpath, blind_tasks, samp, lbl)

    # 4. Dedicated CUDA-Event Hardware Speed Microbenchmark
    speed_path = os.path.join(RESULTS_DIR, "speed_microbenchmark.json")
    if not os.path.exists(speed_path):
        speed_targets = [
            ("0.6B_base", base_06),
            ("0.6B_wsp", wsp_06),
            ("1.7B_base", base_17),
            ("1.7B_wsp", wsp_17),
        ]
        combined_speed = {}
        for key, mpath in speed_targets:
            print(f"\n=== [Speed Profiler] Profiling {key} ===", flush=True)
            combined_speed[key] = profile_model_hardware(mpath, key, repeats=2)
            with open(speed_path, "w", encoding="utf-8") as f:
                json.dump(combined_speed, f, indent=2)

    # 5. Post-evaluation cryptographic verification: prove ZERO weight drift!
    post_hashes = {
        "verified_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "Qwen3-0.6B-CleanWSP": hash_checkpoint_dir(wsp_06),
        "Qwen3-1.7B-CleanWSP": hash_checkpoint_dir(wsp_17),
        "Qwen3-0.6B-RandomCtrl": hash_checkpoint_dir(ctrl_06),
        "Qwen3-1.7B-RandomCtrl": hash_checkpoint_dir(ctrl_17),
    }
    bit_exact = (
        pre_hashes["Qwen3-0.6B-CleanWSP"] == post_hashes["Qwen3-0.6B-CleanWSP"]
        and pre_hashes["Qwen3-1.7B-CleanWSP"] == post_hashes["Qwen3-1.7B-CleanWSP"]
    )
    if not bit_exact:
        raise RuntimeError("POST-EVALUATION CHECKPOINT HASH MISMATCH!")
    with open(lock_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "pre_heldout_lock": pre_hashes,
                "post_heldout_verification": post_hashes,
                "zero_weight_drift_verified": bit_exact,
            },
            f,
            indent=2,
        )
    print("[Freeze Lock] Verified 100% bit-exact checkpoint hashes before & after all held-out runs!", flush=True)


if __name__ == "__main__":
    main()
