"""Download MIT CSAIL Weight-Space Programming artifacts and Qwen3-0.6B / Qwen3-1.7B models."""
import os
import sys
import urllib.request
from pathlib import Path

# (A machine-specific certificate-bundle setup for a local antivirus proxy was removed here.
#  If you need one, set SSL_CERT_FILE / REQUESTS_CA_BUNDLE in your environment instead.)

import ssl
from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parent.parent  # project root (the scripts lived in <root>/scripts)
MIT_DIR = ROOT / "models" / "mit_csail_astra_edits"
MIT_DIR.mkdir(parents=True, exist_ok=True)

MIT_FILES = {
    "code/apply_edit.py": "https://raw.githubusercontent.com/RikiyaT/lm_understand-logs/main/exp8_math/code/apply_edit.py",
    "code/st_numpy.py": "https://raw.githubusercontent.com/RikiyaT/lm_understand-logs/main/exp8_math/code/st_numpy.py",
    "code/profiles.py": "https://raw.githubusercontent.com/RikiyaT/lm_understand-logs/main/exp8_math/code/profiles.py",
    "code/build_ckpt.py": "https://raw.githubusercontent.com/RikiyaT/lm_understand-logs/main/exp8_math/code/build_ckpt.py",
    "p50c/manifest.json": "https://raw.githubusercontent.com/RikiyaT/lm_understand-logs/main/exp8_math/p50c/edit/manifest.json",
    "p50c/edit.npz": "https://raw.githubusercontent.com/RikiyaT/lm_understand-logs/main/exp8_math/p50c/edit/edit.npz",
    "p50c/final_report.md": "https://raw.githubusercontent.com/RikiyaT/lm_understand-logs/main/exp8_math/p50c/final_report.md",
    "p50c/submission_evidence.json": "https://raw.githubusercontent.com/RikiyaT/lm_understand-logs/main/exp8_math/p50c/submission_evidence.json",
    "p50c/frozen_weights_manifest.json": "https://raw.githubusercontent.com/RikiyaT/lm_understand-logs/main/exp8_math/p50c/frozen_weights_manifest.json",
    "p10c/manifest.json": "https://raw.githubusercontent.com/RikiyaT/lm_understand-logs/main/exp8_math/p10c/edit/manifest.json",
    "p25c/manifest.json": "https://raw.githubusercontent.com/RikiyaT/lm_understand-logs/main/exp8_math/p25c/edit/manifest.json",
}

ctx = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE"))

print("=== Downloading MIT CSAIL Weight-Space Programming Reference Artifacts ===")
for rel_path, url in MIT_FILES.items():
    dest = MIT_DIR / rel_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        print(f"Downloading {rel_path}...")
        try:
            with urllib.request.urlopen(url, context=ctx) as resp:
                dest.write_bytes(resp.read())
        except Exception as e:
            print(f"Warning: could not fetch {rel_path}: {e}")
    else:
        print(f"Already exists: {rel_path}")

print("\n=== Downloading Qwen/Qwen3-0.6B and Qwen/Qwen3-1.7B Base Causal LM Checkpoints ===")
for repo_id in ["Qwen/Qwen3-0.6B", "Qwen/Qwen3-1.7B"]:
    local_name = repo_id.split("/")[-1]
    local_dir = ROOT / "models" / local_name
    print(f"Fetching {repo_id} -> {local_dir} ...")
    path = snapshot_download(
        repo_id=repo_id,
        local_dir=str(local_dir),
        ignore_patterns=["*.msgpack", "*.h5", "*.ot"],
    )
    print(f"Completed {repo_id} at {path}")

print("\nAll downloads complete!")
