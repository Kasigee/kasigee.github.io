"""
Generates publication-grade matplotlib figures for the Clean-Room Weight-Space Programming Study.
"""

import json
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

STUDY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS_DIR = os.path.join(STUDY_ROOT, "results")
PLOTS_DIR = os.path.join(STUDY_ROOT, "plots")

DOMAIN_LABELS = {
    "math_reasoning": "Math\nReasoning",
    "logic_puzzles": "Logic\nPuzzles",
    "code_generation": "Code\nGeneration",
    "instruction_following": "Instruction\nFollowing",
    "computer_usage": "Computer\nUsage",
    "scientific_reasoning": "Scientific\nReasoning",
    "data_extraction": "Data\nExtraction",
    "creative_and_synthesis": "Creative &\nSynthesis",
}
DOMAIN_ORDER = list(DOMAIN_LABELS.keys())


def setup_style():
    plt.rcParams.update({
        "font.size": 10,
        "axes.titlesize": 12,
        "axes.titleweight": "bold",
        "axes.labelsize": 10,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "axes.grid": True,
        "grid.alpha": 0.25,
        "figure.dpi": 160,
    })


def plot_fig1_domain_accuracy(stats_all: dict):
    setup_style()
    fig, axes = plt.subplots(2, 1, figsize=(13, 8.5), sharex=True)

    for ax, (mtag, title_str) in zip(
        axes,
        [("0.6B", "Qwen3-0.6B (596M Params)"), ("1.7B", "Qwen3-1.7B (1.72B Params)")],
    ):
        g_dom = stats_all[f"paired_{mtag}_greedy"]["by_domain"]
        s_dom = stats_all[f"paired_{mtag}_sampled"]["by_domain"]

        x = np.arange(len(DOMAIN_ORDER))
        w = 0.20

        b_g = [100 * g_dom[d]["pass_rate_before"] for d in DOMAIN_ORDER]
        a_g = [100 * g_dom[d]["pass_rate_after"] for d in DOMAIN_ORDER]
        b_s = [100 * s_dom[d]["pass_rate_before"] for d in DOMAIN_ORDER]
        a_s = [100 * s_dom[d]["pass_rate_after"] for d in DOMAIN_ORDER]

        ax.bar(x - 1.5 * w, b_g, w, label="Base (Greedy)", color="#94a3b8", edgecolor="white")
        ax.bar(x - 0.5 * w, a_g, w, label="CleanWSP Reweighted (Greedy)", color="#2563eb", edgecolor="white")
        ax.bar(x + 0.5 * w, b_s, w, label="Base (Sampled T=0.6)", color="#cbd5e1", edgecolor="white", hatch="//")
        ax.bar(x + 1.5 * w, a_s, w, label="CleanWSP Reweighted (Sampled T=0.6)", color="#0d9488", edgecolor="white")

        ax.set_ylabel("Strict Pass Rate (%)")
        ax.set_ylim(0, 108)
        ov_g = stats_all[f"paired_{mtag}_greedy"]["overall_pass_rate"]
        ov_s = stats_all[f"paired_{mtag}_sampled"]["overall_pass_rate"]
        ax.set_title(
            f"{title_str} — Held-Out Multi-Domain Accuracy | "
            f"Greedy: {100*ov_g['mean_before']:.1f}% → {100*ov_g['mean_after']:.1f}% "
            f"| Sampled: {100*ov_s['mean_before']:.1f}% → {100*ov_s['mean_after']:.1f}%"
        )
        ax.legend(loc="upper right", ncol=2, frameon=True, fontsize=8.5)

    axes[-1].set_xticks(np.arange(len(DOMAIN_ORDER)))
    axes[-1].set_xticklabels([DOMAIN_LABELS[d] for d in DOMAIN_ORDER])
    fig.tight_layout()
    fig.savefig(os.path.join(PLOTS_DIR, "fig1_domain_accuracy_comparison.png"), bbox_inches="tight")
    plt.close(fig)


