"""
Post-Experiment Aggregator:
  1. Computes paired statistical tests (10,000-resample Bootstrap 95% CIs, Exact McNemar, Wilcoxon)
     and writes `results/statistical_summary.json`.
  2. Generates all 6 figures (`plots/fig1..fig6.png`).
  3. Builds human-inspectable markdown workbooks (`outputs_for_review/INDEX.md` + `01..09.md`)
     with full prompts, rubrics, scores, timings, <think> traces, final answers, and sandbox transcripts.
  4. Builds a self-contained interactive side-by-side HTML explorer (`viewer/evaluation_explorer.html`).
"""

import html
import json
import os

from generate_plots import (
    DOMAIN_ORDER,
    PLOTS_DIR,
    plot_fig1_domain_accuracy,
    plot_fig2_loop_and_tokens,
    plot_fig3_speed_and_throughput,
    plot_fig4_mechanistic_layers,
    plot_fig5_ablation_and_controls,
    plot_fig6_blind_generalization,
)
from stats_utils import compare_paired_runs

STUDY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(STUDY_ROOT, "data")
RESULTS_DIR = os.path.join(STUDY_ROOT, "results")
REVIEW_DIR = os.path.join(STUDY_ROOT, "outputs_for_review")
VIEWER_DIR = os.path.join(STUDY_ROOT, "viewer")

DOMAIN_TITLES = {
    "math_reasoning": ("01_math_reasoning.md", "01 — Competition Mathematics & Algebraic Reasoning"),
    "logic_puzzles": ("02_logic_puzzles.md", "02 — Deductive Logic & Constraint Satisfaction"),
    "code_generation": ("03_code_generation.md", "03 — Python Algorithm & Data-Structure Synthesis (Unit-Tested)"),
    "instruction_following": ("04_instruction_following.md", "04 — Strict Multi-Constraint Instruction Following (IFEval-Style)"),
    "computer_usage": ("05_computer_usage.md", "05 — Computer Usage: Live CLI/File Sandbox & GUI Agent Tasks"),
    "scientific_reasoning": ("06_scientific_reasoning.md", "06 — Quantitative Physics, Chemistry, Genetics & Systems"),
    "data_extraction": ("07_data_extraction.md", "07 — Messy Semi-Structured Log/Table -> Strict JSON Extraction"),
    "creative_and_synthesis": ("08_creative_and_synthesis.md", "08 — Constrained Technical Writing, Summarization & Planning"),
}


def load_json(path: str) -> dict | list:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def summarize_gold(task: dict) -> str:
    atype = task["answer_type"]
    if atype in ("exact_number", "approx_number", "choice_or_exact"):
        return f"`{task.get('gold')}` (type: `{atype}`)"
    if atype == "python_code":
        return f"Unit-tested function `{task.get('entry_point')}(...)` against isolated Python assertions"
    if atype == "instruction_constraints":
        return f"Programmatic constraint suite: `{json.dumps(task.get('constraints', []))}`"
    if atype == "json_schema":
        return f"Exact JSON target: `{json.dumps(task.get('expected_json'))}`"
    if atype == "cu_gui_action":
        return f"Expected GUI Action JSON: `{json.dumps(task.get('expected_action'))}`"
    if atype == "cu_live_sandbox":
        return f"Live TemporaryDirectory state check: `{json.dumps(task.get('sandbox_check'))}`"
    if atype == "synthesis_rubric":
        return f"Multi-criteria synthesis rubric: `{json.dumps(task.get('rubric'))}`"
    return f"`{atype}`"


def format_trace_md(label: str, rec: dict) -> str:
    status = "PASS" if rec["passed"] else ("TRUNCATED" if rec["hit_token_limit"] else "FAIL")
    think = rec.get("think_text", "") or "(empty)"
    final = rec.get("final_text", "") or "(empty — never exited <think> block!)"
    if len(think) > 3500:
        think_disp = (
            think[:1750]
            + f"\n\n... [SNIPPED {len(think) - 3200} CHARS OF REPETITIVE MIDDLE TRACE — FULL JSON IN results/] ...\n\n"
            + think[-1450:]
        )
    else:
        think_disp = think

    lines = [
        f"#### {label} — **{status}** (`score={rec['score']:.2f}`, `tokens={rec['generated_tokens']}` [`think={rec['think_tokens']}`, `ans={rec['answer_tokens']}`], `doubt={rec['doubt_marker_count']}`, `reason={rec['reason']}`)",
        "",
        "**Final User-Visible Output:**",
        "````text",
        final,
        "````",
    ]
    if "sandbox_final_files" in rec:
        lines.append("")
        lines.append("<details><summary>Inspect Live Sandbox Final Files & Multi-Turn Transcript</summary>")
        lines.append("")
        lines.append("```json")
        lines.append(json.dumps({
            "turn_logs": rec.get("turn_logs", []),
            "sandbox_final_files": rec.get("sandbox_final_files", {}),
        }, indent=2, ensure_ascii=False)[:5000])
        lines.append("```")
        lines.append("</details>")

    lines.extend([
        "",
        f"<details><summary>Inspect Internal <code>&lt;think&gt;</code> Reasoning Trace ({rec['think_tokens']} tokens, closed={rec['closed_think']})</summary>",
        "",
        "````text",
        think_disp,
        "````",
        "</details>",
        "",
    ])
    return "\n".join(lines)


