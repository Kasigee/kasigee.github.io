"""Probes exact token transitions and logit gaps at paragraph boundaries on the Calibration Split."""
import json
from pathlib import Path
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM

ROOT = Path(__file__).resolve().parent.parent  # project root (the scripts lived in <root>/scripts)
path = str(ROOT / "models" / "Qwen3-0.6B")
tok = AutoTokenizer.from_pretrained(path)
model = AutoModelForCausalLM.from_pretrained(path, dtype=torch.bfloat16, device_map="cuda:0")
diag = json.load(open(ROOT / "calibration" / "cal_diag_Qwen3-0.6B.json", encoding="utf-8"))
end_id = tok.encode("</think>", add_special_tokens=False)[0]

# First check cal_live_03 where Qwen3-0.6B DID close </think>
for idx in [2, 5, 0]:
    print(f"\n=== Calibration Item {diag[idx]['id']} (closed_think={diag[idx]['closed_think']}) ===")
    txt = diag[idx]["raw_text"]
    ids = tok.encode(txt, add_special_tokens=False)
    inp = torch.tensor([ids], device="cuda:0")
    with torch.no_grad():
        logits = model(inp).logits[0]

    for pos in range(len(ids)):
        tok_str = tok.decode([ids[pos]])
        if "\n" in tok_str or ids[pos] == end_id:
            l_end = float(logits[pos, end_id].item())
            top_v, top_i = torch.topk(logits[pos], 3)
            top_tokens = [(tok.decode([int(i)]), round(float(v), 2)) for v, i in zip(top_v, top_i)]
            if l_end > 8.0 or pos > len(ids) - 15 or "\n\n" in tok_str:
                prev_ctx = tok.decode(ids[max(0, pos - 8):pos + 1]).replace("\n", "\\n")
                print(f"  pos={pos:4d} ctx='{prev_ctx[-35:]:35s}' | logit(</think>)={l_end:6.2f} | top3={top_tokens}")
