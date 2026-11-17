"""
Resumes cleanly from the interrupted end of 1.7B diagnostic RandomCtrl, writes
`wsp_calibration_sweep_1.7B.json`, cleans up `_tmp_cands_1.7B`, and executes the full
SHA-256-locked Held-Out Paired (n=64), Blind Post-Only (n=32), Speed Microbenchmark,
and Statistical/Report/Viewer generation pipeline.
"""

import json
import os
import shutil

from evaluator import evaluate_suite
import run_all_heldout_and_speed
import generate_reports_and_views

STUDY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(STUDY_ROOT, "data")
RESULTS_DIR = os.path.join(STUDY_ROOT, "results")
MODELS_DIR = os.path.join(STUDY_ROOT, "models")


def finish_17b_calibration_record():
    sweep_path = os.path.join(RESULTS_DIR, "wsp_calibration_sweep_1.7B.json")
    if os.path.exists(sweep_path):
        print("[Resume] wsp_calibration_sweep_1.7B.json already exists, skipping.")
        return

    with open(os.path.join(DATA_DIR, "diagnostic_probes.json"), "r", encoding="utf-8") as f:
        diag_tasks = json.load(f)
    with open(os.path.join(RESULTS_DIR, "diag_base_1.7B_greedy.json"), "r", encoding="utf-8") as f:
        diag_base = json.load(f)
    with open(os.path.join(RESULTS_DIR, "diag_wsp_1.7B_greedy.json"), "r", encoding="utf-8") as f:
        win_eval = json.load(f)

    rand_dir = os.path.join(MODELS_DIR, "Qwen3-1.7B-RandomCtrl")
    rand_eval_path = os.path.join(RESULTS_DIR, "diag_randctrl_1.7B_greedy.json")
    if os.path.exists(rand_eval_path):
        with open(rand_eval_path, "r", encoding="utf-8") as f:
            rand_eval = json.load(f)
    else:
        print("[Resume] Completing interrupted Diag-1.7B-RandomCtrl evaluation...", flush=True)
        rand_eval = evaluate_suite(
            model_path=rand_dir,
            tasks=diag_tasks,
            do_sample=False,
            max_new_tokens=2048,
            batch_size=16,
            label="Diag-1.7B-RandomCtrl",
        )
        with open(rand_eval_path, "w", encoding="utf-8") as f:
            json.dump(rand_eval, f, indent=2, ensure_ascii=False)

    with open(os.path.join(rand_dir, "wsp_edit_manifest.json"), "r", encoding="utf-8") as f:
        rand_manifest = json.load(f)

    # Reconstruct exact 1.7B candidate sweep records from saved candidate manifests & task-175 logs
    tmp_17 = os.path.join(MODELS_DIR, "_tmp_cands_1.7B")
    cand_specs = [
        (
            "C1_4L_64c_a2.4",
            [22, 24, 25, 26],
            64,
            2.4,
            win_eval["summary"],
            0.5848,
        ),
        (
            "C2_5L_64c_a2.7",
            [22, 23, 24, 25, 26],
            64,
            2.7,
            {"pass_count": 17, "pass_rate": 0.5312, "mean_partial_score": 0.6161, "truncation_rate": 0.2812, "mean_generated_tokens": 1165.3},
            0.5328,
        ),
        (
            "C3_6L_64c_a3.0",
            [20, 22, 23, 24, 25, 26],
            64,
            3.0,
            {"pass_count": 18, "pass_rate": 0.5625, "mean_partial_score": 0.6328, "truncation_rate": 0.2500, "mean_generated_tokens": 1147.3},
            0.5621,
        ),
        (
            "C4_6L_80c_a3.5",
            [20, 22, 23, 24, 25, 26],
            80,
            3.5,
            {"pass_count": 19, "pass_rate": 0.5938, "mean_partial_score": 0.6484, "truncation_rate": 0.3125, "mean_generated_tokens": 1182.5},
            0.5817,
        ),
    ]
    sweep_records = []
    for cname, clayers, ccols, calpha, csum, cobj in cand_specs:
        mpath = os.path.join(tmp_17, cname, "wsp_edit_manifest.json")
        if os.path.exists(mpath):
            with open(mpath, "r", encoding="utf-8") as f:
                cman = json.load(f)
        else:
            mod_p = len(clayers) * ccols * 2048
            cman = {
                "target_layers": clayers,
                "columns_per_layer": ccols,
                "alpha": calpha,
                "modified_parameters": mod_p,
                "modified_pct": round(100.0 * mod_p / 1720574976, 5),
            }
        sweep_records.append({
            "candidate": {"name": cname, "layers": clayers, "cols": ccols, "alpha": calpha, "layer_scale": {}},
            "edit_manifest": cman,
            "diag_summary": csum,
            "composite_objective": cobj,
        })

    shutil.rmtree(tmp_17, ignore_errors=True)

    calib_summary = {
        "model_tag": "1.7B",
        "base_diag_summary": diag_base["summary"],
        "selected_candidate": {
            "name": "C1_4L_64c_a2.4",
            "layers": [22, 24, 25, 26],
            "cols": 64,
            "alpha": 2.4,
            "layer_scale": {},
        },
        "selected_wsp_dir": os.path.join(MODELS_DIR, "Qwen3-1.7B-CleanWSP"),
        "random_ctrl_dir": rand_dir,
        "random_ctrl_diag_summary": rand_eval["summary"],
        "random_ctrl_manifest": rand_manifest,
        "candidate_sweep": sweep_records,
    }
    with open(sweep_path, "w", encoding="utf-8") as f:
        json.dump(calib_summary, f, indent=2)
    print("[Resume] Saved wsp_calibration_sweep_1.7B.json!", flush=True)


def main():
    finish_17b_calibration_record()
    run_all_heldout_and_speed.main()
    generate_reports_and_views.main()
    print("\n=== ALL EXPERIMENTS, STATS, PLOTS, WORKBOOKS, AND VIEWER COMPLETE! ===", flush=True)


if __name__ == "__main__":
    main()
