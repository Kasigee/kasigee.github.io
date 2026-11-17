"""
Sequentially profiles Base vs CleanWSP hardware prefill & decode speed across
batch=1 and batch=16 for Qwen3-0.6B and Qwen3-1.7B, saving `results/speed_microbenchmark.json`.
"""

import json
import os
from speed_profiler import profile_model_hardware

STUDY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE_MODELS = os.path.join(os.path.dirname(STUDY_ROOT), "models")


def main():
    targets = [
        ("0.6B_base", os.path.join(WORKSPACE_MODELS, "Qwen3-0.6B")),
        ("0.6B_wsp", os.path.join(STUDY_ROOT, "models", "Qwen3-0.6B-CleanWSP")),
        ("1.7B_base", os.path.join(WORKSPACE_MODELS, "Qwen3-1.7B")),
        ("1.7B_wsp", os.path.join(STUDY_ROOT, "models", "Qwen3-1.7B-CleanWSP")),
    ]
    combined = {}
    out_path = os.path.join(STUDY_ROOT, "results", "speed_microbenchmark.json")
    for key, mpath in targets:
        print(f"\n=== Profiling Hardware Speed: {key} ({mpath}) ===", flush=True)
        combined[key] = profile_model_hardware(mpath, key, repeats=2)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(combined, f, indent=2)
    print(f"\n[Speed Profiler] Saved combined hardware telemetry to {out_path}", flush=True)


if __name__ == "__main__":
    main()
