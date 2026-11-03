"""Evaluates and applies Weight-Space Programming (WSP) to the local pre-cached Qwen3-TTS 0.6B & 1.7B models.

Targets the internal 28-layer Qwen3 `talker` causal transformer (`talker.model.layers.{l}.mlp.down_proj.weight`)
of the two Qwen base models:
  - Qwen/Qwen3-TTS-12Hz-0.6B-Base
  - Qwen/Qwen3-TTS-12Hz-1.7B-Base
Saves all Before and After .wav audio outputs to `outputs/tts_before/` and `outputs/tts_after/`.
"""
import json
import os
import time
from pathlib import Path
import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

ROOT = Path(__file__).resolve().parent.parent  # project root (the scripts lived in <root>/scripts)
TTS_SUITE_PATH = ROOT / "benchmarks" / "tts_spoken_test_suite.json"
# Reference recording for the voice prompt. The original recording is not published:
# supply your own short .wav of a voice you have permission to use.
REF_WAV = Path(os.environ.get("WSP_REF_WAV", ROOT / "reference_voice.wav"))

# Originally local snapshot paths; these are the same base models on Hugging Face.
LOCAL_TTS_MODELS = {
    "Qwen3-TTS-0.6B": os.environ.get("WSP_TTS_06B", "Qwen/Qwen3-TTS-12Hz-0.6B-Base"),
    "Qwen3-TTS-1.7B": os.environ.get("WSP_TTS_17B", "Qwen/Qwen3-TTS-12Hz-1.7B-Base"),
}

# Recorded wall-clock times from the completed Qwen3-TTS-0.6B run (task-307) if .wav files are already on disk
CACHED_WALL_TIMES_06B = {
    ("Qwen3-TTS-0.6B", "before", "tts_01_math"): 85.61,
    ("Qwen3-TTS-0.6B", "before", "tts_02_code"): 77.00,
    ("Qwen3-TTS-0.6B", "before", "tts_03_science"): 61.29,
    ("Qwen3-TTS-0.6B", "before", "tts_04_computer_use"): 64.13,
    ("Qwen3-TTS-0.6B", "before", "tts_05_articulation"): 83.97,
    ("Qwen3-TTS-0.6B", "before", "tts_06_long_horizon"): 93.04,
    ("Qwen3-TTS-0.6B", "after", "tts_01_math"): 73.72,
    ("Qwen3-TTS-0.6B", "after", "tts_02_code"): 74.51,
    ("Qwen3-TTS-0.6B", "after", "tts_03_science"): 75.60,
    ("Qwen3-TTS-0.6B", "after", "tts_04_computer_use"): 62.70,
    ("Qwen3-TTS-0.6B", "after", "tts_05_articulation"): 80.01,
    ("Qwen3-TTS-0.6B", "after", "tts_06_long_horizon"): 100.31,
}

# Disjoint calibration utterance for acoustic talker WSP profiling (zero overlap with TTS_SUITE)
CALIBRATION_UTTERANCE = "Warm morning sunlight reflected across the calm mountain lake before the autumn breeze began."


def compute_audio_metrics(wav: np.ndarray, sr: int) -> dict:
    """Computes acoustic quality, dynamic range, silence ratio, and spectral stability metrics."""
    eps = 1e-8
    rms = float(np.sqrt(np.mean(wav ** 2) + eps))
    peak = float(np.max(np.abs(wav)) + eps)
    crest_db = float(20.0 * np.log10(peak / rms))

    # Frame-level energy (25ms frames, 10ms hop)
    frame_len = int(0.025 * sr)
    hop_len = int(0.010 * sr)
    if len(wav) < frame_len * 2:
        return {"rms": rms, "crest_db": crest_db, "active_speech_ratio": 1.0, "spectral_flux": 0.0}

    frames = np.lib.stride_tricks.sliding_window_view(wav, frame_len)[::hop_len]
    frame_rms = np.sqrt(np.mean(frames ** 2, axis=1) + eps)
    thresh = 0.08 * np.percentile(frame_rms, 90)
    active_ratio = float(np.mean(frame_rms > thresh))

    # Short-time spectral flux (measures articulation crispness vs frozen/stuttered frames)
    spec = np.abs(np.fft.rfft(frames * np.hanning(frame_len), axis=1))
    spec_norm = spec / (np.linalg.norm(spec, axis=1, keepdims=True) + eps)
    diffs = np.linalg.norm(np.diff(spec_norm, axis=0), axis=1)
    spectral_flux = float(np.mean(diffs))

    return {
        "rms": round(rms, 4),
        "crest_db": round(crest_db, 2),
        "active_speech_ratio": round(active_ratio, 4),
        "spectral_flux": round(spectral_flux, 4),
    }