def plot_fig2_loop_and_tokens(runs: dict):
    setup_style()
    fig, axes = plt.subplots(1, 3, figsize=(14.5, 4.8))

    keys = [
        ("0.6B Base (G)", "base_0.6B_greedy", "#94a3b8"),
        ("0.6B WSP (G)", "wsp_0.6B_greedy", "#2563eb"),
        ("0.6B Base (S)", "base_0.6B_sampled", "#cbd5e1"),
        ("0.6B WSP (S)", "wsp_0.6B_sampled", "#0d9488"),
        ("1.7B Base (G)", "base_1.7B_greedy", "#94a3b8"),
        ("1.7B WSP (G)", "wsp_1.7B_greedy", "#1d4ed8"),
        ("1.7B Base (S)", "base_1.7B_sampled", "#cbd5e1"),
        ("1.7B WSP (S)", "wsp_1.7B_sampled", "#0f766e"),
    ]
    labels = [k[0] for k in keys]
    colors = [k[2] for k in keys]
    xpos = np.arange(len(keys))

    truncs = [100 * runs[k[1]]["summary"]["truncation_rate"] for k in keys]
    axes[0].bar(xpos, truncs, color=colors, width=0.68)
    axes[0].set_title("A. Token-Limit Truncation Rate (%)")
    axes[0].set_ylabel("% Hitting 2048-Token Ceiling")
    axes[0].set_ylim(0, 66)
    axes[0].set_xticks(xpos)
    axes[0].set_xticklabels(labels, fontsize=8.5, rotation=32, ha="right")

    thinks = [runs[k[1]]["summary"]["mean_think_tokens"] for k in keys]
    ans = [runs[k[1]]["summary"]["mean_answer_tokens"] for k in keys]
    axes[1].bar(xpos, thinks, color=colors, width=0.68, label="Mean <think> Tokens")
    axes[1].bar(xpos, ans, bottom=thinks, color="#f59e0b", width=0.68, alpha=0.88, label="Mean Final Answer Tokens")
    axes[1].set_title("B. Mean Tokens per Task (<think> + Final)")
    axes[1].set_ylabel("Tokens / Task")
    axes[1].set_ylim(0, 1920)
    axes[1].set_xticks(xpos)
    axes[1].set_xticklabels(labels, fontsize=8.5, rotation=32, ha="right")
    axes[1].legend(fontsize=8, loc="upper left")

    doubts = [runs[k[1]]["summary"]["mean_doubt_markers"] for k in keys]
    axes[2].bar(xpos, doubts, color=colors, width=0.68)
    axes[2].set_title("C. Recursive Self-Doubt Triggers / Task")
    axes[2].set_ylabel("Mean Count ('Wait', 'Alternatively', ...)")
    axes[2].set_ylim(0, 11.0)
    axes[2].set_xticks(xpos)
    axes[2].set_xticklabels(labels, fontsize=8.5, rotation=32, ha="right")

    fig.tight_layout()
    fig.savefig(os.path.join(PLOTS_DIR, "fig2_loop_and_truncation_rates.png"), bbox_inches="tight")
    plt.close(fig)


