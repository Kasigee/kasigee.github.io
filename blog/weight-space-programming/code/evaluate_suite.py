"""Multi-Domain Evaluation Runner with Per-Step Timing, Hardware Tok/s Profiling, and Output Saving."""
import argparse
import json
import time
from pathlib import Path
from typing import List, Dict, Any

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, StoppingCriteria, StoppingCriteriaList

from graders import grade_task, split_thinking_and_answer

ROOT = Path(__file__).resolve().parent.parent  # project root (the scripts lived in <root>/scripts)
SUITE_PATH = ROOT / "benchmarks" / "multi_domain_test_suite.json"


class PerSequenceTimer(StoppingCriteria):
    """Records the exact decode step and wall-clock timestamp when each sequence emits EOS."""

    def __init__(self, input_len: int, batch_size: int, eos_token_id: int, start_time: float):
        self.input_len = input_len
        self.batch_size = batch_size
        self.eos_token_id = eos_token_id
        self.start_time = start_time
        self.step_times: List[float] = []
        self.finish_step: Dict[int, int] = {}
        self.finish_time: Dict[int, float] = {}

    def __call__(self, input_ids: torch.LongTensor, scores: torch.FloatTensor, **kwargs) -> bool:
        now = time.perf_counter() - self.start_time
        step = input_ids.shape[1] - self.input_len
        self.step_times.append(now)
        last_tokens = input_ids[:, -1]
        for b in range(self.batch_size):
            if b not in self.finish_step and int(last_tokens[b].item()) == self.eos_token_id:
                self.finish_step[b] = step
                self.finish_time[b] = now
        return len(self.finish_step) == self.batch_size


def measure_single_stream_hardware_speed(
    model, tok, tasks: List[dict], max_new_tokens: int = 512
) -> Dict[str, Any]:
    """Measures exact single-stream (batch_size=1) TTFT, decode tok/s, and task latency on 6 representative tasks (1 per domain)."""
    # Pick 1 representative task per domain (first task of each domain)
    seen_domains = set()
    rep_tasks = []
    for t in tasks:
        if t["domain"] not in seen_domains:
            seen_domains.add(t["domain"])
            rep_tasks.append(t)
        if len(rep_tasks) >= 3:
            break
    hw_max_tokens = min(max_new_tokens, 256)

    # Warmup
    warm_prompt = tok.apply_chat_template(
        [{"role": "user", "content": "What is 2 + 2?"}],
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=True,
    )
    warm_in = tok(warm_prompt, return_tensors="pt").to("cuda:0")
    with torch.no_grad():
        model.generate(**warm_in, max_new_tokens=16, do_sample=False)
    torch.cuda.synchronize()

    per_task_speed = []
    for t in rep_tasks:
        prompt = tok.apply_chat_template(
            [{"role": "user", "content": t["prompt"]}],
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=True,
        )
        inp = tok(prompt, return_tensors="pt").to("cuda:0")
        in_len = inp["input_ids"].shape[1]

        # Measure TTFT (1st token prefill)
        torch.cuda.synchronize()
        t_prefill_0 = time.perf_counter()
        with torch.no_grad():
            _ = model.generate(**inp, max_new_tokens=1, do_sample=False, pad_token_id=tok.pad_token_id)
        torch.cuda.synchronize()
        ttft_ms = (time.perf_counter() - t_prefill_0) * 1000.0

        # Measure full generation with per-step timestamps
        torch.cuda.synchronize()
        t_start = time.perf_counter()
        timer = PerSequenceTimer(in_len, 1, tok.eos_token_id, t_start)
        with torch.no_grad():
            out = model.generate(
                **inp,
                max_new_tokens=hw_max_tokens,
                do_sample=False,
                pad_token_id=tok.pad_token_id,
                eos_token_id=tok.eos_token_id,
                stopping_criteria=StoppingCriteriaList([timer]),
            )
        torch.cuda.synchronize()
        total_wall_s = time.perf_counter() - t_start
        gen_toks = out.shape[1] - in_len
        decode_tok_per_s = gen_toks / max(total_wall_s, 1e-6)

        # Compute step latency curve across decode steps (early vs late context)
        step_deltas_ms = []
        for k in range(1, len(timer.step_times)):
            step_deltas_ms.append((timer.step_times[k] - timer.step_times[k - 1]) * 1000.0)
        early_ms_per_tok = sum(step_deltas_ms[:64]) / max(len(step_deltas_ms[:64]), 1) if step_deltas_ms else 0.0
        late_ms_per_tok = sum(step_deltas_ms[-64:]) / max(len(step_deltas_ms[-64:]), 1) if len(step_deltas_ms) >= 128 else early_ms_per_tok

        per_task_speed.append({
            "id": t["id"],
            "domain": t["domain"],
            "ttft_ms": round(ttft_ms, 2),
            "generated_tokens": int(gen_toks),
            "wall_clock_seconds": round(total_wall_s, 3),
            "single_stream_tok_per_s": round(decode_tok_per_s, 2),
            "early_ms_per_tok": round(early_ms_per_tok, 2),
            "late_ms_per_tok": round(late_ms_per_tok, 2),
        })

    avg_ttft = sum(x["ttft_ms"] for x in per_task_speed) / len(per_task_speed)
    avg_tok_s = sum(x["single_stream_tok_per_s"] for x in per_task_speed) / len(per_task_speed)
    avg_wall_s = sum(x["wall_clock_seconds"] for x in per_task_speed) / len(per_task_speed)
    total_gen_toks = sum(x["generated_tokens"] for x in per_task_speed)
    return {
        "avg_ttft_ms": round(avg_ttft, 2),
        "avg_single_stream_tok_per_s": round(avg_tok_s, 2),
        "avg_wall_clock_seconds_per_task": round(avg_wall_s, 3),
        "total_tokens_across_6_rep_tasks": total_gen_toks,
        "per_task_breakdown": per_task_speed,
    }


