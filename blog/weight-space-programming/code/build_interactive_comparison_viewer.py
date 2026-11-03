"""Builds both a Markdown and an interactive HTML Side-by-Side Before vs. After Output Evaluator."""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # project root (the scripts lived in <root>/scripts)
OUT_DIR = ROOT / "outputs"


def build_viewers():
    b06 = json.loads((OUT_DIR / "before" / "Qwen3-0.6B_before_results.json").read_text(encoding="utf-8"))
    a06 = json.loads((OUT_DIR / "after" / "Qwen3-0.6B-WSP_after_results.json").read_text(encoding="utf-8"))
    b17 = json.loads((OUT_DIR / "before" / "Qwen3-1.7B_before_results.json").read_text(encoding="utf-8"))
    a17 = json.loads((OUT_DIR / "after" / "Qwen3-1.7B-WSP_after_results.json").read_text(encoding="utf-8"))

    # 1. Build Side-by-Side Markdown Summary for All 30 Tasks
    md = [
        "# Side-by-Side Multi-Domain Evaluation Outputs (Before vs. After Weight-Space Programming)",
        "",
        "This document contains all **30 held-out evaluation tasks** across **6 domains** (`Mathematics`, `Deductive Logic`, `Software Engineering`, `Physical & Life Sciences`, `Instruction Following`, and `Computer Usage`), showing the exact prompt, token counts, latency, `<think>` behavior, and post-`</think>` final outputs for both **`Qwen3-0.6B`** and **`Qwen3-1.7B`** before and after Weight-Space Programming.",
        "",
        "## Quick Task-Level Summary Table",
        "",
        "| ID | Domain | Task Title | Qwen3-0.6B Before (Tok / Status) | Qwen3-0.6B After WSP (Tok / Status) | Qwen3-1.7B Before (Tok / Status) | Qwen3-1.7B After WSP (Tok / Status) |",
        "| :--- | :--- | :--- | :---: | :---: | :---: | :---: |",
    ]

    for i in range(len(b06["items"])):
        ib06 = b06["items"][i]
        ia06 = a06["items"][i]
        ib17 = b17["items"][i]
        ia17 = a17["items"][i]

        def fmt_cell(it):
            st = "PASS" if it["strict_correct"] else ("CUTOFF/LOOP" if it["hit_cutoff"] else "FAIL")
            return f"`{st}` ({it['total_tokens']} tok, {it['effective_single_stream_est_seconds']}s)"

        md.append(
            f"| `{ib06['id']}` | {ib06['domain']} | {ib06['title']} | {fmt_cell(ib06)} | **{fmt_cell(ia06)}** | {fmt_cell(ib17)} | **{fmt_cell(ia17)}** |"
        )

    md.append("\n---\n")

    for i in range(len(b06["items"])):
        ib06 = b06["items"][i]
        ia06 = a06["items"][i]
        ib17 = b17["items"][i]
        ia17 = a17["items"][i]

        md.extend([
            f"## {i+1}. [`{ib06['id']}`] {ib06['domain']} — {ib06['title']}",
            "",
            "### Prompt",
            "```text",
            ib06["prompt"],
            "```",
            "",
            f"### `Qwen3-0.6B`: Baseline (`{'PASS' if ib06['strict_correct'] else 'FAIL'}`, {ib06['total_tokens']} tok) vs. WSP Reweighted (`{'PASS' if ia06['strict_correct'] else 'FAIL'}`, {ia06['total_tokens']} tok)",
            f"- **Baseline (`Before`)**: {ib06['total_tokens']} tokens (`<think>`: {ib06['think_tokens']}, Answer: {ib06['answer_tokens']}), Cutoff: `{ib06['hit_cutoff']}`, Self-Doubt Triggers: `{ib06['wait_check_count']}` | Grade: `{ib06['grade_reason']}`",
            f"  - **Baseline Final Answer**: `{ib06['final_answer'][:300] if ib06['final_answer'] else '[NONE - Cutoff inside <think>]'}`",
            f"- **WSP Reweighted (`After`)**: {ia06['total_tokens']} tokens (`<think>`: {ia06['think_tokens']}, Answer: {ia06['answer_tokens']}), Cutoff: `{ia06['hit_cutoff']}`, Self-Doubt Triggers: `{ia06['wait_check_count']}` | Grade: `{ia06['grade_reason']}`",
            f"  - **After WSP Final Answer**: `{ia06['final_answer'][:300] if ia06['final_answer'] else '[NONE]'}`",
            "",
            f"### `Qwen3-1.7B`: Baseline (`{'PASS' if ib17['strict_correct'] else 'FAIL'}`, {ib17['total_tokens']} tok) vs. WSP Reweighted (`{'PASS' if ia17['strict_correct'] else 'FAIL'}`, {ia17['total_tokens']} tok)",
            f"- **Baseline (`Before`)**: {ib17['total_tokens']} tokens (`<think>`: {ib17['think_tokens']}, Answer: {ib17['answer_tokens']}), Cutoff: `{ib17['hit_cutoff']}`, Self-Doubt Triggers: `{ib17['wait_check_count']}` | Grade: `{ib17['grade_reason']}`",
            f"  - **Baseline Final Answer**: `{ib17['final_answer'][:300] if ib17['final_answer'] else '[NONE - Cutoff inside <think>]'}`",
            f"- **WSP Reweighted (`After`)**: {ia17['total_tokens']} tokens (`<think>`: {ia17['think_tokens']}, Answer: {ia17['answer_tokens']}), Cutoff: `{ia17['hit_cutoff']}`, Self-Doubt Triggers: `{ia17['wait_check_count']}` | Grade: `{ia17['grade_reason']}`",
            f"  - **After WSP Final Answer**: `{ia17['final_answer'][:300] if ia17['final_answer'] else '[NONE]'}`",
            "",
            "---",
            "",
        ])

    (OUT_DIR / "SIDE_BY_SIDE_COMPARISON.md").write_text("\n".join(md), encoding="utf-8")

    # 2. Build Interactive Self-Contained HTML Viewer
    cards_html = []
    for i in range(len(b06["items"])):
        ib06, ia06 = b06["items"][i], a06["items"][i]
        ib17, ia17 = b17["items"][i], a17["items"][i]

        def render_box(label, it):
            badge_cls = "pass" if it["strict_correct"] else ("cutoff" if it["hit_cutoff"] else "fail")
            badge_txt = "PASS" if it["strict_correct"] else ("CUTOFF LOOP" if it["hit_cutoff"] else "FAIL")
            ans_txt = html.escape(it["final_answer"] if it["final_answer"] else "[No Final Answer — Cutoff inside <think> loop]")
            think_txt = html.escape(it["thinking_trace"])
            return f"""
            <div class="model-box {badge_cls}-border">
              <div class="box-header">
                <strong>{html.escape(label)}</strong>
                <span class="badge {badge_cls}">{badge_txt}</span>
              </div>
              <div class="metrics">
                Tokens: <b>{it['total_tokens']}</b> (Think: {it['think_tokens']}, Ans: {it['answer_tokens']}) |
                Est. Latency: <b>{it['effective_single_stream_est_seconds']}s</b> |
                Self-Doubt (wait/check): <b>{it['wait_check_count']}</b>
              </div>
              <div class="grade-reason">{html.escape(it['grade_reason'])}</div>
              <details>
                <summary>View &lt;think&gt; Trace ({it['think_tokens']} tokens)</summary>
                <pre class="think-pre">{think_txt}</pre>
              </details>
              <div class="ans-label">Final Post-&lt;/think&gt; Output:</div>
              <pre class="ans-pre">{ans_txt}</pre>
            </div>
            """

        cards_html.append(f"""
        <div class="task-card" data-domain="{html.escape(ib06['domain'])}">
          <div class="task-header">
            <span class="task-id">{html.escape(ib06['id'])}</span>
            <span class="task-domain">{html.escape(ib06['domain'])}</span>
            <span class="task-title">{html.escape(ib06['title'])}</span>
          </div>
          <pre class="prompt-pre">{html.escape(ib06['prompt'])}</pre>
          <div class="grid-2">
            {render_box("Qwen3-0.6B — BEFORE (Baseline)", ib06)}
            {render_box("Qwen3-0.6B-WSP — AFTER (Reweighted)", ia06)}
          </div>
          <div class="grid-2" style="margin-top:10px;">
            {render_box("Qwen3-1.7B — BEFORE (Baseline)", ib17)}
            {render_box("Qwen3-1.7B-WSP — AFTER (Reweighted)", ia17)}
          </div>
        </div>
        """)

    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Weight-Space Programming — Before vs. After Multi-Domain Evaluator</title>
