# Code for "Editing 0.1% of a small model's weights"

These are the scripts behind the blog post at
<https://kasimirgregory.com/blog/weight-space-programming/>.

**Who wrote them.** Gemini Argon 4 wrote and ran all of these scripts, working as a coding agent
in Antigravity on Kas Gregory's computer. They are published as they were run, apart from the
changes listed under "What was changed for publication". Claude Opus 5.5 read them while checking
the initial report, and the post describes several places where the code and the report disagree.

## What each script does

| Script | Purpose |
|---|---|
| `download_mit_csail_and_qwen.py` | Downloads the original study's released edit files (from `github.com/RikiyaT/lm_understand-logs`, `exp8_math`) and the Qwen3-0.6B and Qwen3-1.7B models. |
| `build_benchmarks_and_verify_zero_leakage.py` | Holds the calibration data (8 contrastive trace pairs, 6 live questions) and the 30-task test suite, and checks that the two share no 5-grams or 6-grams. |
| `run_calibration_diagnostic.py` | Runs the unedited models on the 6 live calibration questions and saves their traces. |
| `probe_calibration_think_exit.py` | Prints logits for `</think>` at paragraph breaks in those traces (exploratory). |
| `wsp_surgeon.py` | Profiles `mlp.down_proj` in every layer, builds the edit direction, sweeps six settings on the calibration questions, runs the random-direction control and saves the edited model with a manifest of changed tensors. |
| `update_06b_wsp_5layer.py` | The second-pass edit for Qwen3-0.6B (5 layers, K = 112, α = 5.8, β = 0.13), applied after the first edit was tested. |
| `evaluate_suite.py` | Runs all 30 tasks (greedy decoding, 1,024 new tokens, batch of 10) and a short single-stream speed benchmark. |
| `graders.py` | Grades each task: boxed answers, unit tests for code, programmatic checks for instruction following and computer use. |
| `patch_before_eval_for_math02.py` | Re-runs the baseline on `math_02` after a typo in its prompt was fixed, and regrades two other tasks. |
| `regrade_all.py` | Regrades every saved output with the final `graders.py`. |
| `generate_plots_and_tables.py` | Draws Figures 1–4. |
| `build_interactive_comparison_viewer.py` | Builds the side-by-side output viewer from the initial report. |
| `evaluate_and_edit_tts.py` | Applies the same kind of edit to the speech transformer in Qwen3-TTS and compares audio before and after. |

The scripts expect to sit in a `scripts/` folder inside the project, next to `models/`,
`calibration/`, `benchmarks/` and `outputs/`. They need a CUDA GPU, PyTorch and Hugging Face
`transformers`; the TTS script also needs the `qwen_tts` package and `soundfile`.

## Things to know before reusing them

- **Grading.** For boxed answers, `graders.py` falls back to a box at the end of the `<think>`
  block when there is none after `</think>`. The post reports results with and without that
  fallback.
- **Code tests run in-process.** Generated code is run with `exec` in the grading process, not in
  an isolated subprocess. Don't run it on untrusted model output outside a disposable environment.
- **Random-direction control.** The docstring in `wsp_surgeon.py` calls the control
  "norm-matched". The code uses a random direction on randomly chosen columns and does not scale
  the change to match the targeted edit.
- **Speed benchmark.** `evaluate_suite.py` benchmarks 3 tasks capped at 256 tokens. The
  Qwen3-0.6B baseline results came from an earlier version that used 6 tasks and 1,024 tokens.
- **Second-pass 0.6B edit.** `update_06b_wsp_5layer.py` was chosen after the first 0.6B edit had
  been tested on the 30 tasks, so the 0.6B results are not a held-out evaluation.

## What was changed for publication

- Absolute paths to the project folder on the original computer were replaced with a path
  relative to this folder (`ROOT = Path(__file__).resolve().parent.parent`).
- A certificate-bundle setup for a local antivirus proxy was removed from the download script.
- In `evaluate_and_edit_tts.py`, the path to the reference voice recording was replaced with a
  placeholder (`WSP_REF_WAV`), and the local model paths with the Hugging Face model names. The
  recording itself is not published, and neither are any model weights.

Nothing else was changed. The model outputs, results and figures are in the post's folder:
`traces.json` holds every output from the 30-task runs.
