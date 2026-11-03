"""Re-evaluates grading metrics across all 4 saved evaluation files using graders.py."""
import json
from pathlib import Path
from graders import grade_task

ROOT = Path(__file__).resolve().parent.parent  # project root (the scripts lived in <root>/scripts)
SUITE = json.loads((ROOT / "benchmarks" / "multi_domain_test_suite.json").read_text(encoding="utf-8"))
TASK_MAP = {t["id"]: t for t in SUITE}

FILES = [
    ("Qwen3-0.6B", "before", ROOT / "outputs" / "before" / "Qwen3-0.6B_before_results.json"),
    ("Qwen3-0.6B-WSP", "after", ROOT / "outputs" / "after" / "Qwen3-0.6B-WSP_after_results.json"),
    ("Qwen3-1.7B", "before", ROOT / "outputs" / "before" / "Qwen3-1.7B_before_results.json"),
    ("Qwen3-1.7B-WSP", "after", ROOT / "outputs" / "after" / "Qwen3-1.7B-WSP_after_results.json"),
]

for label, stage, path in FILES:
    data = json.loads(path.read_text(encoding="utf-8"))
    for item in data["items"]:
        t = TASK_MAP[item["id"]]
        g = grade_task(t, item["raw_output"])
        item["strict_correct"] = g["strict_correct"]
        item["lenient_correct"] = g["lenient_correct"]
        item["closed_think"] = g["closed_think"]
        item["extracted_pred"] = g["extracted_pred"]
        item["grade_reason"] = g["grade_reason"]
        # If model closed </think> and produced a valid strict answer, it is not an unsolved cutoff loop
        if item["closed_think"] and item["strict_correct"]:
            item["hit_cutoff"] = False

    items = data["items"]
    n_total = len(items)
    data["strict_correct_count"] = sum(1 for x in items if x["strict_correct"])
    data["strict_accuracy_pct"] = round(100.0 * data["strict_correct_count"] / n_total, 2)
    data["lenient_correct_count"] = sum(1 for x in items if x["lenient_correct"])
    data["lenient_accuracy_pct"] = round(100.0 * data["lenient_correct_count"] / n_total, 2)
    data["cutoff_rate_pct"] = round(100.0 * sum(1 for x in items if x["hit_cutoff"]) / n_total, 2)
    data["closed_think_rate_pct"] = round(100.0 * sum(1 for x in items if x["closed_think"]) / n_total, 2)

    for dom in data["domain_breakdown"]:
        dom_items = [x for x in items if x["domain"] == dom]
        data["domain_breakdown"][dom].update({
            "strict_correct": sum(1 for x in dom_items if x["strict_correct"]),
            "strict_accuracy_pct": round(100.0 * sum(1 for x in dom_items if x["strict_correct"]) / len(dom_items), 2),
            "lenient_accuracy_pct": round(100.0 * sum(1 for x in dom_items if x["lenient_correct"]) / len(dom_items), 2),
            "cutoff_rate_pct": round(100.0 * sum(1 for x in dom_items if x["hit_cutoff"]) / len(dom_items), 2),
        })

    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(
        f"{label:16s} ({stage:6s}): Strict={data['strict_correct_count']:2d}/30 ({data['strict_accuracy_pct']:5.2f}%) | "
        f"ClosedThink={data['closed_think_rate_pct']:5.2f}% | Cutoff={data['cutoff_rate_pct']:5.2f}% | "
        f"AvgTok={data['avg_total_tokens']:6.1f} | AvgWaits={data['avg_wait_check_count']:4.2f}"
    )
    for dom, dstat in data["domain_breakdown"].items():
        print(f"   - {dom:24s}: {dstat['strict_correct']}/5 ({dstat['strict_accuracy_pct']:5.1f}%) | Cutoff={dstat['cutoff_rate_pct']:5.1f}% | AvgTok={dstat['avg_total_tokens']:6.1f}")