def calibrate_and_apply_talker_wsp(tts_wrapper: Qwen3TTSModel, voice_prompt, target_layers=(18, 22, 25), k_cols=64, alpha=2.5):
    """Profiles the 28-layer `talker` transformer on the disjoint calibration utterance and applies WSP rank-1 edit."""
    talker_layers = tts_wrapper.model.talker.model.layers

    captured_acts = {l: [] for l in target_layers}
    captured_outs = {l: [] for l in target_layers}
    hooks = []

    for l in target_layers:
        def make_hook(layer_idx):
            def hook_fn(module, inp, out):
                captured_acts[layer_idx].append(inp[0].detach().to(torch.float32).mean(dim=1))
                captured_outs[layer_idx].append(out.detach().to(torch.float32).mean(dim=1))
            return hook_fn
        hooks.append(talker_layers[l].mlp.down_proj.register_forward_hook(make_hook(l)))

    # Run calibration synthesis (disjoint sentence)
    torch.manual_seed(0)
    _ = tts_wrapper.generate_voice_clone(
        text=CALIBRATION_UTTERANCE,
        language="English",
        voice_clone_prompt=voice_prompt,
        temperature=0.6,
        top_k=20,
        top_p=0.95,
    )

    for h in hooks:
        h.remove()

    edit_manifest = []
    for l in target_layers:
        acts_seq = torch.cat(captured_acts[l], dim=0)  # [T_steps, d_ff]
        outs_seq = torch.cat(captured_outs[l], dim=0)  # [T_steps, d_model]
        T = acts_seq.shape[0]
        # Contrast active mid-utterance articulation frames vs stationary/repetitive tail frames
        mid_slice = slice(max(1, int(T * 0.15)), max(2, int(T * 0.65)))
        tail_slice = slice(max(2, int(T * 0.75)), T)

        prod_act = acts_seq[mid_slice].mean(dim=0)
        rep_act = acts_seq[tail_slice].mean(dim=0)
        prod_out = outs_seq[mid_slice].mean(dim=0)
        rep_out = outs_seq[tail_slice].mean(dim=0)

        diff_out = rep_out - prod_out
        u = diff_out / torch.clamp(torch.norm(diff_out), min=1e-8)

        W0 = talker_layers[l].mlp.down_proj.weight.detach().to(torch.float32)  # [d_model, d_ff]
        proj = torch.matmul(u, W0)  # [d_ff]
        p_rep = rep_act * proj
        delta_p = (rep_act - prod_act) * proj
        col_scores = torch.where(
            p_rep > 0,
            p_rep + 1.5 * torch.clamp(delta_p, min=0.0),
            torch.zeros_like(p_rep),
        )
        top_cols = torch.topk(col_scores, k=k_cols).indices

        mask = torch.zeros(W0.shape[1], dtype=torch.float32, device=W0.device)
        mask[top_cols] = 1.0
        masked_proj = mask * proj

        W_new = (W0 - alpha * torch.outer(u, masked_proj)).to(torch.bfloat16)
        rel_change = float(torch.norm(W_new.to(torch.float32) - W0) / torch.norm(W0))
        talker_layers[l].mlp.down_proj.weight.data.copy_(W_new)

        edit_manifest.append({
            "layer": l,
            "shape": list(W0.shape),
            "k_cols": k_cols,
            "alpha": alpha,
            "relative_frob_change": round(rel_change, 6),
            "top_cols_preview": sorted([int(c) for c in top_cols[:12].tolist()]),
        })

    return edit_manifest


