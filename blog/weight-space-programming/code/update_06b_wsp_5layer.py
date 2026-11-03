"""Applies the 5-layer WSP surgical edit (layers [16, 19, 22, 24, 26], k=112, alpha=5.8, beta=0.13) to Qwen3-0.6B."""
import json
import torch
from pathlib import Path
from transformers import AutoTokenizer, AutoModelForCausalLM
from wsp_surgeon import (
    extract_calibration_profiles,
    apply_wsp_edit_in_memory,
    evaluate_on_calibration,
    save_edited_checkpoint_and_manifest,
    ROOT,
    CAL_PATH,
)

model_name = "Qwen3-0.6B"
base_dir = ROOT / "models" / model_name
out_dir = ROOT / "models" / f"{model_name}-WSP"
cal_data = json.loads(CAL_PATH.read_text(encoding="utf-8"))
diag_data = json.loads((ROOT / "calibration" / f"cal_diag_{model_name}.json").read_text(encoding="utf-8"))

tok = AutoTokenizer.from_pretrained(str(base_dir), padding_side="left")
if tok.pad_token_id is None:
    tok.pad_token_id = tok.eos_token_id

model = AutoModelForCausalLM.from_pretrained(
    str(base_dir), dtype=torch.bfloat16, device_map="cuda:0", attn_implementation="sdpa"
)
model.eval()

profiles = extract_calibration_profiles(model, tok, cal_data, diag_data)
target_layers = [16, 19, 22, 24, 26]
base_weights = {l: model.model.layers[l].mlp.down_proj.weight.detach().clone() for l in target_layers}

cand = {"name": "wsp_L16_19_22_24_26_k112_a5.8_b0.13", "layers": target_layers, "k": 112, "alpha": 5.8, "beta": 0.13}
edit_info = apply_wsp_edit_in_memory(
    model, base_weights, profiles, target_layers=target_layers, k_cols=112, alpha=5.8, beta=0.13, random_control=False
)
ev = evaluate_on_calibration(model, tok, cal_data["live_calibration_questions"])
print(f"[{cand['name']}] Strict={ev['strict_hits']}/6 ({ev['strict_acc_pct']}%) | Cutoffs={ev['cutoff_count']}/6 | AvgTok={ev['avg_tokens']} | AvgWaits={ev['avg_waits']}")

# Random control
_ = apply_wsp_edit_in_memory(
    model, base_weights, profiles, target_layers=target_layers, k_cols=112, alpha=5.8, beta=0.13, random_control=True
)
rand_ev = evaluate_on_calibration(model, tok, cal_data["live_calibration_questions"])

# Re-apply winning WSP edit
winning_edit_info = apply_wsp_edit_in_memory(
    model, base_weights, profiles, target_layers=target_layers, k_cols=112, alpha=5.8, beta=0.13, random_control=False
)

sweep_path = ROOT / "calibration" / f"wsp_sweep_{model_name}.json"
sweep_log = json.loads(sweep_path.read_text(encoding="utf-8"))
sweep_log["winning_candidate"] = {**cand, "eval": ev}
sweep_log["random_orthogonal_control"] = rand_ev
sweep_path.write_text(json.dumps(sweep_log, indent=2), encoding="utf-8")

save_edited_checkpoint_and_manifest(base_dir, out_dir, model, base_weights, target_layers, winning_edit_info, sweep_log)
del model
torch.cuda.empty_cache()
