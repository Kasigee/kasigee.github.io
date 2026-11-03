"""Runs Qwen3-0.6B and Qwen3-1.7B on the 6 Live Calibration Questions ONLY.

Used to observe natural thinking-trace lengths, self-doubt loops, and token budgets
on the calibration split without touching the 30-task held-out benchmark.
"""
import json
import time
import torch
from pathlib import Path
from transformers import AutoTokenizer, AutoModelForCausalLM
from graders import split_thinking_and_answer, extract_last_boxed, compute_ngram_repetition_rate

ROOT = Path(__file__).resolve().parent.parent  # project root (the scripts lived in <root>/scripts)
CAL_DATA = json.loads((ROOT / "calibration" / "calibration_prompts.json").read_text(encoding="utf-8"))
LIVE_QS = CAL_DATA["live_calibration_questions"]

MAX_NEW_TOKENS = 1024

for model_name in ["Qwen3-0.6B", "Qwen3-1.7B"]:
    model_path = str(ROOT / "models" / model_name)
    print(f"\n==================== {model_name} (Calibration Split) ====================")
    tok = AutoTokenizer.from_pretrained(model_path, padding_side="left")
    if tok.pad_token_id is None:
        tok.pad_token_id = tok.eos_token_id

    model = AutoModelForCausalLM.from_pretrained(
        model_path, dtype=torch.bfloat16, device_map="cuda:0", attn_implementation="sdpa"
    )
    model.eval()

    prompts = [
        tok.apply_chat_template(
            [{"role": "user", "content": q["prompt"]}],
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=True,
        )
        for q in LIVE_QS
    ]
    inputs = tok(prompts, return_tensors="pt", padding=True).to("cuda:0")
    input_len = inputs["input_ids"].shape[1]

    torch.cuda.synchronize()
    t0 = time.perf_counter()
    with torch.no_grad():
        # Test both greedy (do_sample=False) and Qwen3 thinking card sampling (temp=0.6, top_p=0.95, top_k=20)
        out = model.generate(
            **inputs,
            max_new_tokens=MAX_NEW_TOKENS,
            do_sample=False,
            pad_token_id=tok.pad_token_id,
            eos_token_id=tok.eos_token_id,
        )
    torch.cuda.synchronize()
    dt = time.perf_counter() - t0

    results = []
    for idx, q in enumerate(LIVE_QS):
        gen_ids = out[idx][input_len:]
        # Trim padding after first eos_token_id
        eos_positions = (gen_ids == tok.eos_token_id).nonzero(as_tuple=True)[0]
        if len(eos_positions) > 0:
            actual_ids = gen_ids[: eos_positions[0].item() + 1]
            hit_cutoff = False
        else:
            actual_ids = gen_ids
            hit_cutoff = True

        text = tok.decode(actual_ids, skip_special_tokens=False)
        think_part, ans_part, closed_think = split_thinking_and_answer(text)
        pred_strict = extract_last_boxed(ans_part)
        pred_any = pred_strict or extract_last_boxed(text)
        wait_count = len([m for m in ("wait", "double check", "recalculate", "let me check", "alternatively", "hold on") if m in think_part.lower()])
        wait_occurrences = think_part.lower().count("wait") + think_part.lower().count("check")
        rep8 = compute_ngram_repetition_rate(think_part, 8)

        print(
            f"  {q['id']}: tok={len(actual_ids):4d} | closed_think={str(closed_think):5s} | cutoff={str(hit_cutoff):5s} "
            f"| strict='{pred_strict}' (exp='{q['expected']}') | any='{pred_any}' | wait/check={wait_occurrences:2d} | rep8={rep8:.3f}"
        )
        results.append({
            "id": q["id"],
            "tokens": len(actual_ids),
            "closed_think": closed_think,
            "hit_cutoff": hit_cutoff,
            "pred_strict": pred_strict,
            "pred_any": pred_any,
            "expected": q["expected"],
            "wait_occurrences": wait_occurrences,
            "rep8": rep8,
            "raw_text": text,
        })

    (ROOT / "calibration" / f"cal_diag_{model_name}.json").write_text(
        json.dumps(results, indent=2), encoding="utf-8"
    )
    del model
    torch.cuda.empty_cache()