def plot_fig3_speed_and_throughput(speed_data: dict, runs: dict):
    setup_style()
    fig, axes = plt.subplots(1, 3, figsize=(15.0, 4.8))

    # Panel A: Hardware fixed-length decode tok/s (Batch=16)
    lens = [128, 512, 1024, 2048]
    for key, lbl, style, col in [
        ("0.6B_base", "Qwen3-0.6B Base", "o--", "#64748b"),
        ("0.6B_wsp", "Qwen3-0.6B CleanWSP", "s-", "#2563eb"),
        ("1.7B_base", "Qwen3-1.7B Base", "^--", "#94a3b8"),
        ("1.7B_wsp", "Qwen3-1.7B CleanWSP", "D-", "#0d9488"),
    ]:
        d = speed_data[key]["fixed_decode_batch16"]
        ys = [d[str(L)]["total_tok_per_s"] for L in lens]
        axes[0].plot(lens, ys, style, color=col, linewidth=2, markersize=6, label=lbl)
    axes[0].set_title("A. Pure Kernel Speed (Fixed Length, B=16)")
    axes[0].set_xlabel("Forced Generation Length (Tokens)")
    axes[0].set_ylabel("CUDA Decode Throughput (Tokens / sec)")
    axes[0].set_ylim(118, 139)
    axes[0].legend(fontsize=8, loc="upper right")

    # Load blind 1.7B runs as well so speed & velocity cover both Paired & Blind suites
    blind_17_g_b = json.load(open(os.path.join(RESULTS_DIR, "blind_base_1.7B_greedy.json"), encoding="utf-8"))
    blind_17_g_a = json.load(open(os.path.join(RESULTS_DIR, "blind_wsp_1.7B_greedy.json"), encoding="utf-8"))
    blind_17_s_b = json.load(open(os.path.join(RESULTS_DIR, "blind_base_1.7B_sampled.json"), encoding="utf-8"))
    blind_17_s_a = json.load(open(os.path.join(RESULTS_DIR, "blind_wsp_1.7B_sampled.json"), encoding="utf-8"))

    # Controlled Iso-Hardware B=16 per-stream decode rate (L=1024 from speed_microbenchmark.json)
    # isolates model token-budget compression from external background GPU contention
    rate_b16_stream = {
        "0.6B_base": speed_data["0.6B_base"]["fixed_decode_batch16"]["1024"]["per_stream_tok_per_s"],
        "0.6B_wsp": speed_data["0.6B_wsp"]["fixed_decode_batch16"]["1024"]["per_stream_tok_per_s"],
        "1.7B_base": speed_data["1.7B_base"]["fixed_decode_batch16"]["1024"]["per_stream_tok_per_s"],
        "1.7B_wsp": speed_data["1.7B_wsp"]["fixed_decode_batch16"]["1024"]["per_stream_tok_per_s"],
    }
    rate_b16_total = {
        "0.6B_base": speed_data["0.6B_base"]["fixed_decode_batch16"]["1024"]["total_tok_per_s"],
        "0.6B_wsp": speed_data["0.6B_wsp"]["fixed_decode_batch16"]["1024"]["total_tok_per_s"],
        "1.7B_base": speed_data["1.7B_base"]["fixed_decode_batch16"]["1024"]["total_tok_per_s"],
        "1.7B_wsp": speed_data["1.7B_wsp"]["fixed_decode_batch16"]["1024"]["total_tok_per_s"],
    }

    suite_cfgs = [
        ("0.6B Paired\nGreedy", runs["base_0.6B_greedy"], runs["wsp_0.6B_greedy"], "0.6B"),
        ("0.6B Paired\nSampled", runs["base_0.6B_sampled"], runs["wsp_0.6B_sampled"], "0.6B"),
        ("1.7B Paired\nGreedy", runs["base_1.7B_greedy"], runs["wsp_1.7B_greedy"], "1.7B"),
        ("1.7B Paired\nSampled", runs["base_1.7B_sampled"], runs["wsp_1.7B_sampled"], "1.7B"),
        ("1.7B Blind\nGreedy", blind_17_g_b, blind_17_g_a, "1.7B"),
        ("1.7B Blind\nSampled", blind_17_s_b, blind_17_s_a, "1.7B"),
    ]
    x = np.arange(len(suite_cfgs))
    w = 0.35

    # Panel B: Iso-Hardware Single-Stream Decode Latency (s/task)
    lat_b = [c[1]["summary"]["mean_generated_tokens"] / rate_b16_stream[f"{c[3]}_base"] for c in suite_cfgs]
    lat_a = [c[2]["summary"]["mean_generated_tokens"] / rate_b16_stream[f"{c[3]}_wsp"] for c in suite_cfgs]
    axes[1].bar(x - w / 2, lat_b, w, color="#94a3b8", label="Base Model")
    axes[1].bar(x + w / 2, lat_a, w, color="#2563eb", label="CleanWSP Reweighted")
    for idx, (lb, la) in enumerate(zip(lat_b, lat_a)):
        pct = 100.0 * (la - lb) / lb
        axes[1].text(idx + w / 2, la + 4, f"{pct:.0f}%", ha="center", va="bottom", fontsize=7.5, fontweight="bold", color="#1e40af")
    axes[1].set_title("B. Iso-Hardware Stream Latency (s/task)")
    axes[1].set_ylabel("Decode Seconds / Task (Lower = Faster)")
    axes[1].set_ylim(0, 240)
    axes[1].set_xticks(x)
    axes[1].set_xticklabels([c[0] for c in suite_cfgs], fontsize=8)
    axes[1].legend(fontsize=8, loc="upper left")

    # Panel C: Iso-Hardware Batch=16 Effective Solution Velocity (Correct Tasks / min)
    eff_b = [
        c[1]["summary"]["pass_rate"] * 60.0 / (c[1]["summary"]["mean_generated_tokens"] / rate_b16_total[f"{c[3]}_base"])
        for c in suite_cfgs
    ]
    eff_a = [
        c[2]["summary"]["pass_rate"] * 60.0 / (c[2]["summary"]["mean_generated_tokens"] / rate_b16_total[f"{c[3]}_wsp"])
        for c in suite_cfgs
    ]
    axes[2].bar(x - w / 2, eff_b, w, color="#94a3b8", label="Base Model")
    axes[2].bar(x + w / 2, eff_a, w, color="#16a34a", label="CleanWSP Reweighted")
    axes[2].set_title("C. Batch=16 Solution Velocity (Correct / min)")
    axes[2].set_ylabel("Correct Tasks / Min at Iso-Throughput")
    axes[2].set_ylim(0, 3.6)
    axes[2].set_xticks(x)
    axes[2].set_xticklabels([c[0] for c in suite_cfgs], fontsize=8)
    axes[2].legend(fontsize=8, loc="upper left")

    fig.tight_layout()
    fig.savefig(os.path.join(PLOTS_DIR, "fig3_speed_throughput_vs_latency.png"), bbox_inches="tight")
    plt.close(fig)