<style>
  body {{ font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }}
  h1 {{ margin-top: 0; color: #f8fafc; }}
  .summary-bar {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }}
  .stat-card {{ background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px; }}
  .stat-card h3 {{ margin: 0 0 6px 0; font-size: 14px; color: #94a3b8; }}
  .stat-card .val {{ font-size: 22px; font-weight: 700; color: #38bdf8; }}
  .task-card {{ background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 18px; margin-bottom: 20px; }}
  .task-header {{ display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }}
  .task-id {{ background: #334155; color: #f8fafc; padding: 3px 8px; border-radius: 6px; font-family: monospace; font-weight: 700; }}
  .task-domain {{ background: #0369a1; color: #e0f2fe; padding: 3px 10px; border-radius: 6px; font-size: 13px; font-weight: 600; }}
  .task-title {{ font-size: 17px; font-weight: 700; color: #f1f5f9; }}
  .prompt-pre {{ background: #0f172a; border: 1px solid #334155; padding: 12px; border-radius: 8px; white-space: pre-wrap; font-size: 13px; color: #cbd5e1; }}
  .grid-2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }}
  .model-box {{ background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 12px; }}
  .pass-border {{ border-left: 4px solid #10b981; }}
  .cutoff-border {{ border-left: 4px solid #f59e0b; }}
  .fail-border {{ border-left: 4px solid #ef4444; }}
  .box-header {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }}
  .badge {{ padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }}
  .badge.pass {{ background: #065f46; color: #6ee7b7; }}
  .badge.cutoff {{ background: #78350f; color: #fde68a; }}
  .badge.fail {{ background: #7f1d1d; color: #fca5a5; }}
  .metrics {{ font-size: 12px; color: #94a3b8; margin-bottom: 4px; }}
  .grade-reason {{ font-size: 12px; font-family: monospace; color: #cbd5e1; margin-bottom: 8px; }}
  .think-pre, .ans-pre {{ background: #1e293b; padding: 10px; border-radius: 6px; white-space: pre-wrap; font-size: 12px; max-height: 260px; overflow-y: auto; }}
  .ans-label {{ font-size: 12px; font-weight: 600; color: #94a3b8; margin-top: 8px; margin-bottom: 4px; }}
</style>
</head>
<body>
  <h1>Weight-Space Programming: Side-by-Side Multi-Domain Evaluation Viewer</h1>
  <div class="summary-bar">
    <div class="stat-card">
      <h3>Qwen3-0.6B Baseline → WSP</h3>
      <div class="val">{b06['strict_accuracy_pct']}% → {a06['strict_accuracy_pct']}%</div>
      <div class="metrics">Cutoffs: {b06['cutoff_rate_pct']}% → {a06['cutoff_rate_pct']}% | Avg Tok: {b06['avg_total_tokens']} → {a06['avg_total_tokens']}</div>
    </div>
    <div class="stat-card">
      <h3>Qwen3-1.7B Baseline → WSP</h3>
      <div class="val">{b17['strict_accuracy_pct']}% → {a17['strict_accuracy_pct']}%</div>
      <div class="metrics">Cutoffs: {b17['cutoff_rate_pct']}% → {a17['cutoff_rate_pct']}% | Avg Tok: {b17['avg_total_tokens']} → {a17['avg_total_tokens']}</div>
    </div>
    <div class="stat-card">
      <h3>Qwen3-0.6B Task Speed</h3>
      <div class="val">{b06['est_single_stream_avg_task_seconds']}s → {a06['est_single_stream_avg_task_seconds']}s / task</div>
      <div class="metrics">Raw Decode: {b06['single_stream_hardware_benchmark']['avg_single_stream_tok_per_s']} → {a06['single_stream_hardware_benchmark']['avg_single_stream_tok_per_s']} tok/s</div>
    </div>
    <div class="stat-card">
      <h3>Qwen3-1.7B Task Speed</h3>
      <div class="val">{b17['est_single_stream_avg_task_seconds']}s → {a17['est_single_stream_avg_task_seconds']}s / task</div>
      <div class="metrics">Raw Decode: {b17['single_stream_hardware_benchmark']['avg_single_stream_tok_per_s']} → {a17['single_stream_hardware_benchmark']['avg_single_stream_tok_per_s']} tok/s</div>
    </div>
  </div>
  {''.join(cards_html)}
</body>
</html>
"""
    (OUT_DIR / "side_by_side_comparison.html").write_text(html_doc, encoding="utf-8")
    print("Generated SIDE_BY_SIDE_COMPARISON.md and side_by_side_comparison.html")


if __name__ == "__main__":
    build_viewers()
