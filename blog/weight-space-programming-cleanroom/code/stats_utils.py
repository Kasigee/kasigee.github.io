"""
Statistical Comparison & ML Best Practices Module:
  - Paired Bootstrap 95% Confidence Intervals (10,000 resamples)
  - Exact Binomial McNemar Test for paired pass/fail transitions
  - Wilcoxon Signed-Rank Test for paired continuous metrics (latency, token counts, tok/s)
  - Slice-based domain & difficulty error/gain breakdown
  - Pass/Fail 2x2 Transition Matrix (Pass->Pass, Fail->Pass, Pass->Fail, Fail->Fail)
"""

import math
import random
from collections import defaultdict
from scipy import stats


def paired_bootstrap_ci(
    vals_before: list[float],
    vals_after: list[float],
    n_boot: int = 10000,
    seed: int = 20261111,
) -> dict:
    assert len(vals_before) == len(vals_after)
    n = len(vals_before)
    rng = random.Random(seed)
    diffs = [a - b for b, a in zip(vals_before, vals_after)]
    obs_before = sum(vals_before) / n
    obs_after = sum(vals_after) / n
    obs_diff = obs_after - obs_before

    boot_diffs = []
    boot_before = []
    boot_after = []
    for _ in range(n_boot):
        idxs = [rng.randrange(n) for _ in range(n)]
        mb = sum(vals_before[i] for i in idxs) / n
        ma = sum(vals_after[i] for i in idxs) / n
        boot_before.append(mb)
        boot_after.append(ma)
        boot_diffs.append(ma - mb)

    boot_diffs.sort()
    boot_before.sort()
    boot_after.sort()
    lo_idx = int(0.025 * n_boot)
    hi_idx = int(0.975 * n_boot)
    return {
        "mean_before": round(obs_before, 4),
        "before_ci95": [round(boot_before[lo_idx], 4), round(boot_before[hi_idx], 4)],
        "mean_after": round(obs_after, 4),
        "after_ci95": [round(boot_after[lo_idx], 4), round(boot_after[hi_idx], 4)],
        "delta": round(obs_diff, 4),
        "delta_ci95": [round(boot_diffs[lo_idx], 4), round(boot_diffs[hi_idx], 4)],
    }


def exact_mcnemar_test(pass_before: list[bool], pass_after: list[bool]) -> dict:
    assert len(pass_before) == len(pass_after)
    pp = pf = fp = ff = 0
    for b, a in zip(pass_before, pass_after):
        if b and a:
            pp += 1
        elif b and not a:
            pf += 1
        elif (not b) and a:
            fp += 1
        else:
            ff += 1
    discordant = pf + fp
    if discordant == 0:
        p_val = 1.0
    else:
        p_val = float(stats.binomtest(fp, n=discordant, p=0.5, alternative="two-sided").pvalue)
    return {
        "pass_to_pass": pp,
        "fail_to_pass_gain": fp,
        "pass_to_fail_regression": pf,
        "fail_to_fail": ff,
        "net_task_gain": fp - pf,
        "mcnemar_exact_p": round(p_val, 6),
    }


def paired_wilcoxon(vals_before: list[float], vals_after: list[float]) -> dict:
    diffs = [a - b for b, a in zip(vals_before, vals_after)]
    if all(abs(d) < 1e-12 for d in diffs):
        return {"wilcoxon_p": 1.0, "median_before": vals_before[0], "median_after": vals_after[0]}
    try:
        res = stats.wilcoxon(vals_before, vals_after, zero_method="wilcox", alternative="two-sided")
        pval = float(res.pvalue)
    except Exception:
        pval = 1.0
    sb = sorted(vals_before)
    sa = sorted(vals_after)
    mid = len(sb) // 2
    med_b = sb[mid] if len(sb) % 2 == 1 else 0.5 * (sb[mid - 1] + sb[mid])
    med_a = sa[mid] if len(sa) % 2 == 1 else 0.5 * (sa[mid - 1] + sa[mid])
    return {
        "median_before": round(med_b, 4),
        "median_after": round(med_a, 4),
        "median_delta": round(med_a - med_b, 4),
        "wilcoxon_p": round(pval, 6),
    }


