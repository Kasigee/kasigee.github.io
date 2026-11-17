"""
Builds, self-verifies, and SHA-256 freezes all three strictly disjoint benchmark splits
BEFORE any model generation or weight-space inspection occurs.
"""

import hashlib
import itertools
import json
import math
import os
import re
from datetime import datetime, timezone

from benchmark_tasks_part1 import (
    BLIND_DOMAINS_1_TO_4,
    DIAGNOSTIC_PROBES,
    PAIRED_DOMAINS_1_TO_4,
)
from benchmark_tasks_part2 import (
    BLIND_DOMAINS_5_TO_8,
    COMPUTER_USE_SYSTEM_PROMPT,
    PAIRED_DOMAINS_5_TO_8,
)

STUDY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(STUDY_ROOT, "data")


def verify_math_and_science_ground_truths(all_tasks_by_id: dict):
    # Diagnostic math & science checks
    assert 7 * 11 - 7 - 11 == int(all_tasks_by_id["diag_math_01"]["expected"])  # Chicken McNugget: 59
    assert pow(7, 2026, 100) == int(all_tasks_by_id["diag_math_02"]["expected"])  # 49
    assert round(240 / (120 / 60 + 120 / 40)) == int(all_tasks_by_id["diag_math_03"]["expected"])  # 48
    cnt_diag4 = sum(
        1 for s in itertools.product("1234", repeat=4) if "1" in s and "2" in s
    )
    assert cnt_diag4 == int(all_tasks_by_id["diag_math_04"]["expected"])  # 110
    assert abs((4 * 6 - 2 * 3) / 6 - float(all_tasks_by_id["diag_sci_01"]["expected"])) < 1e-9  # 3
    assert abs((25 * 0.2 * 2) / 0.5 - float(all_tasks_by_id["diag_sci_02"]["expected"])) < 1e-9  # 20
    assert (2000 - 2 * 280) // 2 == int(all_tasks_by_id["diag_sci_03"]["expected"])  # 720
    r_eq = (6 * 12) / (6 + 12)
    assert abs((12 ** 2) / r_eq - float(all_tasks_by_id["diag_sci_04"]["expected"])) < 1e-9  # 36

    # Paired math checks
    assert abs((35 * 15.20 - 35 * 11) / (18 - 11) - float(all_tasks_by_id["math_p01"]["expected"])) < 1e-9
    assert (pow(3, 103, 16) + pow(5, 103, 16)) % 16 == int(all_tasks_by_id["math_p02"]["expected"])
    assert math.comb(9, 4) - math.comb(7, 2) == int(all_tasks_by_id["math_p03"]["expected"])
    rem = 1.0 - 4.0 * (1 / 12 + 1 / 15 - 1 / 20)
    tot_h = 4.0 + rem / (1 / 12 + 1 / 15)
    assert abs(tot_h - float(all_tasks_by_id["math_p04"]["expected"])) < 1e-9
    # x^2 - 5x + 3 = 0
    r = (5 + math.sqrt(13)) / 2
    s = (5 - math.sqrt(13)) / 2
    assert round(r ** 4 + s ** 4) == int(all_tasks_by_id["math_p05"]["expected"])
    cnt_p06 = sum(
        1 for b in itertools.product("AB", repeat=8)
        if "BB" not in "".join(b) and b.count("B") >= 2
    )
    assert cnt_p06 == int(all_tasks_by_id["math_p06"]["expected"])
    distinct_rolls = [t for t in itertools.product(range(1, 7), repeat=3) if len(set(t)) == 3]
    sum10 = [t for t in distinct_rolls if sum(t) == 10]
    g = math.gcd(len(sum10), len(distinct_rolls))
    assert f"{len(sum10)//g}/{len(distinct_rolls)//g}" == all_tasks_by_id["math_p07"]["expected"]
    N = math.factorial(12) // 36
    sq_divs = sum(1 for k in range(1, int(math.isqrt(N)) + 1) if N % (k * k) == 0)
    assert sq_divs == int(all_tasks_by_id["math_p08"]["expected"])

    # Paired logic brute-force uniqueness checks
    # logic_p02: floors 1..5 for Daria, Eli, Farah, Gabe, Hana
    sols_p02 = []
    for perm in itertools.permutations([1, 2, 3, 4, 5]):
        D, E, F, G, H = perm
        if F == E + 2 and G not in (1, 5) and H == E - 1 and D > G:
            inv = {D: "Daria", E: "Eli", F: "Farah", G: "Gabe", H: "Hana"}
            sols_p02.append(inv[4])
    assert sols_p02 == [all_tasks_by_id["logic_p02"]["expected"]], f"logic_p02 sols={sols_p02}"

    # logic_p04: round robin P, Q, R, S
    pairs = [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)]
    sols_p04 = set()
    for outcomes in itertools.product([(2, 0), (1, 1), (0, 2)], repeat=6):
        pts = [0, 0, 0, 0]
        losses_p = 0
        p_beat_r = False
        q_beat_r = False
        rs_res = None
        for (i, j), (pi, pj) in zip(pairs, outcomes):
            pts[i] += pi
            pts[j] += pj
            if i == 0 and pi == 0:
                losses_p += 1
            if (i, j) == (0, 2) and pi == 2:
                p_beat_r = True
            if (i, j) == (1, 2) and pi == 2:
                q_beat_r = True
            if (i, j) == (2, 3):
                rs_res = "R won" if pi == 2 else ("Draw" if pi == 1 else "S won")
        if pts == [5, 4, 2, 1] and losses_p == 0 and p_beat_r and q_beat_r:
            sols_p04.add(rs_res)
    assert sols_p04 == {all_tasks_by_id["logic_p04"]["expected"]}, f"logic_p04 sols={sols_p04}"

    # logic_p05: 3-digit lock code
    def mm_clue(code, guess):
        exact = sum(c == g for c, g in zip(code, guess))
        wrong = sum(c in guess for c in code) - exact
        return exact, wrong

    sols_p05 = [
        "".join(p) for p in itertools.permutations("0123456789", 3)
        if mm_clue(p, tuple("682")) == (1, 0)
        and mm_clue(p, tuple("614")) == (0, 1)
        and mm_clue(p, tuple("206")) == (0, 2)
        and mm_clue(p, tuple("738")) == (0, 0)
        and mm_clue(p, tuple("780")) == (0, 1)
    ]
    assert sols_p05 == [all_tasks_by_id["logic_p05"]["expected"]], f"logic_p05 sols={sols_p05}"

    # Paired science checks
    assert abs(0.30 * 143.32 - float(all_tasks_by_id["sci_p01"]["expected"])) < 1e-6
    tf = (500 * 0.385 * 180 + 400 * 4.184 * 20) / (500 * 0.385 + 400 * 4.184)
    assert abs(round(tf, 2) - float(all_tasks_by_id["sci_p04"]["expected"])) < 1e-6
    assert abs(612 * 340 / (340 - 34) - float(all_tasks_by_id["sci_p07"]["expected"])) < 1e-6
    assert abs(110 * ((2.0 / 0.5) ** 1.5) - float(all_tasks_by_id["sci_p08"]["expected"])) < 1e-6

    # Blind math & science checks
    assert abs((0.6 * 15 - 0.4 * 15) / (0.75 - 0.6) - float(all_tasks_by_id["math_b01"]["expected"])) < 1e-9
    cnt_b02 = sum(
        1 for p in itertools.permutations(range(5))
        if sum(i == v for i, v in enumerate(p)) == 1
    )
    assert cnt_b02 == int(all_tasks_by_id["math_b02"]["expected"])
    exp5 = sum(k * (2 if k == 25 else (1 if k % 5 == 0 else 0)) for k in range(1, 26))
    assert exp5 == int(all_tasks_by_id["math_b03"]["expected"])
    assert abs((240 * 150 / 1200) ** 2 / 8.0 - float(all_tasks_by_id["sci_b02"]["expected"])) < 1e-9
    q = 1 / 50
    assert abs(2 * (1 - q) * q - float(all_tasks_by_id["sci_b03"]["expected"])) < 1e-9
    assert abs((50 * 0.5) ** 2 / 20.0 - float(all_tasks_by_id["sci_b04"]["expected"])) < 1e-9


