"""
Hardware-Precision CUDA-Event Throughput & Latency Profiler.
Measures:
  1. Pure prefill throughput (tok/s) across context lengths [64, 256, 1024, 2048]
  2. Single-stream (batch=1) fixed-length decode tok/s across [128, 512, 1024]
  3. Batched (batch=16) fixed-length decode tok/s across [128, 512, 1024, 2048]
  4. Peak GPU VRAM footprint (MiB)
"""

import json
import statistics
import sys
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer


def profile_model_hardware(model_path: str, label: str, repeats: int = 2) -> dict:
    tokenizer = AutoTokenizer.from_pretrained(model_path, padding_side="left")
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token_id = tokenizer.eos_token_id

    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()

    model = AutoModelForCausalLM.from_pretrained(
        model_path, dtype=torch.bfloat16, attn_implementation="sdpa"
    ).to("cuda")
    model.eval()
    weights_mem_mib = torch.cuda.max_memory_allocated() / (1024 * 1024)

    # Warmup
    warm_ids = torch.randint(100, 5000, (1, 64), device="cuda")
    with torch.inference_mode():
        _ = model(warm_ids)
        _ = model.generate(warm_ids, min_new_tokens=16, max_new_tokens=16, do_sample=False, eos_token_id=[])
    torch.cuda.synchronize()

    # 1. Prefill profiling (batch=1)
    prefill_stats = {}
    for plen in [64, 256, 1024, 2048]:
        inp = torch.randint(100, 10000, (1, plen), device="cuda")
        times_ms = []
        for _ in range(repeats + 1):
            ev_s = torch.cuda.Event(enable_timing=True)
            ev_e = torch.cuda.Event(enable_timing=True)
            torch.cuda.synchronize()
            ev_s.record()
            with torch.inference_mode():
                _ = model(inp, use_cache=True)
            ev_e.record()
            torch.cuda.synchronize()
            times_ms.append(ev_s.elapsed_time(ev_e))
        valid_ms = times_ms[1:]
        mean_s = statistics.mean(valid_ms) / 1000.0
        prefill_stats[str(plen)] = {
            "mean_ms": round(mean_s * 1000, 3),
            "tok_per_s": round(plen / mean_s, 1),
        }

    # 2. Single-stream (batch=1) fixed-length decode
    b1_prompt = tokenizer(
        "Explain the thermodynamic principles of a Rankine steam cycle step by step:",
        return_tensors="pt",
    ).to("cuda")
    b1_stats = {}
    for gen_len in [128, 512, 1024]:
        times_s = []
        for _ in range(repeats):
            ev_s = torch.cuda.Event(enable_timing=True)
            ev_e = torch.cuda.Event(enable_timing=True)
            torch.cuda.synchronize()
            ev_s.record()
            with torch.inference_mode():
                _ = model.generate(
                    **b1_prompt,
                    min_new_tokens=gen_len,
                    max_new_tokens=gen_len,
                    do_sample=False,
                    eos_token_id=[],
                    pad_token_id=tokenizer.pad_token_id,
                )
            ev_e.record()
            torch.cuda.synchronize()
            times_s.append(ev_s.elapsed_time(ev_e) / 1000.0)
        mean_s = statistics.mean(times_s)
        b1_stats[str(gen_len)] = {
            "mean_sec": round(mean_s, 4),
            "mean_tok_per_s": round(gen_len / mean_s, 2),
        }
        print(f"[Speed B=1 {label}] L={gen_len:4d} -> {gen_len/mean_s:6.2f} tok/s ({mean_s:.2f}s)", flush=True)

    # 3. Batched (batch=16) fixed-length decode across [128, 512, 1024, 2048]
    b16_prompts = tokenizer(
        [f"Analyze system state #{k} and derive equilibrium equations:" for k in range(16)],
        return_tensors="pt",
        padding=True,
    ).to("cuda")
    b16_stats = {}
    for gen_len in [128, 512, 1024, 2048]:
        torch.cuda.reset_peak_memory_stats()
        times_s = []
        for _ in range(repeats):
            ev_s = torch.cuda.Event(enable_timing=True)
            ev_e = torch.cuda.Event(enable_timing=True)
            torch.cuda.synchronize()
            ev_s.record()
            with torch.inference_mode():
                _ = model.generate(
                    **b16_prompts,
                    min_new_tokens=gen_len,
                    max_new_tokens=gen_len,
                    do_sample=False,
                    eos_token_id=[],
                    pad_token_id=tokenizer.pad_token_id,
                )
            ev_e.record()
            torch.cuda.synchronize()
            times_s.append(ev_s.elapsed_time(ev_e) / 1000.0)
        peak_mib = torch.cuda.max_memory_allocated() / (1024 * 1024)
        mean_s = statistics.mean(times_s)
        tot_toks = 16 * gen_len
        b16_stats[str(gen_len)] = {
            "mean_sec": round(mean_s, 4),
            "total_tok_per_s": round(tot_toks / mean_s, 2),
            "per_stream_tok_per_s": round(gen_len / mean_s, 2),
            "peak_vram_mib": round(peak_mib, 1),
        }
        print(
            f"[Speed B=16 {label}] L={gen_len:4d} -> {tot_toks/mean_s:6.1f} tok/s ({mean_s:.2f}s, peak {peak_mib:.0f} MiB)",
            flush=True,
        )

    del model
    torch.cuda.empty_cache()
    return {
        "label": label,
        "model_path": model_path,
        "weights_vram_mib": round(weights_mem_mib, 1),
        "prefill_batch1": prefill_stats,
        "fixed_decode_batch1": b1_stats,
        "fixed_decode_batch16": b16_stats,
    }


if __name__ == "__main__":
    mpath, lbl, out_p = sys.argv[1], sys.argv[2], sys.argv[3]
    res = profile_model_hardware(mpath, lbl)
    with open(out_p, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2)