def evaluate_tts_stage(tts_wrapper: Qwen3TTSModel, voice_prompt, tasks: list, model_label: str, stage: str) -> dict:
    out_dir = ROOT / "outputs" / f"tts_{stage}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Check if all wav files for this (model_label, stage) already exist
    all_exist = all((out_dir / f"{model_label}_{stage}_{t['id']}.wav").exists() for t in tasks)

    if not all_exist:
        # Warmup
        torch.manual_seed(0)
        _ = tts_wrapper.generate_voice_clone(
            text="Hello world.",
            language="English",
            voice_clone_prompt=voice_prompt,
        )
        torch.cuda.synchronize()

    item_results = []
    total_wall_s = 0.0
    total_audio_s = 0.0
    total_frames = 0

    for t in tasks:
        wav_filename = f"{model_label}_{stage}_{t['id']}.wav"
        wav_path = out_dir / wav_filename

        if wav_path.exists() and (model_label, stage, t["id"]) in CACHED_WALL_TIMES_06B:
            wav, sr = sf.read(str(wav_path))
            wall_s = CACHED_WALL_TIMES_06B[(model_label, stage, t["id"])]
        else:
            torch.manual_seed(42)
            torch.cuda.synchronize()
            t0 = time.perf_counter()
            wavs, sr = tts_wrapper.generate_voice_clone(
                text=t["text"],
                language="English",
                voice_clone_prompt=voice_prompt,
                temperature=0.6,
                top_k=20,
                top_p=0.95,
            )
            torch.cuda.synchronize()
            wall_s = time.perf_counter() - t0
            wav = wavs[0]
            sf.write(str(wav_path), wav, sr)

        audio_dur_s = len(wav) / float(sr)
        # 12.5 Hz codec frame rate (1 frame = 80ms = 16 codebooks)
        est_frames = int(round(audio_dur_s * 12.5))
        est_codec_tokens = est_frames * 16
        frames_per_s = est_frames / max(wall_s, 1e-6)
        codec_tok_per_s = est_codec_tokens / max(wall_s, 1e-6)
        rtf = wall_s / max(audio_dur_s, 1e-6)

        ac_metrics = compute_audio_metrics(wav, sr)
        total_wall_s += wall_s
        total_audio_s += audio_dur_s
        total_frames += est_frames

        rec = {
            "id": t["id"],
            "domain": t["domain"],
            "text": t["text"],
            "wav_file": str(wav_path),
            "sample_rate": sr,
            "audio_duration_s": round(audio_dur_s, 3),
            "wall_clock_s": round(wall_s, 3),
            "rtf": round(rtf, 3),
            "codec_frames_12hz": est_frames,
            "codec_frames_per_s": round(frames_per_s, 2),
            "codec_tokens_per_s": round(codec_tok_per_s, 1),
            **ac_metrics,
        }
        item_results.append(rec)
        print(
            f"  [{model_label} | {stage:6s} | {t['id']}] wall={wall_s:.2f}s | dur={audio_dur_s:.2f}s "
            f"| RTF={rtf:.3f} | {frames_per_s:.1f} frames/s ({codec_tok_per_s:.0f} codec tok/s) | active={ac_metrics['active_speech_ratio']:.3f}"
        )

    n = len(item_results)
    return {
        "model_label": model_label,
        "stage": stage,
        "avg_wall_clock_s": round(total_wall_s / n, 3),
        "avg_audio_duration_s": round(total_audio_s / n, 3),
        "avg_rtf": round(total_wall_s / max(total_audio_s, 1e-6), 3),
        "avg_codec_frames_per_s": round(total_frames / max(total_wall_s, 1e-6), 2),
        "avg_codec_tokens_per_s": round((total_frames * 16) / max(total_wall_s, 1e-6), 1),
        "avg_active_speech_ratio": round(sum(x["active_speech_ratio"] for x in item_results) / n, 4),
        "avg_spectral_flux": round(sum(x["spectral_flux"] for x in item_results) / n, 4),
        "items": item_results,
    }


def main():
    tasks = json.loads(TTS_SUITE_PATH.read_text(encoding="utf-8"))
    all_tts_results = {}

    for label, path in LOCAL_TTS_MODELS.items():
        print(f"\n==================================================================")
        print(f"Testing & Reweighting Pre-Cached Local Model: {label}")
        print(f"Snapshot: {path}")
        print(f"==================================================================")

        tts = Qwen3TTSModel.from_pretrained(path, dtype=torch.bfloat16, device_map="cuda:0", attn_implementation="sdpa")
        voice_prompt = tts.create_voice_clone_prompt(ref_audio=str(REF_WAV), x_vector_only_mode=True)

        print("-> Running BEFORE (Baseline) TTS Evaluation...")
        before_res = evaluate_tts_stage(tts, voice_prompt, tasks, label, "before")

        print("-> Applying Weight-Space Programming (WSP) to `talker.model.layers[18, 22, 25].mlp.down_proj.weight`...")
        edit_manifest = calibrate_and_apply_talker_wsp(tts, voice_prompt, target_layers=(18, 22, 25), k_cols=64, alpha=2.5)

        print("-> Running AFTER (WSP Reweighted) TTS Evaluation...")
        after_res = evaluate_tts_stage(tts, voice_prompt, tasks, label, "after")

        all_tts_results[label] = {
            "snapshot_path": path,
            "talker_architecture": {
                "num_layers": len(tts.model.talker.model.layers),
                "hidden_size": tts.model.talker.model.config.hidden_size,
                "intermediate_size": tts.model.talker.model.config.intermediate_size,
            },
            "wsp_edit_manifest": edit_manifest,
            "before": before_res,
            "after": after_res,
        }

        del tts
        torch.cuda.empty_cache()

    out_json = ROOT / "outputs" / "tts_wsp_comparison.json"
    out_json.write_text(json.dumps(all_tts_results, indent=2), encoding="utf-8")
    print(f"\nSaved complete TTS Before/After results to {out_json}")


if __name__ == "__main__":
    main()
