"""Build traces.json (32 blind single-shot tasks) and traces_paired.json (64 paired held-out tasks)
for the follow-up post's multi-condition trace explorer.

Usage:
    python make_traces.py <cleanroom_wsp_study_root> <blog_post_dir>

Exports verbatim outputs and strict post-</think> metrics across:
  - Base (2,048 · 1x), CleanWSP (2,048 · 1x), No-Thinking (2,048)
  - Base (4,096 · 2x / 4x-Argon), CleanWSP (4,096 · 2x / 4x-Argon)
  - Base (8,192 · 4x Carbon), CleanWSP (8,192 · 4x Carbon)
  - 0.6B CleanWSP Gentle alpha=2.0 (2,048)
All local filesystem paths in source metadata are omitted.
"""
import json
import os
import re
import sys

CJK_RE = re.compile(r"[\u4e00-\u9fff]")

DOMAIN_LABELS = {
    "math_reasoning": "Mathematical reasoning",
    "logic_puzzles": "Deductive logic",
    "code_generation": "Software engineering (subprocess unit tests)",
    "scientific_reasoning": "Physical & life sciences",
    "data_extraction": "Strict JSON data extraction",
    "instruction_following": "Constrained instruction following",
    "computer_usage": "Multi-turn sandboxed computer usage",
    "creative_and_synthesis": "Technical synthesis & constrained writing",
}


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def pack_item(r: dict, budget: int) -> dict:
    think = r.get("think_text", "") or ""
    final = r.get("final_text", "") or ""
    out = {
        "passed": bool(r["passed"]),
        "score": round(float(r.get("score", 1.0 if r["passed"] else 0.0)), 4),
        "closed": bool(r.get("closed_think", False)),
        "truncated": bool(r.get("hit_token_limit", False)),
        "budget": budget,
        "tokens": int(r.get("generated_tokens", 0)),
        "think_tokens": int(r.get("think_tokens", 0)),
        "answer_tokens": int(r.get("answer_tokens", 0)),
        "waits": int(r.get("doubt_marker_count", 0)),
        "cjk_think": bool(CJK_RE.search(think)),
        "cjk_answer": bool(CJK_RE.search(final)),
        "detail": str(r.get("reason", ""))[:140],
        "think_text": think,
        "final_text": final,
    }
    turn_logs = r.get("turn_logs")
    if isinstance(turn_logs, list) and turn_logs:
        out["turns"] = [
            {
                "think": t.get("think_text", "") or "",
                "answer": t.get("final_text", "") or "",
                "obs": t.get("observation", "") or "",
                "closed": bool((t.get("final_text", "") or "").strip()),
            }
            for t in turn_logs
        ]
        out["think_text"] = ""
        out["final_text"] = ""
    return out


def build_suite(
    tasks_raw: list[dict],
    sources: dict[str, dict[str, tuple[list[dict], int]]],
    featured: dict[str, str],
) -> dict:
    tasks_out = []
    idx: dict[tuple[str, str, str], dict] = {}
    for size, cond_map in sources.items():
        for cond, (res_list, budget) in cond_map.items():
            for item in res_list:
                idx[(size, cond, item["task_id"])] = pack_item(item, budget)

    for t in tasks_raw:
        tid = t["id"] if "id" in t else t["task_id"]
        dom = t["domain"]
        grader = t.get("answer_type") or t.get("grader_type") or dom
        prompt = t.get("prompt", "")
        runs = {"1.7B": {}, "0.6B": {}}
        for size in ("1.7B", "0.6B"):
            for cond in sources[size]:
                if (size, cond, tid) in idx:
                    runs[size][cond] = idx[(size, cond, tid)]
        tasks_out.append(
            {
                "id": tid,
                "domain": DOMAIN_LABELS.get(dom, dom),
                "title": t.get("title", tid),
                "grader": grader,
                "prompt": prompt,
                "runs": runs,
            }
        )
    return {"featured": featured, "tasks": tasks_out}