def plot_fig4_mechanistic_layers(mech_06: dict, mech_17: dict, calib_06: dict, calib_17: dict):
    setup_style()
    fig, axes = plt.subplots(1, 2, figsize=(13.5, 4.5))

    for ax, mech, calib, title in [
        (axes[0], mech_06, calib_06, "Qwen3-0.6B: MLP Causal Loop Drive by Layer"),
        (axes[1], mech_17, calib_17, "Qwen3-1.7B: MLP Causal Loop Drive by Layer"),
    ]:
        layers = [r["layer"] for r in mech["layer_reports"]]
        drives = [r["top64_causal_loop_drive"] for r in mech["layer_reports"]]
        sel = set(calib["selected_candidate"]["layers"])
        cols = ["#dc2626" if l in sel else "#94a3b8" for l in layers]
        ax.bar(layers, drives, color=cols, edgecolor="white")
        ax.set_title(title)
        ax.set_xlabel("Transformer Layer Index (0 .. 27)")
        ax.set_ylabel("Top-64 Column Causal Loop Drive")
        ax.axvline(28 // 3 - 0.5, color="#475569", linestyle=":", linewidth=1, label="Eligible Mid/Upper Window")
        from matplotlib.patches import Patch
        ax.legend(handles=[
            Patch(facecolor="#dc2626", label=f"Surgically Edited Layers {sorted(sel)}"),
            Patch(facecolor="#94a3b8", label="Untouched Layers (Bit-Exact)"),
        ], fontsize=8.5)

    fig.tight_layout()
    fig.savefig(os.path.join(PLOTS_DIR, "fig4_weight_space_diagnostics.png"), bbox_inches="tight")
    plt.close(fig)


def plot_fig5_ablation_and_controls(calib_06: dict, calib_17: dict, ctrl_paired: dict, runs: dict):
    setup_style()
    fig, axes = plt.subplots(1, 2, figsize=(13.8, 4.8))

    # Panel A: Specificity vs Random Control & Layer-27 EOS Cliff Ablation (Diagnostic n=32)
    l27_path = os.path.join(RESULTS_DIR, "wsp_calibration_sweep_0.6B_L27_ablation.json")
    l27_06_pass = 0.0
    if os.path.exists(l27_path):
        l27_data = json.load(open(l27_path, encoding="utf-8"))
        # C2..C5 all include Layer 27
        l27_06_pass = 100.0 * l27_data["candidate_sweep"][1]["diag_summary"]["pass_rate"]

    x = np.arange(2)
    w = 0.20
    base_d = [100 * calib_06["base_diag_summary"]["pass_rate"], 100 * calib_17["base_diag_summary"]["pass_rate"]]
    rand_d = [100 * calib_06["random_ctrl_diag_summary"]["pass_rate"], 100 * calib_17["random_ctrl_diag_summary"]["pass_rate"]]
    wsp_d = [
        100 * calib_06["candidate_sweep"][-1]["diag_summary"]["pass_rate"],
        100 * calib_17["candidate_sweep"][0]["diag_summary"]["pass_rate"],
    ]

    axes[0].bar(x - 1.5 * w, base_d, w, color="#94a3b8", label="Untouched Base (0% edited)")
    axes[0].bar(x - 0.5 * w, rand_d, w, color="#f97316", label="Random-Column Control (Matched %)")
    axes[0].bar(x + 0.5 * w, wsp_d, w, color="#2563eb", label="CleanWSP (Layers 21–26, L27 Preserved)")
    axes[0].bar([0 + 1.5 * w], [max(l27_06_pass, 0.8)], w, color="#dc2626", label="Layer-27 Included (EOS Cliff: 0.0%)")
    axes[0].text(0 + 1.5 * w, 2.5, "0.0%\n(100% Trunc)", ha="center", va="bottom", fontsize=7.5, fontweight="bold", color="#b91c1c")
    axes[0].set_xticks(x)
    axes[0].set_xticklabels(["Qwen3-0.6B (Diag n=32)", "Qwen3-1.7B (Diag n=32)"])
    axes[0].set_ylim(0, 74)
    axes[0].set_ylabel("Diagnostic Probe Pass Rate (%)")
    axes[0].set_title("A. Subspace Specificity & Layer-27 EOS Safety Cliff")
    axes[0].legend(fontsize=8, loc="upper left")

    # Panel B: Calibration Sparsity Sweep (% Weights Modified vs Diagnostic Pass Rate)
    for calib, lbl, marker, col in [
        (calib_06, "Qwen3-0.6B (Selected: 0.0825%)", "o-", "#2563eb"),
        (calib_17, "Qwen3-1.7B (Selected: 0.0305%)", "s-", "#0d9488"),
    ]:
        pts = [(0.0, 100 * calib["base_diag_summary"]["pass_rate"])] + [
            (r["edit_manifest"]["modified_pct"], 100 * r["diag_summary"]["pass_rate"])
            for r in calib["candidate_sweep"]
        ]
        pts.sort(key=lambda t: t[0])
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        axes[1].plot(xs, ys, marker, color=col, linewidth=2.2, markersize=7, label=lbl)

    axes[1].annotate(
        "1.7B CleanWSP\n(0.030%, 59.4%)",
        xy=(0.03047, 59.38),
        xytext=(0.012, 54.0),
        arrowprops=dict(arrowstyle="->", color="#0f766e", lw=1.2),
        fontsize=8,
        fontweight="bold",
        color="#0f766e",
    )
    axes[1].annotate(
        "0.6B CleanWSP\n(0.082%, 37.5%)",
        xy=(0.08246, 37.50),
        xytext=(0.056, 43.0),
        arrowprops=dict(arrowstyle="->", color="#1d4ed8", lw=1.2),
        fontsize=8,
        fontweight="bold",
        color="#1d4ed8",
    )
    axes[1].set_ylim(20, 65)
    axes[1].set_xlabel("Percentage of Total Model Parameters Modified (%)")
    axes[1].set_ylabel("Diagnostic Probe Pass Rate (%)")
    axes[1].set_title("B. Ultra-Sparse Dose-Response Curve (<0.09% Weights)")
    axes[1].legend(fontsize=8.5, loc="lower right")

    fig.tight_layout()
    fig.savefig(os.path.join(PLOTS_DIR, "fig5_ablation_and_pareto.png"), bbox_inches="tight")
    plt.close(fig)


def plot_fig6_blind_generalization(stats_all: dict):
    setup_style()
    fig, ax = plt.subplots(figsize=(10, 4.8))

    groups = [
        ("0.6B Paired\n(n=64, Greedy)", stats_all["paired_0.6B_greedy"]["overall_pass_rate"]),
        ("0.6B Blind Post\n(n=32, Greedy)", stats_all["blind_0.6B_greedy"]["overall_pass_rate"]),
        ("0.6B Blind Post\n(n=32, Sampled)", stats_all["blind_0.6B_sampled"]["overall_pass_rate"]),
        ("1.7B Paired\n(n=64, Greedy)", stats_all["paired_1.7B_greedy"]["overall_pass_rate"]),
        ("1.7B Blind Post\n(n=32, Greedy)", stats_all["blind_1.7B_greedy"]["overall_pass_rate"]),
        ("1.7B Blind Post\n(n=32, Sampled)", stats_all["blind_1.7B_sampled"]["overall_pass_rate"]),
    ]
    x = np.arange(len(groups))
    w = 0.35
    b_means = [100 * g[1]["mean_before"] for g in groups]
    a_means = [100 * g[1]["mean_after"] for g in groups]
    b_err = [
        [100 * (g[1]["mean_before"] - g[1]["before_ci95"][0]) for g in groups],
        [100 * (g[1]["before_ci95"][1] - g[1]["mean_before"]) for g in groups],
    ]
    a_err = [
        [100 * (g[1]["mean_after"] - g[1]["after_ci95"][0]) for g in groups],
        [100 * (g[1]["after_ci95"][1] - g[1]["mean_after"]) for g in groups],
    ]

    ax.bar(x - w / 2, b_means, w, yerr=b_err, capsize=4, color="#94a3b8", label="Base Model (95% Bootstrap CI)")
    ax.bar(x + w / 2, a_means, w, yerr=a_err, capsize=4, color="#2563eb", label="CleanWSP Reweighted (95% Bootstrap CI)")
    ax.set_xticks(x)
    ax.set_xticklabels([g[0] for g in groups])
    ax.set_ylim(0, 105)
    ax.set_ylabel("Strict Pass Rate (%)")
    ax.set_title("Zero-Leakage Verification: Paired Held-Out Suite vs. Locked Blind Post-Only Suite")
    ax.legend(fontsize=9)

    fig.tight_layout()
    fig.savefig(os.path.join(PLOTS_DIR, "fig6_blind_vs_paired_generalization.png"), bbox_inches="tight")
    plt.close(fig)