def evaluate_model(
    model_path: str,
    model_label: str,
    stage: str,
    max_new_tokens: int = 1024,
    batch_size: int = 10,
) -> Dict[str, Any]:
    tasks = json.loads(SUITE_PATH.read_text(encoding="utf-8"))
    print(f"\n==================================================================")
    print(f"Evaluating {model_label} ({stage}) on {len(tasks)} Multi-Domain Tasks")
    print(f"Model Path: {model_path} | max_new_tokens={max_new_tokens} | batch_size={batch_size}")
    print(f"==================================================================")

    tok = AutoTokenizer.from_pretrained(model_path, padding_side="left")
    if tok.pad_token_id is None:
        tok.pad_token_id = tok.eos_token_id

    model = AutoModelForCausalLM.from_pretrained(
        model_path, dtype=torch.bfloat16, device_map="cuda:0", attn_implementation="sdpa"
    )
    model.eval()

    # 1. Run Single-Stream Hardware Speed & Latency Microbenchmark (batch_size=1)
    print("-> Running Single-Stream Hardware Speed & KV-Cache Benchmark (batch_size=1)...")
    hw_speed = measure_single_stream_hardware_speed(model, tok, tasks, max_new_tokens=max_new_tokens)
    print(
        f"   Single-Stream Summary: TTFT={hw_speed['avg_ttft_ms']:.1f}ms | "
        f"Raw Decode={hw_speed['avg_single_stream_tok_per_s']:.2f} tok/s | "
        f"Avg Wall Time={hw_speed['avg_wall_clock_seconds_per_task']:.2f}s/task"
    )

    # 2. Run Full 30-Task Multi-Domain Benchmark in Batches
    all_item_results = []
    total_batch_wall_s = 0.0
    total_generated_tokens = 0

    for b_start in range(0, len(tasks), batch_size):
        batch_tasks = tasks[b_start : b_start + batch_size]
        prompts = [
            tok.apply_chat_template(
                [{"role": "user", "content": t["prompt"]}],
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=True,
            )
            for t in batch_tasks
        ]
        inputs = tok(prompts, return_tensors="pt", padding=True).to("cuda:0")
        in_len = inputs["input_ids"].shape[1]

        torch.cuda.synchronize()
        t0 = time.perf_counter()
        timer = PerSequenceTimer(in_len, len(batch_tasks), tok.eos_token_id, t0)
        with torch.no_grad():
            out = model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=False,
                pad_token_id=tok.pad_token_id,
                eos_token_id=tok.eos_token_id,
                stopping_criteria=StoppingCriteriaList([timer]),
            )
        torch.cuda.synchronize()
        batch_dt = time.perf_counter() - t0
        total_batch_wall_s += batch_dt

        for i, t in enumerate(batch_tasks):
            gen_ids = out[i][in_len:]
            if i in timer.finish_step:
                n_toks = timer.finish_step[i]
                seq_wall_s = timer.finish_time[i]
                hit_cutoff = False
            else:
                eos_pos = (gen_ids == tok.eos_token_id).nonzero(as_tuple=True)[0]
                if len(eos_pos) > 0:
                    n_toks = int(eos_pos[0].item()) + 1
                    hit_cutoff = False
                else:
                    n_toks = len(gen_ids)
                    hit_cutoff = True
                seq_wall_s = batch_dt

            actual_ids = gen_ids[:n_toks]
            total_generated_tokens += n_toks
            raw_text = tok.decode(actual_ids, skip_special_tokens=False)
            # Clean trailing <|im_end|> for grading
            clean_text = raw_text.replace("<|im_end|>", "").strip()

            think_part, ans_part, closed_think = split_thinking_and_answer(clean_text)
            think_toks = len(tok.encode(think_part, add_special_tokens=False)) if think_part else 0
            ans_toks = len(tok.encode(ans_part, add_special_tokens=False)) if ans_part else 0

            grade_info = grade_task(t, clean_text)
            wait_check_count = think_part.lower().count("wait") + think_part.lower().count("check")

            item_res = {
                "id": t["id"],
                "domain": t["domain"],
                "title": t["title"],
                "prompt": t["prompt"],
                "strict_correct": grade_info["strict_correct"],
                "lenient_correct": grade_info["lenient_correct"],
                "closed_think": grade_info["closed_think"],
                "hit_cutoff": hit_cutoff,
                "total_tokens": int(n_toks),
                "think_tokens": int(think_toks),
                "answer_tokens": int(ans_toks),
                "seq_wall_seconds": round(seq_wall_s, 3),
                "effective_single_stream_est_seconds": round(
                    n_toks / max(hw_speed["avg_single_stream_tok_per_s"], 1e-6), 3
                ),
                "think_8gram_rep_rate": grade_info["think_8gram_rep_rate"],
                "wait_check_count": int(wait_check_count),
                "extracted_pred": grade_info["extracted_pred"],
                "grade_reason": grade_info["grade_reason"],
                "thinking_trace": think_part,
                "final_answer": ans_part,
                "raw_output": clean_text,
            }
            all_item_results.append(item_res)
            status = "PASS" if item_res["strict_correct"] else ("LENIENT" if item_res["lenient_correct"] else "FAIL")
            print(
                f"  [{t['id']:7s} | {t['domain']:24s}] {status:7s} | tok={n_toks:4d} (think={think_toks:4d}, ans={ans_toks:3d}) "
                f"| cutoff={str(hit_cutoff):5s} | wait={wait_check_count:2d} | {grade_info['grade_reason'][:55]}"
            )

    # Aggregate statistics overall and by domain
    n_total = len(all_item_results)
    strict_acc = sum(1 for x in all_item_results if x["strict_correct"]) / n_total
    lenient_acc = sum(1 for x in all_item_results if x["lenient_correct"]) / n_total
    cutoff_rate = sum(1 for x in all_item_results if x["hit_cutoff"]) / n_total
    closed_think_rate = sum(1 for x in all_item_results if x["closed_think"]) / n_total
    avg_tokens = total_generated_tokens / n_total
    avg_think_tokens = sum(x["think_tokens"] for x in all_item_results) / n_total
    avg_ans_tokens = sum(x["answer_tokens"] for x in all_item_results) / n_total
    avg_rep8 = sum(x["think_8gram_rep_rate"] for x in all_item_results) / n_total
    avg_wait_check = sum(x["wait_check_count"] for x in all_item_results) / n_total
    batched_aggregate_tok_s = total_generated_tokens / max(total_batch_wall_s, 1e-6)
    est_single_stream_total_s = sum(x["effective_single_stream_est_seconds"] for x in all_item_results)

    domain_summary = {}
    for dom in sorted(list(set(x["domain"] for x in all_item_results))):
        dom_items = [x for x in all_item_results if x["domain"] == dom]
        domain_summary[dom] = {
            "count": len(dom_items),
            "strict_correct": sum(1 for x in dom_items if x["strict_correct"]),
            "strict_accuracy_pct": round(100.0 * sum(1 for x in dom_items if x["strict_correct"]) / len(dom_items), 2),
            "lenient_accuracy_pct": round(100.0 * sum(1 for x in dom_items if x["lenient_correct"]) / len(dom_items), 2),
            "cutoff_rate_pct": round(100.0 * sum(1 for x in dom_items if x["hit_cutoff"]) / len(dom_items), 2),
            "avg_total_tokens": round(sum(x["total_tokens"] for x in dom_items) / len(dom_items), 1),
            "avg_think_tokens": round(sum(x["think_tokens"] for x in dom_items) / len(dom_items), 1),
            "avg_est_latency_s": round(sum(x["effective_single_stream_est_seconds"] for x in dom_items) / len(dom_items), 2),
        }

    summary = {
        "model_label": model_label,
        "model_path": model_path,
        "stage": stage,
        "max_new_tokens": max_new_tokens,
        "num_tasks": n_total,
        "strict_correct_count": sum(1 for x in all_item_results if x["strict_correct"]),
        "strict_accuracy_pct": round(100.0 * strict_acc, 2),
        "lenient_correct_count": sum(1 for x in all_item_results if x["lenient_correct"]),
        "lenient_accuracy_pct": round(100.0 * lenient_acc, 2),
        "cutoff_rate_pct": round(100.0 * cutoff_rate, 2),
        "closed_think_rate_pct": round(100.0 * closed_think_rate, 2),
        "avg_total_tokens": round(avg_tokens, 1),
        "avg_think_tokens": round(avg_think_tokens, 1),
        "avg_answer_tokens": round(avg_ans_tokens, 1),
        "total_generated_tokens": int(total_generated_tokens),
        "avg_think_8gram_rep_rate": round(avg_rep8, 4),
        "avg_wait_check_count": round(avg_wait_check, 2),
        "batched_wall_clock_seconds": round(total_batch_wall_s, 2),
        "batched_aggregate_tok_per_s": round(batched_aggregate_tok_s, 2),
        "single_stream_hardware_benchmark": hw_speed,
        "est_single_stream_avg_task_seconds": round(est_single_stream_total_s / n_total, 2),
        "effective_correct_tasks_per_min_batched": round(
            sum(1 for x in all_item_results if x["strict_correct"]) / (total_batch_wall_s / 60.0), 2
        ),
        "domain_breakdown": domain_summary,
        "items": all_item_results,
    }

    out_dir = ROOT / "outputs" / stage
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"{model_label}_{stage}_results.json"
    md_path = out_dir / f"{model_label}_{stage}_outputs.md"

    json_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    # Write clean human-readable Markdown file of all 30 prompts & outputs for user evaluation
    md_lines = [
        f"# Evaluation Outputs: {model_label} ({stage.upper()})",
        "",
        f"- **Strict Accuracy**: {summary['strict_correct_count']}/{n_total} ({summary['strict_accuracy_pct']}%)",
        f"- **Lenient Accuracy**: {summary['lenient_correct_count']}/{n_total} ({summary['lenient_accuracy_pct']}%)",
        f"- **Cutoff / Loop Rate**: {summary['cutoff_rate_pct']}% (Closed `</think>`: {summary['closed_think_rate_pct']}%)",
        f"- **Avg Tokens / Task**: {summary['avg_total_tokens']} (Think: {summary['avg_think_tokens']}, Answer: {summary['avg_answer_tokens']})",
        f"- **Single-Stream Decode Throughput**: {hw_speed['avg_single_stream_tok_per_s']} tok/s (TTFT: {hw_speed['avg_ttft_ms']} ms)",
        f"- **Batched Aggregate Throughput**: {summary['batched_aggregate_tok_per_s']} tok/s (Total Suite Wall Time: {summary['batched_wall_clock_seconds']} s)",
        "",
        "---",
        "",
    ]
    for item in all_item_results:
        badge = "PASS" if item["strict_correct"] else ("LENIENT_PASS" if item["lenient_correct"] else "FAIL")
        md_lines.extend([
            f"## [{item['id']}] {item['domain']} — {item['title']} (`{badge}`)",
            f"- **Tokens**: {item['total_tokens']} total ({item['think_tokens']} `<think>`, {item['answer_tokens']} answer) | **Cutoff**: `{item['hit_cutoff']}` | **Self-Doubt Triggers (`wait`/`check`)**: {item['wait_check_count']}",
            f"- **Grade Details**: `{item['grade_reason']}`",
            "",
            "### Prompt",
            "```text",
            item["prompt"],
            "```",
            "",
            "### `<think>` Trace",
            "```text",
            item["thinking_trace"][:2000] + ("\n... [truncated in markdown; full text in JSON]" if len(item["thinking_trace"]) > 2000 else ""),
            "```",
            "",
            "### Final Answer (Post-`</think>`)",
            "```text",
            item["final_answer"] if item["final_answer"] else "[NONE — Model failed to close </think> before token limit]",
            "```",
            "",
            "---",
            "",
        ])
    md_path.write_text("\n".join(md_lines), encoding="utf-8")

    del model
    torch.cuda.empty_cache()
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--model-label", required=True)
    parser.add_argument("--stage", choices=["before", "after"], required=True)
    parser.add_argument("--max-new-tokens", type=int, default=1024)
    parser.add_argument("--batch-size", type=int, default=10)
    args = parser.parse_args()
    evaluate_model(args.model_path, args.model_label, args.stage, args.max_new_tokens, args.batch_size)