def main(study_root: str, blog_dir: str) -> None:
    data_dir = os.path.join(study_root, "data")
    res_dir = os.path.join(study_root, "results")
    post_dir = os.path.join(res_dir, "posthoc_followup")

    blind_suite = load_json(os.path.join(data_dir, "heldout_blind_post_suite.json"))
    blind_tasks = blind_suite["tasks"] if isinstance(blind_suite, dict) and "tasks" in blind_suite else blind_suite

    paired_suite = load_json(os.path.join(data_dir, "heldout_paired_suite.json"))
    paired_tasks = paired_suite["tasks"] if isinstance(paired_suite, dict) and "tasks" in paired_suite else paired_suite

    nothink_blind = load_json(os.path.join(res_dir, "posthoc_nothink_blind_check.json"))["runs"]

    blind_sources = {
        "1.7B": {
            "base_2048": (load_json(os.path.join(res_dir, "blind_base_1.7B_greedy.json"))["results"], 2048),
            "wsp_2048": (load_json(os.path.join(res_dir, "blind_wsp_1.7B_greedy.json"))["results"], 2048),
            "nothink_2048": (nothink_blind["1.7B"]["results"], 2048),
            "base_4096": (load_json(os.path.join(post_dir, "blind_base_1.7B_4096_greedy.json"))["results"], 4096),
            "wsp_4096": (load_json(os.path.join(post_dir, "blind_wsp_1.7B_4096_greedy.json"))["results"], 4096),
            "base_8192": (load_json(os.path.join(post_dir, "blind_base_1.7B_8192_greedy.json"))["results"], 8192),
            "wsp_8192": (load_json(os.path.join(post_dir, "blind_wsp_1.7B_8192_greedy.json"))["results"], 8192),
        },
        "0.6B": {
            "base_2048": (load_json(os.path.join(res_dir, "blind_base_0.6B_greedy.json"))["results"], 2048),
            "wsp_2048": (load_json(os.path.join(res_dir, "blind_wsp_0.6B_greedy.json"))["results"], 2048),
            "gentle_2048": (load_json(os.path.join(post_dir, "blind_gentle_a2.0_0.6B_greedy.json"))["results"], 2048),
            "nothink_2048": (nothink_blind["0.6B"]["results"], 2048),
            "base_4096": (load_json(os.path.join(post_dir, "blind_base_0.6B_4096_greedy.json"))["results"], 4096),
            "wsp_4096": (load_json(os.path.join(post_dir, "blind_wsp_0.6B_4096_greedy.json"))["results"], 4096),
            "base_8192": (load_json(os.path.join(post_dir, "blind_base_0.6B_8192_greedy.json"))["results"], 8192),
            "wsp_8192": (load_json(os.path.join(post_dir, "blind_wsp_0.6B_8192_greedy.json"))["results"], 8192),
        },
    }

    paired_sources = {
        "1.7B": {
            "base_2048": (load_json(os.path.join(res_dir, "paired_base_1.7B_greedy.json"))["results"], 2048),
            "wsp_2048": (load_json(os.path.join(res_dir, "paired_wsp_1.7B_greedy.json"))["results"], 2048),
            "nothink_2048": (load_json(os.path.join(post_dir, "paired_nothink_1.7B_greedy.json"))["results"], 2048),
            "base_4096": (load_json(os.path.join(post_dir, "paired_base_1.7B_4096_greedy.json"))["results"], 4096),
            "wsp_4096": (load_json(os.path.join(post_dir, "paired_wsp_1.7B_4096_greedy.json"))["results"], 4096),
            "base_8192": (load_json(os.path.join(post_dir, "paired_base_1.7B_8192_greedy.json"))["results"], 8192),
            "wsp_8192": (load_json(os.path.join(post_dir, "paired_wsp_1.7B_8192_greedy.json"))["results"], 8192),
        },
        "0.6B": {
            "base_2048": (load_json(os.path.join(res_dir, "paired_base_0.6B_greedy.json"))["results"], 2048),
            "wsp_2048": (load_json(os.path.join(res_dir, "paired_wsp_0.6B_greedy.json"))["results"], 2048),
            "gentle_2048": (load_json(os.path.join(post_dir, "paired_gentle_a2.0_0.6B_greedy.json"))["results"], 2048),
            "nothink_2048": (load_json(os.path.join(post_dir, "paired_nothink_0.6B_greedy.json"))["results"], 2048),
            "base_4096": (load_json(os.path.join(post_dir, "paired_base_0.6B_4096_greedy.json"))["results"], 4096),
            "wsp_4096": (load_json(os.path.join(post_dir, "paired_wsp_0.6B_4096_greedy.json"))["results"], 4096),
            "base_8192": (load_json(os.path.join(post_dir, "paired_base_0.6B_8192_greedy.json"))["results"], 8192),
            "wsp_8192": (load_json(os.path.join(post_dir, "paired_wsp_0.6B_8192_greedy.json"))["results"], 8192),
        },
    }

    featured_blind = {
        "de_b01": "Why CleanWSP beats No-Thinking on structured output: CleanWSP reasons silently inside <think> (excluding the waived jacket fee) and emits pure JSON after </think>. Switch Right pane to 'No-Thinking' to see Qwen3-1.7B spill prose into final_text, breaking strict JSON parsing.",
        "cu_b02": "Multi-turn live sandbox (5 turns): Qwen3-1.7B-CleanWSP lists the workspace, reads warehouse/stock.csv, sums the shortfall for GASKET-12 (26) and VALVE-03 (17) inside <think>, writes warehouse/restock_order.json, and calls finish. In No-Thinking mode, without a <think> scratchpad, the model fails to emit valid <tool_call> actions.",
        "sci_b03": "Hardy-Weinberg carrier frequency (2pq = 0.0392): Unedited Qwen3-1.7B (2,048) computes 0.0392 inside <think> and then spends over a thousand tokens re-verifying 98/2500 until the 2,048-token cap cuts it off before </think>. Compare CleanWSP (2,048) against Base (8,192 · 4×) and CleanWSP (8,192 · 4×).",
        "math_b01": "Alloy mixture algebra: Unedited Qwen3-1.7B (2,048) solves x = 20 early in <think> and loops through redundant checks until truncation. CleanWSP (2,048), No-Thinking mode, and the 4× window (8,192) runs all close cleanly after </think>.",
        "code_b04": "Why 4× context (8,192) widens CleanWSP's lead on code: even given 8,192 tokens, unedited Qwen3-1.7B spirals through monotonic-deque edge-case doubts until the 8,192-token cap cuts it off inside <think>. CleanWSP damps the loop, closes </think> at 5,112 tokens, and passes every unit test.",
    }

    featured_paired = {
        "sci_p01": "Paired suite scientific reasoning: Unedited Qwen3-1.7B hits the 2,048-token ceiling inside <think>; CleanWSP closes </think> in pure English and emits the exact post-</think> answer.",
    }

    blind_payload = build_suite(blind_tasks, blind_sources, featured_blind)
    paired_payload = build_suite(paired_tasks, paired_sources, featured_paired)

    out_blind = os.path.join(blog_dir, "traces.json")
    out_paired = os.path.join(blog_dir, "traces_paired.json")
    with open(out_blind, "w", encoding="utf-8") as f:
        json.dump(blind_payload, f, ensure_ascii=False, separators=(",", ":"))
    with open(out_paired, "w", encoding="utf-8") as f:
        json.dump(paired_payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote {out_blind} ({os.path.getsize(out_blind):,} bytes) and {out_paired} ({os.path.getsize(out_paired):,} bytes)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
