"""Updates math_01, math_02, and logic_03 in the Baseline ('before') results after fixing the 117g typo."""
import json
import time
import torch
from pathlib import Path
from transformers import AutoTokenizer, AutoModelForCausalLM
from graders import grade_task, split_thinking_and_answer

ROOT = Path(__file__).resolve().parent.parent  # project root (the scripts lived in <root>/scripts)
SUITE = json.loads((ROOT / "benchmarks" / "multi_domain_test_suite.json").read_text(encoding="utf-8"))
TASK_MAP = {t["id"]: t for t in SUITE}

for model_label in ["Qwen3-0.6B", "Qwen3-1.7B"]:
    res_path = ROOT / "outputs" / "before" / f"{model_label}_before_results.json"
    data = json.loads(res_path.read_text(encoding="utf-8"))
    model_path = str(ROOT / "models" / model_label)

    tok = AutoTokenizer.from_pretrained(model_path, padding_side="left")
    model = AutoModelForCausalLM.from_pretrained(
        model_path, dtype=torch.bfloat16, device_map="cuda:0", attn_implementation="sdpa"
    )
    model.eval()

    # Re-run math_02 with 117g prompt
    t_m2 = TASK_MAP["math_02"]
    prompt = tok.apply_chat_template(
        [{"role": "user", "content": t_m2["prompt"]}],
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=True,
    )
    inp = tok(prompt, return_tensors="pt").to("cuda:0")
    in_len = inp["input_ids"].shape[1]
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    with torch.no_grad():
        out = model.generate(**inp, max_new_tokens=1024, do_sample=False, pad_token_id=tok.eos_token_id, eos_token_id=tok.eos_token_id)
    torch.cuda.synchronize()
    dt = time.perf_counter() - t0
    gen_ids = out[0][in_len:]
    eos_pos = (gen_ids == tok.eos_token_id).nonzero(as_tuple=True)[0]
    if len(eos_pos) > 0:
        actual_ids = gen_ids[: int(eos_pos[0].item()) + 1]
        hit_cutoff = False
    else:
        actual_ids = gen_ids
        hit_cutoff = True

    clean_text = tok.decode(actual_ids, skip_special_tokens=False).replace("<|im_end|>", "").strip()
    think_part, ans_part, closed_think = split_thinking_and_answer(clean_text)
    think_toks = len(tok.encode(think_part, add_special_tokens=False)) if think_part else 0
    ans_toks = len(tok.encode(ans_part, add_special_tokens=False)) if ans_part else 0
    g_m2 = grade_task(t_m2, clean_text)

    for item in data["items"]:
        if item["id"] == "math_02":
            item.update({
                "prompt": t_m2["prompt"],
                "strict_correct": g_m2["strict_correct"],
                "lenient_correct": g_m2["lenient_correct"],
                "closed_think": g_m2["closed_think"],
                "hit_cutoff": hit_cutoff,
                "total_tokens": len(actual_ids),
                "think_tokens": think_toks,
                "answer_tokens": ans_toks,
                "seq_wall_seconds": round(dt, 3),
                "think_8gram_rep_rate": g_m2["think_8gram_rep_rate"],
                "wait_check_count": think_part.lower().count("wait") + think_part.lower().count("check"),
                "extracted_pred": g_m2["extracted_pred"],
                "grade_reason": g_m2["grade_reason"],
                "thinking_trace": think_part,
                "final_answer": ans_part,
                "raw_output": clean_text,
            })
        elif item["id"] in ("math_01", "logic_03"):
            t_ref = TASK_MAP[item["id"]]
            g_ref = grade_task(t_ref, item["raw_output"])
            item.update({
                "strict_correct": g_ref["strict_correct"],
                "lenient_correct": g_ref["lenient_correct"],
                "extracted_pred": g_ref["extracted_pred"],
                "grade_reason": g_ref["grade_reason"],
            })

    # Recompute aggregates
    items = data["items"]
    n_total = len(items)
    data["strict_correct_count"] = sum(1 for x in items if x["strict_correct"])
    data["strict_accuracy_pct"] = round(100.0 * data["strict_correct_count"] / n_total, 2)
    data["lenient_correct_count"] = sum(1 for x in items if x["lenient_correct"])
    data["lenient_accuracy_pct"] = round(100.0 * data["lenient_correct_count"] / n_total, 2)
    data["cutoff_rate_pct"] = round(100.0 * sum(1 for x in items if x["hit_cutoff"]) / n_total, 2)
    data["closed_think_rate_pct"] = round(100.0 * sum(1 for x in items if x["closed_think"]) / n_total, 2)
    data["avg_total_tokens"] = round(sum(x["total_tokens"] for x in items) / n_total, 1)
    data["avg_think_tokens"] = round(sum(x["think_tokens"] for x in items) / n_total, 1)
    data["avg_answer_tokens"] = round(sum(x["answer_tokens"] for x in items) / n_total, 1)

    for dom in data["domain_breakdown"]:
        dom_items = [x for x in items if x["domain"] == dom]
        data["domain_breakdown"][dom].update({
            "strict_correct": sum(1 for x in dom_items if x["strict_correct"]),
            "strict_accuracy_pct": round(100.0 * sum(1 for x in dom_items if x["strict_correct"]) / len(dom_items), 2),
            "lenient_accuracy_pct": round(100.0 * sum(1 for x in dom_items if x["lenient_correct"]) / len(dom_items), 2),
            "cutoff_rate_pct": round(100.0 * sum(1 for x in dom_items if x["hit_cutoff"]) / len(dom_items), 2),
            "avg_total_tokens": round(sum(x["total_tokens"] for x in dom_items) / len(dom_items), 1),
            "avg_think_tokens": round(sum(x["think_tokens"] for x in dom_items) / len(dom_items), 1),
        })

    res_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print(
        f"Updated {model_label} (before): strict={data['strict_correct_count']}/30 ({data['strict_accuracy_pct']}%), "
        f"lenient={data['lenient_correct_count']}/30 ({data['lenient_accuracy_pct']}%), cutoff={data['cutoff_rate_pct']}%"
    )
    del model
    torch.cuda.empty_cache()
