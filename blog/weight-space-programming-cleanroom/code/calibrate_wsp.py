"""
Runs Clean-Room Weight-Space Programming Calibration strictly on `diagnostic_probes.json`,
selects the optimal ultra-sparse surgical checkpoint (<0.09% weights modified, zero gradients),
and builds a matched-sparsity Random-Column Negative Control checkpoint.
"""

import argparse
import json
import os
import shutil

import torch

from evaluator import evaluate_suite
from weight_space_programmer import (
    analyze_weight_and_activation_space,
    save_surgical_checkpoint,
    verify_diagnostic_only,
)

STUDY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def composite_objective(summary: dict) -> float:
    return (
        0.65 * summary["pass_rate"]
        + 0.35 * summary["mean_partial_score"]
        - 0.10 * summary["truncation_rate"]
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", required=True)
    parser.add_argument("--model-tag", required=True, help="e.g. 0.6B or 1.7B")
    parser.add_argument("--diag-dataset", required=True)
    parser.add_argument("--diag-base-results", required=True)
    args = parser.parse_args()

    # 1. Cryptographic anti-leakage check: ONLY diagnostic_probes.json allowed!
    verify_diagnostic_only(args.diag_dataset)

    with open(args.diag_dataset, "r", encoding="utf-8") as f:
        diag_tasks = json.load(f)
    with open(args.diag_base_results, "r", encoding="utf-8") as f:
        diag_base = json.load(f)

    # 2. Load cached or compute Mechanistic Weight + Activation Space Analysis
    pt_path = os.path.join(STUDY_ROOT, "results", f"wsp_analysis_{args.model_tag}.pt")
    if os.path.exists(pt_path):
        print(f"[Calibrate {args.model_tag}] Loading precomputed mechanistic analysis from {pt_path}...")
        analysis = torch.load(pt_path, weights_only=False)
        n_layers = analysis["n_layers"]
        eligible = [
            r for r in analysis["layer_reports"]
            if (n_layers // 3) <= r["layer"] <= (n_layers - 2)
        ]
        eligible_sorted = sorted(eligible, key=lambda x: x["top64_causal_loop_drive"], reverse=True)
        analysis["ranked_eligible_layers"] = [r["layer"] for r in eligible_sorted]
        torch.save(analysis, pt_path)
    else:
        analysis = analyze_weight_and_activation_space(args.base_model, diag_tasks, diag_base)
        torch.save(analysis, pt_path)

    ranked_layers = analysis["ranked_eligible_layers"]

    mech_out_path = os.path.join(STUDY_ROOT, "results", f"wsp_mechanistic_{args.model_tag}.json")
    serializable_analysis = {
        k: v for k, v in analysis.items() if k not in ("directions_by_layer",)
    }
    with open(mech_out_path, "w", encoding="utf-8") as f:
        json.dump(serializable_analysis, f, indent=2)

    base_obj = composite_objective(diag_base["summary"])
    print(
        f"\n[Calibrate {args.model_tag}] Base Diagnostic: pass={diag_base['summary']['pass_rate']:.4f} "
        f"({diag_base['summary']['pass_count']}/32), "
        f"partial={diag_base['summary']['mean_partial_score']:.4f}, "
        f"trunc={diag_base['summary']['truncation_rate']:.4f}, "
        f"mean_toks={diag_base['summary']['mean_generated_tokens']:.1f}, obj={base_obj:.4f}",
        flush=True,
    )

    # 3. Candidate surgical configurations across upper-middle semantic layers (excluding L27 output head)
    candidates = [
        {
            "name": "C1_4L_64c_a2.4",
            "layers": sorted(ranked_layers[:4]),
            "cols": 64,
            "alpha": 2.4,
            "layer_scale": {},
        },
        {
            "name": "C2_5L_64c_a2.7",
            "layers": sorted(ranked_layers[:5]),
            "cols": 64,
            "alpha": 2.7,
            "layer_scale": {},
        },
        {
            "name": "C3_6L_64c_a3.0",
            "layers": sorted(ranked_layers[:6]),
            "cols": 64,
            "alpha": 3.0,
            "layer_scale": {},
        },
        {
            "name": "C4_6L_80c_a3.5",
            "layers": sorted(ranked_layers[:6]),
            "cols": 80,
            "alpha": 3.5,
            "layer_scale": {},
        },
    ]

    tmp_cand_root = os.path.join(STUDY_ROOT, "models", f"_tmp_cands_{args.model_tag}")
    os.makedirs(tmp_cand_root, exist_ok=True)

    sweep_records = []
    best_rec = None
    best_obj = -999.0

    for cand in candidates:
        cdir = os.path.join(tmp_cand_root, cand["name"])
        manifest = save_surgical_checkpoint(
            base_model_path=args.base_model,
            output_dir=cdir,
            analysis=analysis,
            target_layers=cand["layers"],
            num_cols=cand["cols"],
            alpha=cand["alpha"],
            layer_alpha_scale=cand["layer_scale"],
            random_control=False,
        )
        eval_out = evaluate_suite(
            model_path=cdir,
            tasks=diag_tasks,
            do_sample=False,
            max_new_tokens=2048,
            batch_size=16,
            label=f"Diag-{args.model_tag}-{cand['name']}",
        )
        obj = composite_objective(eval_out["summary"])
        rec = {
            "candidate": {
                "name": cand["name"],
                "layers": cand["layers"],
                "cols": cand["cols"],
                "alpha": cand["alpha"],
                "layer_scale": {str(k): v for k, v in cand["layer_scale"].items()},
            },
            "edit_manifest": manifest,
            "diag_summary": eval_out["summary"],
            "composite_objective": round(obj, 5),
        }
        sweep_records.append(rec)
        print(
            f"--> [Calibrate {args.model_tag}] {cand['name']} ({manifest['modified_pct']:.4f}% weights): "
            f"pass={eval_out['summary']['pass_rate']:.4f} ({eval_out['summary']['pass_count']}/32), "
            f"partial={eval_out['summary']['mean_partial_score']:.4f}, "
            f"trunc={eval_out['summary']['truncation_rate']:.4f}, "
            f"mean_toks={eval_out['summary']['mean_generated_tokens']:.1f}, obj={obj:.4f}",
            flush=True,
        )
        if (obj > best_obj + 1e-6) or (
            abs(obj - best_obj) <= 1e-6
            and best_rec is not None
            and eval_out["summary"]["mean_generated_tokens"] < best_rec[2]["summary"]["mean_generated_tokens"]
        ):
            best_obj = obj
            best_rec = (cand, cdir, eval_out)

    # 4. Promote winning candidate to frozen CleanWSP model directory
    win_cand, win_dir, win_eval = best_rec
    final_wsp_dir = os.path.join(STUDY_ROOT, "models", f"Qwen3-{args.model_tag}-CleanWSP")
    if os.path.exists(final_wsp_dir):
        shutil.rmtree(final_wsp_dir)
    shutil.copytree(win_dir, final_wsp_dir)

    # Save diagnostic trace of winner
    with open(
        os.path.join(STUDY_ROOT, "results", f"diag_wsp_{args.model_tag}_greedy.json"),
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(win_eval, f, indent=2, ensure_ascii=False)

    # 5. Build matched-sparsity Random-Column Negative Control checkpoint
    rand_dir = os.path.join(STUDY_ROOT, "models", f"Qwen3-{args.model_tag}-RandomCtrl")
    if os.path.exists(rand_dir):
        shutil.rmtree(rand_dir)
    rand_manifest = save_surgical_checkpoint(
        base_model_path=args.base_model,
        output_dir=rand_dir,
        analysis=analysis,
        target_layers=win_cand["layers"],
        num_cols=win_cand["cols"],
        alpha=win_cand["alpha"],
        layer_alpha_scale=win_cand["layer_scale"],
        random_control=True,
    )
    rand_eval = evaluate_suite(
        model_path=rand_dir,
        tasks=diag_tasks,
        do_sample=False,
        max_new_tokens=2048,
        batch_size=16,
        label=f"Diag-{args.model_tag}-RandomCtrl",
    )
    with open(
        os.path.join(STUDY_ROOT, "results", f"diag_randctrl_{args.model_tag}_greedy.json"),
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(rand_eval, f, indent=2, ensure_ascii=False)

    shutil.rmtree(tmp_cand_root, ignore_errors=True)

    calib_summary = {
        "model_tag": args.model_tag,
        "base_diag_summary": diag_base["summary"],
        "selected_candidate": {
            "name": win_cand["name"],
            "layers": win_cand["layers"],
            "cols": win_cand["cols"],
            "alpha": win_cand["alpha"],
            "layer_scale": {str(k): v for k, v in win_cand["layer_scale"].items()},
        },
        "selected_wsp_dir": final_wsp_dir,
        "random_ctrl_dir": rand_dir,
        "random_ctrl_diag_summary": rand_eval["summary"],
        "random_ctrl_manifest": rand_manifest,
        "candidate_sweep": sweep_records,
    }
    with open(
        os.path.join(STUDY_ROOT, "results", f"wsp_calibration_sweep_{args.model_tag}.json"),
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(calib_summary, f, indent=2)

    print(f"\n=== SELECTED WINNER FOR Qwen3-{args.model_tag}: {win_cand['name']} ===", flush=True)
    print(json.dumps(win_eval["summary"], indent=2), flush=True)


if __name__ == "__main__":
    main()