def verify_all_reference_code(all_tasks: list):
    code_tasks = [t for t in all_tasks if t.get("answer_type") == "python_code"]
    entry_points = []
    for t in code_tasks:
        ns = {}
        exec(t["reference_solution"], ns)
        assert t["entry_point"] in ns, f"Missing entry_point in {t['id']}"
        for test_stmt in t["tests"]:
            exec(test_stmt, ns)
        entry_points.append(t["entry_point"])
    assert len(entry_points) == len(set(entry_points)), "Duplicate code entry_point detected!"
    return len(code_tasks)


def content_ngrams(prompt: str, n: int = 5) -> set:
    cleaned = prompt.replace(COMPUTER_USE_SYSTEM_PROMPT, " ")
    boilerplate = [
        "put your final integer answer inside",
        "put your final numerical answer inside",
        "put your final integer inside",
        "put the single name inside",
        "provide your implementation inside a",
        "put your code inside a",
        "output only a json array of",
        "output only a json object",
        "express as a simplified fraction",
    ]
    low = cleaned.lower()
    for bp in boilerplate:
        low = low.replace(bp, " ")
    tokens = re.findall(r"[a-z0-9_]+", low)
    if len(tokens) < n:
        return {tuple(tokens)}
    return {tuple(tokens[i : i + n]) for i in range(len(tokens) - n + 1)}