def compare_paired_runs(before_run: dict, after_run: dict) -> dict:
    rb = {r["task_id"]: r for r in before_run["results"]}
    ra = {r["task_id"]: r for r in after_run["results"]}
    ids = [r["task_id"] for r in before_run["results"]]

    p_b = [1.0 if rb[i]["passed"] else 0.0 for i in ids]
    p_a = [1.0 if ra[i]["passed"] else 0.0 for i in ids]
    s_b = [float(rb[i]["score"]) for i in ids]
    s_a = [float(ra[i]["score"]) for i in ids]
    tok_b = [float(rb[i]["generated_tokens"]) for i in ids]
    tok_a = [float(ra[i]["generated_tokens"]) for i in ids]
    sec_b = [float(rb[i]["total_sec"]) for i in ids]
    sec_a = [float(ra[i]["total_sec"]) for i in ids]
    tps_b = [float(rb[i]["decode_tok_per_s"]) for i in ids]
    tps_a = [float(ra[i]["decode_tok_per_s"]) for i in ids]
    trunc_b = [1.0 if rb[i]["hit_token_limit"] else 0.0 for i in ids]
    trunc_a = [1.0 if ra[i]["hit_token_limit"] else 0.0 for i in ids]

    by_domain = defaultdict(list)
    by_diff = defaultdict(list)
    for i in ids:
        by_domain[rb[i]["domain"]].append(i)
        by_diff[rb[i].get("difficulty", "medium")].append(i)

    domain_table = {}
    for dom, dids in by_domain.items():
        n_d = len(dids)
        pb_d = sum(1 for i in dids if rb[i]["passed"]) / n_d
        pa_d = sum(1 for i in dids if ra[i]["passed"]) / n_d
        sb_d = sum(rb[i]["score"] for i in dids) / n_d
        sa_d = sum(ra[i]["score"] for i in dids) / n_d
        tb_d = sum(rb[i]["generated_tokens"] for i in dids) / n_d
        ta_d = sum(ra[i]["generated_tokens"] for i in dids) / n_d
        lat_b = sum(rb[i]["total_sec"] for i in dids) / n_d
        lat_a = sum(ra[i]["total_sec"] for i in dids) / n_d
        tr_b = sum(1 for i in dids if rb[i]["hit_token_limit"]) / n_d
        tr_a = sum(1 for i in dids if ra[i]["hit_token_limit"]) / n_d
        domain_table[dom] = {
            "n": n_d,
            "pass_rate_before": round(pb_d, 4),
            "pass_rate_after": round(pa_d, 4),
            "pass_rate_delta": round(pa_d - pb_d, 4),
            "partial_score_before": round(sb_d, 4),
            "partial_score_after": round(sa_d, 4),
            "mean_tokens_before": round(tb_d, 1),
            "mean_tokens_after": round(ta_d, 1),
            "mean_sec_before": round(lat_b, 2),
            "mean_sec_after": round(lat_a, 2),
            "trunc_rate_before": round(tr_b, 4),
            "trunc_rate_after": round(tr_a, 4),
        }

    diff_table = {}
    for df, dids in by_diff.items():
        n_d = len(dids)
        pb_d = sum(1 for i in dids if rb[i]["passed"]) / n_d
        pa_d = sum(1 for i in dids if ra[i]["passed"]) / n_d
        diff_table[df] = {
            "n": n_d,
            "pass_rate_before": round(pb_d, 4),
            "pass_rate_after": round(pa_d, 4),
            "pass_rate_delta": round(pa_d - pb_d, 4),
        }

    return {
        "overall_pass_rate": paired_bootstrap_ci(p_b, p_a),
        "overall_partial_score": paired_bootstrap_ci(s_b, s_a),
        "overall_truncation_rate": paired_bootstrap_ci(trunc_b, trunc_a),
        "overall_generated_tokens": {
            **paired_bootstrap_ci(tok_b, tok_a),
            **paired_wilcoxon(tok_b, tok_a),
        },
        "overall_latency_sec": {
            **paired_bootstrap_ci(sec_b, sec_a),
            **paired_wilcoxon(sec_b, sec_a),
        },
        "overall_decode_tok_per_s": {
            **paired_bootstrap_ci(tps_b, tps_a),
            **paired_wilcoxon(tps_b, tps_a),
        },
        "mcnemar_transition": exact_mcnemar_test([rb[i]["passed"] for i in ids], [ra[i]["passed"] for i in ids]),
        "by_domain": domain_table,
        "by_difficulty": diff_table,
    }
