# Code for "Clean-room weight-space programming on Qwen3: orthogonal edits vs free baselines"

These are the scripts behind the draft follow-up post at
<https://kasimirgregory.com/blog/weight-space-programming-cleanroom/>.

**Who wrote them.** Gemini 4 Carbon wrote and ran all of these scripts as an autonomous coding agent
in Antigravity on Kas Gregory's computer. Phase 1 (`build_benchmarks.py` through
`generate_reports_and_views.py`) was written, run, SHA-256 checkpoint-locked and reported in an
isolated subfolder *before* the agent inspected any file from Gemini Argon 4's earlier study or read
<https://kasimirgregory.com/blog/weight-space-programming/>. After that comparison was written,
`run_posthoc_followup_tests.py` ran the three follow-up controls proposed at the end of the first
post (`enable_thinking=False`, a `4,096`-token budget, and a gentler `alpha=2.0` edit on `Qwen3-0.6B`).

## What each script does

| Script | Purpose |
|---|---|
| `benchmark_tasks_part1.py`, `benchmark_tasks_part2.py`, `build_benchmarks.py` | Build the 128-task, 8-domain benchmark across three zero-leakage splits (`diagnostic_32`, `heldout_paired_64`, `heldout_blind_32`) and verify zero prompt hash or n-gram collisions across splits. |
| `evaluator.py` | Strict post-`</think>` evaluation harness across all 8 domains: exact symbolic/numeric grading, **isolated subprocess** Python unit tests (`subprocess.run` with timeout), JSON schema + source-value checks, programmatic instruction-constraint checks, and stateful multi-turn sandboxed computer-use sessions (`file_ops`, `log_audit`, `gui_form`, `json_patch`). |
| `weight_space_programmer.py` | Profiles `mlp.down_proj` activations across all 28 layers, orthogonalises the overthinking contrast vector against productive deduction via Gram-Schmidt, blends with an orthogonalised unembedding direction (`beta = 0.74`), runs Logit-Lens vocabulary attribution, builds norm-matched random-direction and top-layer (`L27`) controls, and saves `bf16` checkpoints with parameter manifests. |
| `calibrate_wsp.py` | Runs hyperparameter selection strictly on `diagnostic_suite.json` (`n=32`), discovering the `Layer 27` EOS collapse cliff (`0%` pass rate) and locking `Qwen3-0.6B-CleanWSP` (`L21..26`, `K=64`, `alpha=3.5`) and `Qwen3-1.7B-CleanWSP` (`L22,24,25,26`, `K=64`, `alpha=2.4`) into `frozen_checkpoint_lock.json` prior to any held-out run. |
| `speed_profiler.py`, `run_all_speed_profiles.py` | Measure CUDA-Event prefill TTFT, fixed-length `EOS`-disabled decode tok/s (`128` and `512` tokens at `B=1` and `B=8`), and end-to-end effective task completion velocity. |
| `run_eval_cli.py`, `run_all_heldout_and_speed.py`, `resume_and_complete_all.py` | Execute the pre-registered Greedy and Sampled (`T=0.6`) evaluations on `heldout_paired_suite.json` (`n=64`) and the single-shot blind evaluation on `heldout_blind_post_suite.json` (`n=32`). |
| `stats_utils.py`, `generate_plots.py`, `generate_reports_and_views.py` | Compute 10,000-resample paired bootstrap 95% CIs, exact two-sided McNemar `p`-values, and Phase 1 figures. |
| `run_posthoc_followup_tests.py` | Post-comparison follow-up suite: runs Qwen3's built-in non-thinking mode (`enable_thinking=False`), `4,096`-token budgets, and the gentler `0.6B` checkpoint (`Qwen3-0.6B-CleanWSP-Gentle-a2.0`, `L22,24,25,26`, `alpha=2.0`, skipping `Layer 21`'s bilingual `'But'`/`'但'` pivot). |

## What was changed for publication

- In `run_posthoc_followup_tests.py`, the two absolute project-root constants on the original
  Windows workstation were replaced with `Path(__file__).resolve()` relative paths. Every Phase 1
  script in `src/` already used relative paths and is published byte-for-byte as run.