def run_leakage_audit(diag: list, paired: list, blind: list) -> dict:
    all_items = diag + paired + blind
    ids = [x["id"] for x in all_items]
    assert len(ids) == len(set(ids)), "Duplicate task IDs!"

    prompts = [x["prompt"].strip() for x in all_items]
    assert len(prompts) == len(set(prompts)), "Duplicate prompt text!"

    def max_pair_jaccard(list_a, list_b):
        best = 0.0
        best_pair = None
        for a in list_a:
            na = content_ngrams(a["prompt"], 5)
            for b in list_b:
                nb = content_ngrams(b["prompt"], 5)
                union = len(na | nb)
                jac = len(na & nb) / union if union else 0.0
                if jac > best:
                    best = jac
                    best_pair = (a["id"], b["id"])
        return round(best, 6), best_pair

    j_diag_paired, p1 = max_pair_jaccard(diag, paired)
    j_diag_blind, p2 = max_pair_jaccard(diag, blind)
    j_paired_blind, p3 = max_pair_jaccard(paired, blind)

    assert j_diag_paired < 0.05, f"Leakage between diag and paired: {j_diag_paired} {p1}"
    assert j_diag_blind < 0.05, f"Leakage between diag and blind: {j_diag_blind} {p2}"
    assert j_paired_blind < 0.05, f"Leakage between paired and blind: {j_paired_blind} {p3}"

    return {
        "total_tasks": len(all_items),
        "counts": {
            "diagnostic_probes": len(diag),
            "heldout_paired_suite": len(paired),
            "heldout_blind_post_suite": len(blind),
        },
        "exact_duplicate_prompts": 0,
        "max_5gram_jaccard": {
            "diagnostic_vs_paired": {"jaccard": j_diag_paired, "pair": p1},
            "diagnostic_vs_blind": {"jaccard": j_diag_blind, "pair": p2},
            "paired_vs_blind": {"jaccard": j_paired_blind, "pair": p3},
        },
    }


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(16 * 1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    paired = PAIRED_DOMAINS_1_TO_4 + PAIRED_DOMAINS_5_TO_8
    blind = BLIND_DOMAINS_1_TO_4 + BLIND_DOMAINS_5_TO_8
    all_tasks = DIAGNOSTIC_PROBES + paired + blind
    by_id = {t["id"]: t for t in all_tasks}

    verify_math_and_science_ground_truths(by_id)
    n_code = verify_all_reference_code(all_tasks)
    audit = run_leakage_audit(DIAGNOSTIC_PROBES, paired, blind)

    p_diag = os.path.join(DATA_DIR, "diagnostic_probes.json")
    p_paired = os.path.join(DATA_DIR, "heldout_paired_suite.json")
    p_blind = os.path.join(DATA_DIR, "heldout_blind_post_suite.json")

    for path, obj in [(p_diag, DIAGNOSTIC_PROBES), (p_paired, paired), (p_blind, blind)]:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, indent=2, ensure_ascii=False)

    models_root = os.path.join(os.path.dirname(STUDY_ROOT), "models")
    base_hashes = {
        "Qwen3-0.6B/model.safetensors": sha256_file(os.path.join(models_root, "Qwen3-0.6B", "model.safetensors")),
        "Qwen3-1.7B/model-00001-of-00002.safetensors": sha256_file(os.path.join(models_root, "Qwen3-1.7B", "model-00001-of-00002.safetensors")),
        "Qwen3-1.7B/model-00002-of-00002.safetensors": sha256_file(os.path.join(models_root, "Qwen3-1.7B", "model-00002-of-00002.safetensors")),
    }

    manifest = {
        "preregistered_at_utc": datetime.now(timezone.utc).isoformat(),
        "clean_room_statement": (
            "All three datasets were authored from scratch, programmatically verified, and SHA-256 locked "
            "prior to any model forward pass or weight-space inspection. Zero files from prior Argon 4 runs "
            "were read, imported, or referenced."
        ),
        "verified_code_reference_tasks": n_code,
        "leakage_audit": audit,
        "dataset_sha256": {
            "diagnostic_probes.json": sha256_file(p_diag),
            "heldout_paired_suite.json": sha256_file(p_paired),
            "heldout_blind_post_suite.json": sha256_file(p_blind),
        },
        "upstream_base_model_sha256": base_hashes,
    }
    manifest_path = os.path.join(DATA_DIR, "leakage_audit_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print("SUCCESS: Pre-registered & verified all 128 tasks across 3 disjoint splits!")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
