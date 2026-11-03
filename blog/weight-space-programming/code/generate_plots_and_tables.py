"""Generates publication-grade Matplotlib charts and Markdown/HTML comparison tables for the report."""
import json
from pathlib import Path
import numpy as np
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent  # project root (the scripts lived in <root>/scripts)
PLOTS_DIR = ROOT / "plots"
PLOTS_DIR.mkdir(parents=True, exist_ok=True)

plt.rcParams.update({
    "font.family": "sans-serif",
    "font.size": 11,
    "axes.titlesize": 13,
    "axes.titleweight": "bold",
    "axes.labelsize": 11,
    "figure.dpi": 180,
    "axes.spines.top": False,
    "axes.spines.right": False,
})


def load_eval(model_label: str, stage: str) -> dict:
    p = ROOT / "outputs" / stage / f"{model_label}_{stage}_results.json"
    return json.loads(p.read_text(encoding="utf-8"))


def plot_overall_accuracy_and_cutoffs(b06: dict, a06: dict, b17: dict, a17: dict):
    fig, axes = plt.subplots(1, 2, figsize=(13, 5.2))

    models = ["Qwen3-0.6B", "Qwen3-1.7B"]
    x = np.arange(len(models))
    w = 0.34

    # Subplot 1: Strict Multi-Domain Accuracy (%)
    before_acc = [b06["strict_accuracy_pct"], b17["strict_accuracy_pct"]]
    after_acc = [a06["strict_accuracy_pct"], a17["strict_accuracy_pct"]]

    bars1 = axes[0].bar(x - w / 2, before_acc, w, label="Baseline (Before WSP)", color="#64748b", edgecolor="#334155")
    bars2 = axes[0].bar(x + w / 2, after_acc, w, label="Reweighted (After WSP)", color="#0ea5e9", edgecolor="#0369a1")
    axes[0].set_title("Multi-Domain Strict Accuracy (%, Higher is Better)")
    axes[0].set_ylabel("Strict Accuracy (%) across 30 Held-Out Tasks")
    axes[0].set_xticks(x)
    axes[0].set_xticklabels(models, fontweight="bold")
    axes[0].set_ylim(0, 105)
    axes[0].grid(axis="y", linestyle="--", alpha=0.35)
    axes[0].legend(loc="upper left")

    for b in list(bars1) + list(bars2):
        h = b.get_height()
        axes[0].annotate(
            f"{h:.1f}%",
            xy=(b.get_x() + b.get_width() / 2, h),
            xytext=(0, 4),
            textcoords="offset points",
            ha="center",
            va="bottom",
            fontweight="bold",
            fontsize=10,
        )

    # Subplot 2: Token Budget Cutoff / Infinite Loop Rate (%)
    before_cut = [b06["cutoff_rate_pct"], b17["cutoff_rate_pct"]]
    after_cut = [a06["cutoff_rate_pct"], a17["cutoff_rate_pct"]]

    bars3 = axes[1].bar(x - w / 2, before_cut, w, label="Baseline (Before WSP)", color="#ef4444", edgecolor="#991b1b")
    bars4 = axes[1].bar(x + w / 2, after_cut, w, label="Reweighted (After WSP)", color="#10b981", edgecolor="#047857")
    axes[1].set_title("Thinking Loop / Token Cutoff Rate (%, Lower is Better)")
    axes[1].set_ylabel("Cutoff Rate (%) at 1,024-Token Limit")
    axes[1].set_xticks(x)
    axes[1].set_xticklabels(models, fontweight="bold")
    axes[1].set_ylim(0, 105)
    axes[1].grid(axis="y", linestyle="--", alpha=0.35)
    axes[1].legend(loc="upper right")

    for b in list(bars3) + list(bars4):
        h = b.get_height()
        axes[1].annotate(
            f"{h:.1f}%",
            xy=(b.get_x() + b.get_width() / 2, h),
            xytext=(0, 4),
            textcoords="offset points",
            ha="center",
            va="bottom",
            fontweight="bold",
            fontsize=10,
        )

    fig.suptitle("Impact of Weight-Space Programming (WSP) on Small Qwen3 Models", fontsize=14, fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(PLOTS_DIR / "fig1_accuracy_and_cutoffs.png", bbox_inches="tight")
    plt.close(fig)


def plot_domain_breakdown(b06: dict, a06: dict, b17: dict, a17: dict):
    domains = sorted(list(b06["domain_breakdown"].keys()))
    short_names = [
        d.replace("Physical & Life Sciences", "Sciences")
         .replace("Software Engineering", "Coding")
         .replace("Instruction Following", "Instruction")
         .replace("Deductive Logic", "Logic")
         .replace("Computer Usage", "Computer Use")
        for d in domains
    ]

    fig, axes = plt.subplots(1, 2, figsize=(14, 5.5), sharey=True)
    x = np.arange(len(domains))
    w = 0.36

    for ax, b_ev, a_ev, title in [
        (axes[0], b06, a06, "Qwen3-0.6B: Accuracy by Domain"),
        (axes[1], b17, a17, "Qwen3-1.7B: Accuracy by Domain"),
    ]:
        b_vals = [b_ev["domain_breakdown"][d]["strict_accuracy_pct"] for d in domains]
        a_vals = [a_ev["domain_breakdown"][d]["strict_accuracy_pct"] for d in domains]
        rects1 = ax.bar(x - w / 2, b_vals, w, label="Baseline (Before)", color="#94a3b8", edgecolor="#475569")
        rects2 = ax.bar(x + w / 2, a_vals, w, label="WSP Reweighted (After)", color="#2563eb", edgecolor="#1d4ed8")
        ax.set_title(title)
        ax.set_xticks(x)
        ax.set_xticklabels(short_names, rotation=22, ha="right", fontweight="bold")
        ax.set_ylim(0, 110)
        ax.grid(axis="y", linestyle="--", alpha=0.35)
        ax.legend(loc="upper left")
        for r in list(rects1) + list(rects2):
            h = r.get_height()
            ax.annotate(
                f"{int(round(h))}%",
                xy=(r.get_x() + r.get_width() / 2, h),
                xytext=(0, 3),
                textcoords="offset points",
                ha="center",
                va="bottom",
                fontsize=8.5,
                fontweight="bold",
            )
    axes[0].set_ylabel("Strict Accuracy (%)")
    fig.suptitle("Zero-Leakage Multi-Domain Generalization Across 6 Domains", fontsize=14, fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(PLOTS_DIR / "fig2_domain_breakdown.png", bbox_inches="tight")
    plt.close(fig)


def plot_speed_vs_tokens(b06: dict, a06: dict, b17: dict, a17: dict):
    fig, axes = plt.subplots(1, 3, figsize=(15.5, 5.0))
    models = ["Qwen3-0.6B", "Qwen3-1.7B"]
    x = np.arange(len(models))
    w = 0.34

    # Panel 1: Raw Single-Stream Decode Throughput (tok/s)
    b_toks = [
        b06["single_stream_hardware_benchmark"]["avg_single_stream_tok_per_s"],
        b17["single_stream_hardware_benchmark"]["avg_single_stream_tok_per_s"],
    ]
    a_toks = [
        a06["single_stream_hardware_benchmark"]["avg_single_stream_tok_per_s"],
        a17["single_stream_hardware_benchmark"]["avg_single_stream_tok_per_s"],
    ]
    r1 = axes[0].bar(x - w / 2, b_toks, w, label="Baseline (Before)", color="#64748b")
    r2 = axes[0].bar(x + w / 2, a_toks, w, label="WSP Reweighted (After)", color="#8b5cf6")
    axes[0].set_title("Raw Hardware Decode Speed (tok/s)")
    axes[0].set_ylabel("Single-Stream Tokens / Sec")
    axes[0].set_xticks(x)
    axes[0].set_xticklabels(models, fontweight="bold")
    axes[0].set_ylim(0, max(b_toks + a_toks) * 1.28)
    axes[0].grid(axis="y", linestyle="--", alpha=0.35)
    axes[0].legend()
    for r in list(r1) + list(r2):
        h = r.get_height()
        axes[0].annotate(f"{h:.2f}", (r.get_x() + r.get_width() / 2, h), xytext=(0, 3), textcoords="offset points", ha="center", fontweight="bold")

    # Panel 2: Average Tokens Generated per Task
    b_ntok = [b06["avg_total_tokens"], b17["avg_total_tokens"]]
    a_ntok = [a06["avg_total_tokens"], a17["avg_total_tokens"]]
    r3 = axes[1].bar(x - w / 2, b_ntok, w, label="Baseline (Before)", color="#f97316")
    r4 = axes[1].bar(x + w / 2, a_ntok, w, label="WSP Reweighted (After)", color="#14b8a6")
    axes[1].set_title("Avg Generated Tokens / Task (Lower = Faster)")
    axes[1].set_ylabel("Tokens per Task (Think + Answer)")
    axes[1].set_xticks(x)
    axes[1].set_xticklabels(models, fontweight="bold")
    axes[1].set_ylim(0, 1150)
    axes[1].grid(axis="y", linestyle="--", alpha=0.35)
    axes[1].legend()
    for r in list(r3) + list(r4):
        h = r.get_height()
        axes[1].annotate(f"{h:.0f}", (r.get_x() + r.get_width() / 2, h), xytext=(0, 3), textcoords="offset points", ha="center", fontweight="bold")

    # Panel 3: Effective Wall-Clock Task Completion Time (s/task)
    b_lat = [b06["est_single_stream_avg_task_seconds"], b17["est_single_stream_avg_task_seconds"]]
    a_lat = [a06["est_single_stream_avg_task_seconds"], a17["est_single_stream_avg_task_seconds"]]
    r5 = axes[2].bar(x - w / 2, b_lat, w, label="Baseline (Before)", color="#e11d48")
    r6 = axes[2].bar(x + w / 2, a_lat, w, label="WSP Reweighted (After)", color="#16a34a")
    axes[2].set_title("Wall-Clock Time per Task (s, Lower = Faster)")
    axes[2].set_ylabel("Seconds per Completed Task")
    axes[2].set_xticks(x)
    axes[2].set_xticklabels(models, fontweight="bold")
    axes[2].set_ylim(0, max(b_lat + a_lat) * 1.25)
    axes[2].grid(axis="y", linestyle="--", alpha=0.35)
    axes[2].legend()
    for r in list(r5) + list(r6):
        h = r.get_height()
        axes[2].annotate(f"{h:.1f}s", (r.get_x() + r.get_width() / 2, h), xytext=(0, 3), textcoords="offset points", ha="center", fontweight="bold")

    fig.suptitle("Quality vs. Speed Analysis: Raw Tokens/Sec vs. End-to-End Task Latency", fontsize=14, fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(PLOTS_DIR / "fig3_speed_and_latency_analysis.png", bbox_inches="tight")
    plt.close(fig)


def plot_layer_profiles():
    p06_path = ROOT / "calibration" / "wsp_layer_profile_Qwen3-0.6B.json"
    p17_path = ROOT / "calibration" / "wsp_layer_profile_Qwen3-1.7B.json"
    if not (p06_path.exists() and p17_path.exists()):
        return

    p06 = json.loads(p06_path.read_text(encoding="utf-8"))
    p17 = json.loads(p17_path.read_text(encoding="utf-8"))

    fig, axes = plt.subplots(1, 2, figsize=(13.5, 4.8))
    layers = [x["layer"] for x in p06]

    axes[0].plot(layers, [x["relative_separation"] * 100 for x in p06], marker="o", linewidth=2.2, color="#0284c7", label="Qwen3-0.6B (d=1024)")
    axes[0].plot(layers, [x["relative_separation"] * 100 for x in p17], marker="s", linewidth=2.2, color="#7c3aed", label="Qwen3-1.7B (d=2048)")
    axes[0].axvspan(17, 26, color="#fef08a", alpha=0.35, label="Localized WSP Target Zone (Layers 17–26)")
    axes[0].set_title("Layerwise Repetition vs. Productive Separation across 28 Layers")
    axes[0].set_xlabel("Transformer Layer Index (0 to 27)")
    axes[0].set_ylabel("Relative Residual Separation (||Δμ|| / ||W|| %)")
    axes[0].grid(True, linestyle="--", alpha=0.35)
    axes[0].legend()

    # Calibration sweep comparison (Baseline vs Random Orthogonal Control vs WSP)
    s06 = json.loads((ROOT / "calibration" / "wsp_sweep_Qwen3-0.6B.json").read_text(encoding="utf-8"))
    s17 = json.loads((ROOT / "calibration" / "wsp_sweep_Qwen3-1.7B.json").read_text(encoding="utf-8"))

    labels = ["Baseline\n(Unedited)", "Random Orthogonal\nSubspace Control", "Targeted WSP\nRank-1 Surgery"]
    x = np.arange(len(labels))
    w = 0.35
    v06 = [
        s06["baseline_calibration"]["strict_acc_pct"],
        s06["random_orthogonal_control"]["strict_acc_pct"],
        s06["winning_candidate"]["eval"]["strict_acc_pct"],
    ]
    v17 = [
        s17["baseline_calibration"]["strict_acc_pct"],
        s17["random_orthogonal_control"]["strict_acc_pct"],
        s17["winning_candidate"]["eval"]["strict_acc_pct"],
    ]
    b1 = axes[1].bar(x - w / 2, v06, w, label="Qwen3-0.6B", color="#0ea5e9")
    b2 = axes[1].bar(x + w / 2, v17, w, label="Qwen3-1.7B", color="#8b5cf6")
    axes[1].set_title("Causal Specificity on Disjoint Calibration Set (Strict Acc %)")
    axes[1].set_xticks(x)
    axes[1].set_xticklabels(labels, fontweight="bold")
    axes[1].set_ylim(0, 115)
    axes[1].grid(axis="y", linestyle="--", alpha=0.35)
    axes[1].legend()
    for b in list(b1) + list(b2):
        h = b.get_height()
        axes[1].annotate(f"{h:.1f}%", (b.get_x() + b.get_width() / 2, h), xytext=(0, 3), textcoords="offset points", ha="center", fontweight="bold")

    fig.suptitle("Weight-Space Circuit Localization & Causal Ablation Control", fontsize=14, fontweight="bold", y=1.02)
    fig.tight_layout()
    fig.savefig(PLOTS_DIR / "fig4_layer_localization_and_control.png", bbox_inches="tight")
    plt.close(fig)


if __name__ == "__main__":
    b06 = load_eval("Qwen3-0.6B", "before")
    a06 = load_eval("Qwen3-0.6B-WSP", "after")
    b17 = load_eval("Qwen3-1.7B", "before")
    a17 = load_eval("Qwen3-1.7B-WSP", "after")
    plot_overall_accuracy_and_cutoffs(b06, a06, b17, a17)
    plot_domain_breakdown(b06, a06, b17, a17)
    plot_speed_vs_tokens(b06, a06, b17, a17)
    plot_layer_profiles()
    print("All figures generated successfully in", PLOTS_DIR)