def build_review_markdown_files(
    paired_tasks: list[dict],
    blind_tasks: list[dict],
    paired_runs: dict,
    blind_runs: dict,
    stats_all: dict,
):
    os.makedirs(REVIEW_DIR, exist_ok=True)
    idx_maps = {k: {r["task_id"]: r for r in v["results"]} for k, v in paired_runs.items()}
    blind_maps = {k: {r["task_id"]: r for r in v["results"]} for k, v in blind_runs.items()}

    # 1. Domain files 01..08 for Paired Suite
    for dom in DOMAIN_ORDER:
        fname, heading = DOMAIN_TITLES[dom]
        d_tasks = [t for t in paired_tasks if t["domain"] == dom]
        g06 = stats_all["paired_0.6B_greedy"]["by_domain"][dom]
        s06 = stats_all["paired_0.6B_sampled"]["by_domain"][dom]
        g17 = stats_all["paired_1.7B_greedy"]["by_domain"][dom]
        s17 = stats_all["paired_1.7B_sampled"]["by_domain"][dom]

        md = [
            f"# {heading}",
            "",
            "## Domain Summary (Held-Out Paired Suite, `n = 8` Tasks)",
            "",
            "| Model & Decoding | Base Pass Rate | CleanWSP Pass Rate | Delta | Base Mean Tokens | CleanWSP Mean Tokens | Base Trunc Rate | CleanWSP Trunc Rate |",
            "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
            f"| **Qwen3-0.6B (Greedy)** | {100*g06['pass_rate_before']:.1f}% | **{100*g06['pass_rate_after']:.1f}%** | `{100*g06['pass_rate_delta']:+.1f}%` | {g06['mean_tokens_before']:.0f} | **{g06['mean_tokens_after']:.0f}** | {100*g06['trunc_rate_before']:.1f}% | **{100*g06['trunc_rate_after']:.1f}%** |",
            f"| **Qwen3-0.6B (Sampled T=0.6)** | {100*s06['pass_rate_before']:.1f}% | **{100*s06['pass_rate_after']:.1f}%** | `{100*s06['pass_rate_delta']:+.1f}%` | {s06['mean_tokens_before']:.0f} | **{s06['mean_tokens_after']:.0f}** | {100*s06['trunc_rate_before']:.1f}% | **{100*s06['trunc_rate_after']:.1f}%** |",
            f"| **Qwen3-1.7B (Greedy)** | {100*g17['pass_rate_before']:.1f}% | **{100*g17['pass_rate_after']:.1f}%** | `{100*g17['pass_rate_delta']:+.1f}%` | {g17['mean_tokens_before']:.0f} | **{g17['mean_tokens_after']:.0f}** | {100*g17['trunc_rate_before']:.1f}% | **{100*g17['trunc_rate_after']:.1f}%** |",
            f"| **Qwen3-1.7B (Sampled T=0.6)** | {100*s17['pass_rate_before']:.1f}% | **{100*s17['pass_rate_after']:.1f}%** | `{100*s17['pass_rate_delta']:+.1f}%` | {s17['mean_tokens_before']:.0f} | **{s17['mean_tokens_after']:.0f}** | {100*s17['trunc_rate_before']:.1f}% | **{100*s17['trunc_rate_after']:.1f}%** |",
            "",
            "---",
            "",
        ]

        for t in d_tasks:
            tid = t["id"]
            md.extend([
                f"## Task `{tid}`: {t['title']} (`difficulty={t['difficulty']}`)",
                "",
                f"- **Verification Specification:** {summarize_gold(t)}",
                "",
                "### Verbatim Prompt",
                "````text",
                t["prompt"],
                "````",
                "",
                "### Telemetry Comparison Matrix",
                "",
                "| Run Variant | Result | Score | Gen Tokens (`<think>` / Ans) | Doubt Markers | Batch Decode `tok/s` | Grading Note |",
                "| :--- | :---: | :---: | :---: | :---: | :---: | :--- |",
            ])
            for vkey, vname in [
                ("base_0.6B_greedy", "0.6B Base (Greedy)"),
                ("wsp_0.6B_greedy", "**0.6B CleanWSP (Greedy)**"),
                ("base_0.6B_sampled", "0.6B Base (Sampled)"),
                ("wsp_0.6B_sampled", "**0.6B CleanWSP (Sampled)**"),
                ("base_1.7B_greedy", "1.7B Base (Greedy)"),
                ("wsp_1.7B_greedy", "**1.7B CleanWSP (Greedy)**"),
                ("base_1.7B_sampled", "1.7B Base (Sampled)"),
                ("wsp_1.7B_sampled", "**1.7B CleanWSP (Sampled)**"),
            ]:
                r = idx_maps[vkey][tid]
                res_badge = "PASS" if r["passed"] else ("TRUNC" if r["hit_token_limit"] else "FAIL")
                md.append(
                    f"| {vname} | `{res_badge}` | {r['score']:.2f} | {r['generated_tokens']} ({r['think_tokens']} / {r['answer_tokens']}) | "
                    f"{r['doubt_marker_count']} | {r['decode_tok_per_s']:.1f} | `{r['reason'][:70]}` |"
                )
            md.append("")
            md.append("### Side-by-Side Model Outputs (Greedy Decoding)")
            md.append("")
            md.append(format_trace_md("Qwen3-0.6B — BEFORE (Untouched Base)", idx_maps["base_0.6B_greedy"][tid]))
            md.append(format_trace_md("Qwen3-0.6B — AFTER (CleanWSP Reweighted)", idx_maps["wsp_0.6B_greedy"][tid]))
            md.append(format_trace_md("Qwen3-1.7B — BEFORE (Untouched Base)", idx_maps["base_1.7B_greedy"][tid]))
            md.append(format_trace_md("Qwen3-1.7B — AFTER (CleanWSP Reweighted)", idx_maps["wsp_1.7B_greedy"][tid]))
            md.append("---")
            md.append("")

        with open(os.path.join(REVIEW_DIR, fname), "w", encoding="utf-8") as f:
            f.write("\n".join(md))

    # 2. Blind Post-Only Suite file 09
    bg06 = stats_all["blind_0.6B_greedy"]["overall_pass_rate"]
    bs06 = stats_all["blind_0.6B_sampled"]["overall_pass_rate"]
    bg17 = stats_all["blind_1.7B_greedy"]["overall_pass_rate"]
    bs17 = stats_all["blind_1.7B_sampled"]["overall_pass_rate"]
    md9 = [
        "# 09 — Locked Single-Shot Blind Post-Only Suite (`n = 32` Tasks Across All 8 Domains)",
        "",
        "> **Zero-Leakage Guarantee:** Neither the Base models nor the CleanWSP weights were ever run on or tuned against any task in this file prior to freezing `Qwen3-0.6B-CleanWSP` and `Qwen3-1.7B-CleanWSP`.",
        "",
        "| Model & Decoding | Base Pass Rate | CleanWSP Pass Rate | Delta (95% Bootstrap CI) |",
        "| :--- | :---: | :---: | :---: |",
        f"| **Qwen3-0.6B (Greedy)** | {100*bg06['mean_before']:.1f}% | **{100*bg06['mean_after']:.1f}%** | `{100*bg06['delta']:+.1f}%` (`[{100*bg06['delta_ci95'][0]:+.1f}%, {100*bg06['delta_ci95'][1]:+.1f}%]`) |",
        f"| **Qwen3-0.6B (Sampled T=0.6)** | {100*bs06['mean_before']:.1f}% | **{100*bs06['mean_after']:.1f}%** | `{100*bs06['delta']:+.1f}%` (`[{100*bs06['delta_ci95'][0]:+.1f}%, {100*bs06['delta_ci95'][1]:+.1f}%]`) |",
        f"| **Qwen3-1.7B (Greedy)** | {100*bg17['mean_before']:.1f}% | **{100*bg17['mean_after']:.1f}%** | `{100*bg17['delta']:+.1f}%` (`[{100*bg17['delta_ci95'][0]:+.1f}%, {100*bg17['delta_ci95'][1]:+.1f}%]`) |",
        f"| **Qwen3-1.7B (Sampled T=0.6)** | {100*bs17['mean_before']:.1f}% | **{100*bs17['mean_after']:.1f}%** | `{100*bs17['delta']:+.1f}%` (`[{100*bs17['delta_ci95'][0]:+.1f}%, {100*bs17['delta_ci95'][1]:+.1f}%]`) |",
        "",
        "---",
        "",
    ]
    for t in blind_tasks:
        tid = t["id"]
        md9.extend([
            f"## Task `{tid}` ({t['domain']}): {t['title']} (`difficulty={t['difficulty']}`)",
            f"- **Verification Specification:** {summarize_gold(t)}",
            "",
            "````text",
            t["prompt"],
            "````",
            "",
            format_trace_md("Qwen3-0.6B Base (Greedy)", blind_maps["base_0.6B_greedy"][tid]),
            format_trace_md("Qwen3-0.6B CleanWSP (Greedy)", blind_maps["wsp_0.6B_greedy"][tid]),
            format_trace_md("Qwen3-1.7B Base (Greedy)", blind_maps["base_1.7B_greedy"][tid]),
            format_trace_md("Qwen3-1.7B CleanWSP (Greedy)", blind_maps["wsp_1.7B_greedy"][tid]),
            "---",
            "",
        ])
    with open(os.path.join(REVIEW_DIR, "09_blind_post_suite.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md9))

    # 3. Master INDEX.md
    pg06 = stats_all["paired_0.6B_greedy"]["overall_pass_rate"]
    ps06 = stats_all["paired_0.6B_sampled"]["overall_pass_rate"]
    pg17 = stats_all["paired_1.7B_greedy"]["overall_pass_rate"]
    ps17 = stats_all["paired_1.7B_sampled"]["overall_pass_rate"]

    idx_md = [
        "# Human-Inspectable Multi-Domain Test Suite & Model Outputs (`CleanWSP` vs. `Base`)",
        "",
        "This directory contains **every prompt, verification rubric, quantitative score, timing telemetry record, internal `<think>` trace, live computer-usage sandbox log, and final user-visible output** across all held-out evaluation tasks so you can inspect and audit the models directly.",
        "",
        "- **Interactive Side-by-Side Browser:** Open [`../viewer/evaluation_explorer.html`](../viewer/evaluation_explorer.html) in any browser to filter by domain, model size, decoding strategy, or `Fail -> Pass` rescued tasks.",
        "- **Raw Machine-Readable JSON Traces:** Complete untruncated JSON logs live in [`../results/`](../results/).",
        "",
        "## Overall Held-Out Summary",
        "",
        "| Suite & Split | Model & Decoding | Base Pass Rate | CleanWSP Pass Rate | Net Gain (95% CI) | McNemar `p` |",
        "| :--- | :--- | :---: | :---: | :---: | :---: |",
        f"| **Paired Held-Out (`n=64`)** | `Qwen3-0.6B` (Greedy) | {100*pg06['mean_before']:.1f}% | **{100*pg06['mean_after']:.1f}%** | `{100*pg06['delta']:+.1f}%` (`[{100*pg06['delta_ci95'][0]:+.1f}%, {100*pg06['delta_ci95'][1]:+.1f}%]`) | `{stats_all['paired_0.6B_greedy']['mcnemar_transition']['mcnemar_exact_p']:.6f}` |",
        f"| **Paired Held-Out (`n=64`)** | `Qwen3-0.6B` (Sampled `T=0.6`) | {100*ps06['mean_before']:.1f}% | **{100*ps06['mean_after']:.1f}%** | `{100*ps06['delta']:+.1f}%` (`[{100*ps06['delta_ci95'][0]:+.1f}%, {100*ps06['delta_ci95'][1]:+.1f}%]`) | `{stats_all['paired_0.6B_sampled']['mcnemar_transition']['mcnemar_exact_p']:.6f}` |",
        f"| **Paired Held-Out (`n=64`)** | `Qwen3-1.7B` (Greedy) | {100*pg17['mean_before']:.1f}% | **{100*pg17['mean_after']:.1f}%** | `{100*pg17['delta']:+.1f}%` (`[{100*pg17['delta_ci95'][0]:+.1f}%, {100*pg17['delta_ci95'][1]:+.1f}%]`) | `{stats_all['paired_1.7B_greedy']['mcnemar_transition']['mcnemar_exact_p']:.6f}` |",
        f"| **Paired Held-Out (`n=64`)** | `Qwen3-1.7B` (Sampled `T=0.6`) | {100*ps17['mean_before']:.1f}% | **{100*ps17['mean_after']:.1f}%** | `{100*ps17['delta']:+.1f}%` (`[{100*ps17['delta_ci95'][0]:+.1f}%, {100*ps17['delta_ci95'][1]:+.1f}%]`) | `{stats_all['paired_1.7B_sampled']['mcnemar_transition']['mcnemar_exact_p']:.6f}` |",
        f"| **Blind Post-Only (`n=32`)** | `Qwen3-0.6B` (Greedy) | {100*bg06['mean_before']:.1f}% | **{100*bg06['mean_after']:.1f}%** | `{100*bg06['delta']:+.1f}%` (`[{100*bg06['delta_ci95'][0]:+.1f}%, {100*bg06['delta_ci95'][1]:+.1f}%]`) | `{stats_all['blind_0.6B_greedy']['mcnemar_transition']['mcnemar_exact_p']:.6f}` |",
        f"| **Blind Post-Only (`n=32`)** | `Qwen3-1.7B` (Greedy) | {100*bg17['mean_before']:.1f}% | **{100*bg17['mean_after']:.1f}%** | `{100*bg17['delta']:+.1f}%` (`[{100*bg17['delta_ci95'][0]:+.1f}%, {100*bg17['delta_ci95'][1]:+.1f}%]`) | `{stats_all['blind_1.7B_greedy']['mcnemar_transition']['mcnemar_exact_p']:.6f}` |",
        "",
        "## Domain Workbooks",
        "",
        "| Workbook File | Domain | Tasks | 0.6B Greedy (`Base -> WSP`) | 1.7B Greedy (`Base -> WSP`) |",
        "| :--- | :--- | :---: | :---: | :---: |",
    ]
    for dom in DOMAIN_ORDER:
        fname, heading = DOMAIN_TITLES[dom]
        d06 = stats_all["paired_0.6B_greedy"]["by_domain"][dom]
        d17 = stats_all["paired_1.7B_greedy"]["by_domain"][dom]
        idx_md.append(
            f"| [`{fname}`](./{fname}) | {heading.split(' — ')[1]} | 8 | "
            f"{100*d06['pass_rate_before']:.1f}% → **{100*d06['pass_rate_after']:.1f}%** | "
            f"{100*d17['pass_rate_before']:.1f}% → **{100*d17['pass_rate_after']:.1f}%** |"
        )
    idx_md.append(
        f"| [`09_blind_post_suite.md`](./09_blind_post_suite.md) | Locked Single-Shot Blind Post-Only Suite (All 8 Domains) | 32 | "
        f"{100*bg06['mean_before']:.1f}% → **{100*bg06['mean_after']:.1f}%** | "
        f"{100*bg17['mean_before']:.1f}% → **{100*bg17['mean_after']:.1f}%** |"
    )
    with open(os.path.join(REVIEW_DIR, "INDEX.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(idx_md))


def build_interactive_html_viewer(
    paired_tasks: list[dict],
    blind_tasks: list[dict],
    paired_runs: dict,
    blind_runs: dict,
):
    os.makedirs(VIEWER_DIR, exist_ok=True)

    def slim_rec(r: dict) -> dict:
        t_txt = r.get("think_text", "")
        if len(t_txt) > 4500:
            t_txt = t_txt[:2400] + f"\n\n... [SNIPPED {len(t_txt)-4000} CHARS] ...\n\n" + t_txt[-1600:]
        return {
            "passed": r["passed"],
            "score": r["score"],
            "reason": r["reason"],
            "closed_think": r["closed_think"],
            "hit_token_limit": r["hit_token_limit"],
            "generated_tokens": r["generated_tokens"],
            "think_tokens": r["think_tokens"],
            "answer_tokens": r["answer_tokens"],
            "doubt_marker_count": r["doubt_marker_count"],
            "decode_tok_per_s": r["decode_tok_per_s"],
            "think_text": t_txt,
            "final_text": r.get("final_text", ""),
            "sandbox_final_files": r.get("sandbox_final_files"),
        }

    bundle = {"items": []}
    p_maps = {k: {r["task_id"]: r for r in v["results"]} for k, v in paired_runs.items()}
    b_maps = {k: {r["task_id"]: r for r in v["results"]} for k, v in blind_runs.items()}

    for split_name, t_list, r_maps in [
        ("paired", paired_tasks, p_maps),
        ("blind", blind_tasks, b_maps),
    ]:
        for t in t_list:
            tid = t["id"]
            bundle["items"].append({
                "split": split_name,
                "id": tid,
                "domain": t["domain"],
                "title": t["title"],
                "difficulty": t["difficulty"],
                "prompt": t["prompt"],
                "spec": summarize_gold(t),
                "runs": {
                    "0.6B_greedy_base": slim_rec(r_maps["base_0.6B_greedy"][tid]),
                    "0.6B_greedy_wsp": slim_rec(r_maps["wsp_0.6B_greedy"][tid]),
                    "0.6B_sampled_base": slim_rec(r_maps["base_0.6B_sampled"][tid]),
                    "0.6B_sampled_wsp": slim_rec(r_maps["wsp_0.6B_sampled"][tid]),
                    "1.7B_greedy_base": slim_rec(r_maps["base_1.7B_greedy"][tid]),
                    "1.7B_greedy_wsp": slim_rec(r_maps["wsp_1.7B_greedy"][tid]),
                    "1.7B_sampled_base": slim_rec(r_maps["base_1.7B_sampled"][tid]),
                    "1.7B_sampled_wsp": slim_rec(r_maps["wsp_1.7B_sampled"][tid]),
                },
            })

    json_payload = json.dumps(bundle, ensure_ascii=False).replace("</script>", "<\\/script>")
    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>CleanWSP Multi-Domain Evaluation Explorer (Qwen3-0.6B & Qwen3-1.7B)</title>
<style>
  :root {{
    --bg: #0f172a; --panel: #1e293b; --border: #334155; --text: #f1f5f9; --muted: #94a3b8;
    --pass: #16a34a; --fail: #dc2626; --trunc: #d97706; --accent: #3b82f6;
  }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); }}
  header {{ padding: 16px 24px; background: #020617; border-bottom: 1px solid var(--border); display: flex; flex-wrap: wrap; gap: 14px; align-items: center; justify-content: space-between; }}
  header h1 {{ margin: 0; font-size: 18px; }}
  .controls {{ display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }}
  select, input {{ background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 13px; }}
  .layout {{ display: grid; grid-template-columns: 320px 1fr; height: calc(100vh - 65px); }}
  .sidebar {{ border-right: 1px solid var(--border); overflow-y: auto; padding: 10px; }}
  .task-item {{ padding: 10px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; margin-bottom: 6px; background: rgba(30,41,59,0.55); }}
  .task-item:hover {{ border-color: var(--border); }}
  .task-item.active {{ border-color: var(--accent); background: var(--panel); }}
  .badge {{ display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; }}
  .b-pass {{ background: rgba(22,163,74,0.22); color: #4ade80; }}
  .b-fail {{ background: rgba(220,38,38,0.22); color: #f87171; }}
  .b-trunc {{ background: rgba(217,119,6,0.25); color: #fbbf24; }}
  .main {{ overflow-y: auto; padding: 20px 26px; }}
  .prompt-box {{ background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12.5px; margin-bottom: 16px; }}
  .compare-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }}
  .col-card {{ background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }}
  pre {{ margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, monospace; font-size: 12px; background: #0b1120; padding: 12px; border-radius: 6px; border: 1px solid #1e293b; max-height: 360px; overflow-y: auto; }}
  details summary {{ cursor: pointer; color: #93c5fd; font-size: 12.5px; font-weight: 600; margin-bottom: 6px; }}
  .stats-bar {{ font-size: 12.5px; color: var(--muted); }}
</style>
</head>
<body>
<header>
  <div>
    <h1>Clean-Room Weight-Space Programming — Side-by-Side Output Evaluator</h1>
    <div class="stats-bar" id="summaryBar">Loading...</div>
  </div>
  <div class="controls">
    <select id="selModel"><option value="0.6B">Qwen3-0.6B (596M)</option><option value="1.7B">Qwen3-1.7B (1.72B)</option></select>
    <select id="selDecode"><option value="greedy">Greedy (T=0)</option><option value="sampled">Sampled (T=0.6)</option></select>
    <select id="selSplit"><option value="all">All Held-Out (96)</option><option value="paired">Paired Suite (64)</option><option value="blind">Blind Post Suite (32)</option></select>
    <select id="selDomain">
      <option value="all">All 8 Domains</option>
      <option value="math_reasoning">Math Reasoning</option>
      <option value="logic_puzzles">Logic Puzzles</option>
      <option value="code_generation">Code Generation</option>
      <option value="instruction_following">Instruction Following</option>
      <option value="computer_usage">Computer Usage</option>
      <option value="scientific_reasoning">Scientific Reasoning</option>
      <option value="data_extraction">Data Extraction</option>
      <option value="creative_and_synthesis">Creative & Synthesis</option>
    </select>
    <select id="selTrans">
      <option value="all">All Transitions</option>
      <option value="fp">Rescued (Fail → Pass)</option>
      <option value="pp">Retained (Pass → Pass)</option>
      <option value="pf">Regressed (Pass → Fail)</option>
      <option value="ff">Unsolved (Fail → Fail)</option>
    </select>
  </div>
</header>
<div class="layout">
  <div class="sidebar" id="taskList"></div>
  <div class="main" id="detailPane"></div>
</div>
<script>
const DATA = {json_payload};
let currentId = null;

function badge(rec) {{
  if (rec.passed) return '<span class="badge b-pass">PASS</span>';
  if (rec.hit_token_limit) return '<span class="badge b-trunc">TRUNC 2048</span>';
  return '<span class="badge b-fail">FAIL</span>';
}}

function esc(s) {{
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}}

function getFiltered() {{
  const m = document.getElementById('selModel').value;
  const d = document.getElementById('selDecode').value;
  const sp = document.getElementById('selSplit').value;
  const dom = document.getElementById('selDomain').value;
  const tr = document.getElementById('selTrans').value;
  return DATA.items.filter(it => {{
    if (sp !== 'all' && it.split !== sp) return false;
    if (dom !== 'all' && it.domain !== dom) return false;
    const b = it.runs[`${{m}}_${{d}}_base`];
    const a = it.runs[`${{m}}_${{d}}_wsp`];
    if (tr === 'fp' && !(!b.passed && a.passed)) return false;
    if (tr === 'pp' && !(b.passed && a.passed)) return false;
    if (tr === 'pf' && !(b.passed && !a.passed)) return false;
    if (tr === 'ff' && !(!b.passed && !a.passed)) return false;
    return true;
  }});
}}

function render() {{
  const m = document.getElementById('selModel').value;
  const d = document.getElementById('selDecode').value;
  const list = getFiltered();
  const bPass = list.filter(x => x.runs[`${{m}}_${{d}}_base`].passed).length;
  const aPass = list.filter(x => x.runs[`${{m}}_${{d}}_wsp`].passed).length;
  document.getElementById('summaryBar').textContent =
    `Showing ${{list.length}} tasks | Base Pass: ${{bPass}}/${{list.length}} (${{list.length ? (100*bPass/list.length).toFixed(1) : 0}}%) → CleanWSP Pass: ${{aPass}}/${{list.length}} (${{list.length ? (100*aPass/list.length).toFixed(1) : 0}}%)`;

  const sb = document.getElementById('taskList');
  if (!list.length) {{
    sb.innerHTML = '<div style="padding:12px;color:#94a3b8;">No matching tasks.</div>';
    document.getElementById('detailPane').innerHTML = '';
    return;
  }}
  if (!currentId || !list.some(x => x.id === currentId)) currentId = list[0].id;
  sb.innerHTML = list.map(it => {{
    const b = it.runs[`${{m}}_${{d}}_base`];
    const a = it.runs[`${{m}}_${{d}}_wsp`];
    return `<div class="task-item ${{it.id===currentId?'active':''}}" onclick="selectTask('${{it.id}}')">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#94a3b8;margin-bottom:4px;">
        <span>${{esc(it.id)}} · ${{esc(it.domain)}}</span><span>${{esc(it.difficulty)}}</span>
      </div>
      <div style="font-weight:600;font-size:13px;margin-bottom:6px;">${{esc(it.title)}}</div>
      <div style="font-size:11.5px;">Base ${{badge(b)}} → WSP ${{badge(a)}}</div>
    </div>`;
  }}).join('');
  renderDetail(list.find(x => x.id === currentId));
}}

function selectTask(id) {{ currentId = id; render(); }}

function renderCard(title, r) {{
  const sbox = r.sandbox_final_files ? `<details><summary>Live Sandbox Final Files</summary><pre>${{esc(JSON.stringify(r.sandbox_final_files, null, 2))}}</pre></details>` : '';
  return `<div class="col-card">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <strong>${{esc(title)}}</strong> ${{badge(r)}}
    </div>
    <div class="stats-bar">
      Score: <b>${{r.score.toFixed(2)}}</b> · Tokens: <b>${{r.generated_tokens}}</b> (think ${{r.think_tokens}}, ans ${{r.answer_tokens}}) · Doubt: <b>${{r.doubt_marker_count}}</b> · Batch tok/s: <b>${{r.decode_tok_per_s.toFixed(1)}}</b>
      <br/>Check: <code>${{esc(r.reason)}}</code>
    </div>
    <div><div style="font-size:12px;color:#94a3b8;margin-bottom:4px;">Final User-Visible Output:</div>
    <pre>${{esc(r.final_text || '(empty — trapped in <think> until 2048 token ceiling!)')}}</pre></div>
    ${{sbox}}
    <details><summary>Inspect &lt;think&gt; Trace (${{r.think_tokens}} tokens, closed=${{r.closed_think}})</summary><pre>${{esc(r.think_text)}}</pre></details>
  </div>`;
}}

function renderDetail(it) {{
  const m = document.getElementById('selModel').value;
  const d = document.getElementById('selDecode').value;
  const b = it.runs[`${{m}}_${{d}}_base`];
  const a = it.runs[`${{m}}_${{d}}_wsp`];
  document.getElementById('detailPane').innerHTML = `
    <h2 style="margin-top:0;">${{esc(it.id)}}: ${{esc(it.title)}} <span style="font-size:13px;color:#94a3b8;">(${{esc(it.split)}} · ${{esc(it.domain)}} · ${{esc(it.difficulty)}})</span></h2>
    <div style="font-size:12.5px;color:#cbd5e1;margin-bottom:10px;">Verification: ${{esc(it.spec)}}</div>
    <div class="prompt-box">${{esc(it.prompt)}}</div>
    <div class="compare-grid">
      ${{renderCard(`Qwen3-${{m}} BEFORE (Untouched Base, ${{d}})`, b)}}
      ${{renderCard(`Qwen3-${{m}} AFTER (CleanWSP Reweighted, ${{d}})`, a)}}
    </div>
  `;
}}

['selModel','selDecode','selSplit','selDomain','selTrans'].forEach(id => document.getElementById(id).addEventListener('change', render));
render();
</script>
</body>
</html>
"""
    with open(os.path.join(VIEWER_DIR, "evaluation_explorer.html"), "w", encoding="utf-8") as f:
        f.write(html_doc)


def main():
    os.makedirs(PLOTS_DIR, exist_ok=True)
    paired_tasks = load_json(os.path.join(DATA_DIR, "heldout_paired_suite.json"))
    blind_tasks = load_json(os.path.join(DATA_DIR, "heldout_blind_post_suite.json"))

    paired_runs = {
        "base_0.6B_greedy": load_json(os.path.join(RESULTS_DIR, "paired_base_0.6B_greedy.json")),
        "wsp_0.6B_greedy": load_json(os.path.join(RESULTS_DIR, "paired_wsp_0.6B_greedy.json")),
        "base_0.6B_sampled": load_json(os.path.join(RESULTS_DIR, "paired_base_0.6B_sampled.json")),
        "wsp_0.6B_sampled": load_json(os.path.join(RESULTS_DIR, "paired_wsp_0.6B_sampled.json")),
        "base_1.7B_greedy": load_json(os.path.join(RESULTS_DIR, "paired_base_1.7B_greedy.json")),
        "wsp_1.7B_greedy": load_json(os.path.join(RESULTS_DIR, "paired_wsp_1.7B_greedy.json")),
        "base_1.7B_sampled": load_json(os.path.join(RESULTS_DIR, "paired_base_1.7B_sampled.json")),
        "wsp_1.7B_sampled": load_json(os.path.join(RESULTS_DIR, "paired_wsp_1.7B_sampled.json")),
    }
    ctrl_paired = {
        "0.6B": load_json(os.path.join(RESULTS_DIR, "paired_randctrl_0.6B_greedy.json")),
        "1.7B": load_json(os.path.join(RESULTS_DIR, "paired_randctrl_1.7B_greedy.json")),
    }
    blind_runs = {
        "base_0.6B_greedy": load_json(os.path.join(RESULTS_DIR, "blind_base_0.6B_greedy.json")),
        "wsp_0.6B_greedy": load_json(os.path.join(RESULTS_DIR, "blind_wsp_0.6B_greedy.json")),
        "base_0.6B_sampled": load_json(os.path.join(RESULTS_DIR, "blind_base_0.6B_sampled.json")),
        "wsp_0.6B_sampled": load_json(os.path.join(RESULTS_DIR, "blind_wsp_0.6B_sampled.json")),
        "base_1.7B_greedy": load_json(os.path.join(RESULTS_DIR, "blind_base_1.7B_greedy.json")),
        "wsp_1.7B_greedy": load_json(os.path.join(RESULTS_DIR, "blind_wsp_1.7B_greedy.json")),
        "base_1.7B_sampled": load_json(os.path.join(RESULTS_DIR, "blind_base_1.7B_sampled.json")),
        "wsp_1.7B_sampled": load_json(os.path.join(RESULTS_DIR, "blind_wsp_1.7B_sampled.json")),
    }
    diag_runs = {
        "base_0.6B": load_json(os.path.join(RESULTS_DIR, "diag_base_0.6B_greedy.json")),
        "wsp_0.6B": load_json(os.path.join(RESULTS_DIR, "diag_wsp_0.6B_greedy.json")),
        "base_1.7B": load_json(os.path.join(RESULTS_DIR, "diag_base_1.7B_greedy.json")),
        "wsp_1.7B": load_json(os.path.join(RESULTS_DIR, "diag_wsp_1.7B_greedy.json")),
    }

    mech_06 = load_json(os.path.join(RESULTS_DIR, "wsp_mechanistic_0.6B.json"))
    mech_17 = load_json(os.path.join(RESULTS_DIR, "wsp_mechanistic_1.7B.json"))
    calib_06 = load_json(os.path.join(RESULTS_DIR, "wsp_calibration_sweep_0.6B.json"))
    calib_17 = load_json(os.path.join(RESULTS_DIR, "wsp_calibration_sweep_1.7B.json"))
    speed_data = load_json(os.path.join(RESULTS_DIR, "speed_microbenchmark.json"))

    stats_all = {
        "paired_0.6B_greedy": compare_paired_runs(paired_runs["base_0.6B_greedy"], paired_runs["wsp_0.6B_greedy"]),
        "paired_0.6B_sampled": compare_paired_runs(paired_runs["base_0.6B_sampled"], paired_runs["wsp_0.6B_sampled"]),
        "paired_0.6B_randctrl": compare_paired_runs(paired_runs["base_0.6B_greedy"], ctrl_paired["0.6B"]),
        "paired_1.7B_greedy": compare_paired_runs(paired_runs["base_1.7B_greedy"], paired_runs["wsp_1.7B_greedy"]),
        "paired_1.7B_sampled": compare_paired_runs(paired_runs["base_1.7B_sampled"], paired_runs["wsp_1.7B_sampled"]),
        "paired_1.7B_randctrl": compare_paired_runs(paired_runs["base_1.7B_greedy"], ctrl_paired["1.7B"]),
        "blind_0.6B_greedy": compare_paired_runs(blind_runs["base_0.6B_greedy"], blind_runs["wsp_0.6B_greedy"]),
        "blind_0.6B_sampled": compare_paired_runs(blind_runs["base_0.6B_sampled"], blind_runs["wsp_0.6B_sampled"]),
        "blind_1.7B_greedy": compare_paired_runs(blind_runs["base_1.7B_greedy"], blind_runs["wsp_1.7B_greedy"]),
        "blind_1.7B_sampled": compare_paired_runs(blind_runs["base_1.7B_sampled"], blind_runs["wsp_1.7B_sampled"]),
        "diag_0.6B_greedy": compare_paired_runs(diag_runs["base_0.6B"], diag_runs["wsp_0.6B"]),
        "diag_1.7B_greedy": compare_paired_runs(diag_runs["base_1.7B"], diag_runs["wsp_1.7B"]),
    }

    with open(os.path.join(RESULTS_DIR, "statistical_summary.json"), "w", encoding="utf-8") as f:
        json.dump(stats_all, f, indent=2)
    print("[Aggregator] Saved statistical_summary.json")

    plot_fig1_domain_accuracy(stats_all)
    plot_fig2_loop_and_tokens(paired_runs)
    plot_fig3_speed_and_throughput(speed_data, paired_runs)
    plot_fig4_mechanistic_layers(mech_06, mech_17, calib_06, calib_17)
    plot_fig5_ablation_and_controls(calib_06, calib_17, ctrl_paired, paired_runs)
    plot_fig6_blind_generalization(stats_all)
    print("[Aggregator] Generated plots/fig1..fig6.png")

    build_review_markdown_files(paired_tasks, blind_tasks, paired_runs, blind_runs, stats_all)
    print("[Aggregator] Generated outputs_for_review/INDEX.md + 01..09.md")

    build_interactive_html_viewer(paired_tasks, blind_tasks, paired_runs, blind_runs)
    print("[Aggregator] Generated viewer/evaluation_explorer.html")


if __name__ == "__main__":
    main()
