"""
Unified Clean-Room Evaluation & Telemetry Harness for Qwen3 Models.
Supports high-throughput left-padded batched GPU inference (batch_size=16)
alongside single-stream (batch_size=1) timing, isolated Python unit-test
subprocesses, and simultaneous hermetically isolated TemporaryDirectory sandboxes
for multi-turn Computer Usage tasks.
"""

import csv
import fractions
import io
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
from collections import Counter
from typing import Any

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, LogitsProcessor, LogitsProcessorList


class StepTimerProcessor(LogitsProcessor):
    def __init__(self):
        self.first_token_time = None

    def __call__(self, input_ids: torch.LongTensor, scores: torch.FloatTensor) -> torch.FloatTensor:
        if self.first_token_time is None:
            if torch.cuda.is_available():
                torch.cuda.synchronize()
            self.first_token_time = time.perf_counter()
        return scores


DOUBT_PATTERN = re.compile(
    r"\b(wait|alternatively|hmm|hold on|let me double[- ]check|let's double[- ]check|let me re-?check|no,\s*wait)\b",
    re.IGNORECASE,
)


def split_think_and_response(raw_text: str) -> dict:
    if "</think>" in raw_text:
        idx = raw_text.rfind("</think>")
        think_part = raw_text[:idx]
        if think_part.lstrip().startswith("<think>"):
            think_part = think_part.lstrip()[len("<think>") :]
        final_part = raw_text[idx + len("</think>") :].strip()
        closed_think = True
    elif raw_text.lstrip().startswith("<think>"):
        think_part = raw_text.lstrip()[len("<think>") :]
        final_part = ""
        closed_think = False
    else:
        think_part = ""
        final_part = raw_text.strip()
        closed_think = True
    return {
        "think_text": think_part.strip(),
        "final_text": final_part,
        "closed_think": closed_think,
    }


def detect_repetition_loop(text: str) -> dict:
    words = re.findall(r"\S+", text.lower())
    doubt_matches = len(DOUBT_PATTERN.findall(text))
    if len(words) < 40:
        return {
            "has_ngram_loop": False,
            "max_8gram_repeats": 1,
            "distinct_4gram_ratio": 1.0,
            "doubt_marker_count": doubt_matches,
        }
    grams8 = [tuple(words[i : i + 8]) for i in range(len(words) - 7)]
    c8 = Counter(grams8)
    max_rep8 = max(c8.values()) if c8 else 1
    grams4 = [tuple(words[i : i + 4]) for i in range(len(words) - 3)]
    d4_ratio = len(set(grams4)) / max(len(grams4), 1)
    has_loop = (max_rep8 >= 5) or (len(words) >= 150 and d4_ratio < 0.42)
    return {
        "has_ngram_loop": bool(has_loop),
        "max_8gram_repeats": int(max_rep8),
        "distinct_4gram_ratio": round(float(d4_ratio), 4),
        "doubt_marker_count": int(doubt_matches),
    }


def extract_boxed_values(text: str) -> list[str]:
    results = []
    needle = "\\boxed{"
    start = 0
    while True:
        idx = text.find(needle, start)
        if idx == -1:
            break
        i = idx + len(needle)
        depth = 1
        buf = []
        while i < len(text) and depth > 0:
            if text[i] == "{":
                depth += 1
                buf.append(text[i])
            elif text[i] == "}":
                depth -= 1
                if depth > 0:
                    buf.append(text[i])
            else:
                buf.append(text[i])
            i += 1
        if depth == 0:
            results.append("".join(buf).strip())
        start = i
    return results


def clean_math_str(s: str) -> str:
    s = s.strip()
    s = re.sub(r"\\text\{([^}]*)\}", r"\1", s)
    s = re.sub(r"\\mathrm\{([^}]*)\}", r"\1", s)
    s = s.replace("\\,", "").replace(",", "").replace("$", "").replace("\\%", "").strip()
    return s


def parse_number_val(s: str) -> float | None:
    s = clean_math_str(s)
    m_frac = re.match(r"^\\frac\{([+-]?\d+(?:\.\d+)?)\}\{([+-]?\d+(?:\.\d+)?)\}$", s)
    if m_frac:
        den = float(m_frac.group(2))
        return float(m_frac.group(1)) / den if den != 0 else None
    if "/" in s and re.match(r"^[+-]?\d+\s*/\s*[+-]?\d+$", s):
        a, b = s.split("/")
        return float(a) / float(b) if float(b) != 0 else None
    m_num = re.match(r"^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)", s)
    if m_num:
        return float(m_num.group(1))
    return None


def extract_json_from_text(text: str, allow_fenced: bool = True) -> Any:
    s = text.strip()
    if allow_fenced:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", s, re.IGNORECASE)
        if m:
            s = m.group(1).strip()
    try:
        return json.loads(s)
    except Exception:
        pass
    for open_ch, close_ch in [("{", "}"), ("[", "]")]:
        i1 = s.find(open_ch)
        i2 = s.rfind(close_ch)
        if i1 != -1 and i2 != -1 and i2 > i1:
            try:
                return json.loads(s[i1 : i2 + 1])
            except Exception:
                pass
    return None


def run_python_code_tests(final_text: str, entry_point: str, tests: list[str]) -> tuple[bool, float, str]:
    blocks = re.findall(r"```(?:python)?\s*([\s\S]*?)```", final_text, re.IGNORECASE)
    candidate_code = blocks[-1].strip() if blocks else final_text.strip()
    if not candidate_code or f"def {entry_point}" not in candidate_code:
        return False, 0.0, f"Missing `def {entry_point}` in final response."

    runner_lines = [
        candidate_code,
        "",
        "__passed = 0",
        f"__total = {len(tests)}",
    ]
    for idx, t_stmt in enumerate(tests):
        runner_lines.append("try:")
        runner_lines.append(f"    {t_stmt}")
        runner_lines.append("    __passed += 1")
        runner_lines.append("except Exception as e:")
        runner_lines.append(f"    print('FAIL_{idx}:', repr(e))")
    runner_lines.append("print(f'RESULT:{__passed}/{__total}')")
    script = "\n".join(runner_lines)

    with tempfile.TemporaryDirectory() as tmpd:
        sp_path = os.path.join(tmpd, "solution_check.py")
        with open(sp_path, "w", encoding="utf-8") as f:
            f.write(script)
        try:
            proc = subprocess.run(
                [sys.executable, "-I", sp_path],
                cwd=tmpd,
                capture_output=True,
                text=True,
                timeout=5.0,
            )
        except subprocess.TimeoutExpired:
            return False, 0.0, "Execution timed out (5.0s)."

    out = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
    m = re.search(r"RESULT:(\d+)/(\d+)", out)
    if not m:
        return False, 0.0, f"Runtime/Syntax error: {out.strip()[:240]}"
    passed_n, total_n = int(m.group(1)), int(m.group(2))
    frac = passed_n / max(total_n, 1)
    return passed_n == total_n, frac, f"Passed {passed_n}/{total_n} unit tests."


def grade_single_response(task: dict, final_text: str, think_text: str = "") -> dict:
    atype = task["answer_type"]

    if atype == "boxed_number":
        tol = float(task.get("tolerance", 1e-3))
        target = float(task["expected"])
        boxed = extract_boxed_values(final_text)
        passed = False
        pred_str = boxed[-1] if boxed else ""
        if boxed:
            val = parse_number_val(boxed[-1])
            if val is not None and abs(val - target) <= max(tol, abs(target) * 1e-4):
                passed = True
        else:
            nums = re.findall(r"[+-]?\d+(?:\.\d+)?", final_text.replace(",", ""))
            if nums:
                pred_str = nums[-1]
                val = float(nums[-1])
                if abs(val - target) <= max(tol, abs(target) * 1e-4):
                    passed = True
        exp_clean = str(task["expected"])
        latent_hit = exp_clean in think_text.replace(",", "")
        return {
            "passed": passed,
            "score": 1.0 if passed else 0.0,
            "extracted": pred_str,
            "latent_in_think": bool(latent_hit),
            "reason": f"Expected {task['expected']}, got {repr(pred_str)}",
        }

    if atype == "boxed_fraction":
        target_f = fractions.Fraction(task["expected"])
        boxed = extract_boxed_values(final_text)
        passed = False
        pred_str = boxed[-1] if boxed else ""
        for cand in (boxed[-1:] if boxed else re.findall(r"\d+\s*/\s*\d+", final_text)[-1:]):
            c = clean_math_str(cand)
            m = re.match(r"^\\frac\{(\d+)\}\{(\d+)\}$", c)
            if m:
                c = f"{m.group(1)}/{m.group(2)}"
            try:
                f_val = fractions.Fraction(c.replace(" ", ""))
                if f_val == target_f:
                    passed = True
                    pred_str = str(f_val)
            except Exception:
                pass
        latent_hit = task["expected"] in think_text.replace(" ", "")
        return {
            "passed": passed,
            "score": 1.0 if passed else 0.0,
            "extracted": pred_str,
            "latent_in_think": bool(latent_hit),
            "reason": f"Expected {task['expected']}, got {repr(pred_str)}",
        }

    if atype == "boxed_exact":
        exp = task["expected"].strip()
        boxed = extract_boxed_values(final_text)
        pred = clean_math_str(boxed[-1]).strip("'\"` ") if boxed else ""
        passed = pred.lower() == exp.lower()
        if not boxed and final_text:
            cleaned_ft = final_text.strip().strip(".'\"`*")
            if cleaned_ft.lower() == exp.lower():
                passed = True
                pred = cleaned_ft
        latent_hit = exp.lower() in think_text.lower()
        return {
            "passed": passed,
            "score": 1.0 if passed else 0.0,
            "extracted": pred,
            "latent_in_think": bool(latent_hit),
            "reason": f"Expected {repr(exp)}, got {repr(pred)}",
        }

    if atype == "python_code":
        ok, frac, msg = run_python_code_tests(final_text, task["entry_point"], task["tests"])
        latent_hit = f"def {task['entry_point']}" in think_text
        return {
            "passed": ok,
            "score": round(frac, 4),
            "extracted": task["entry_point"],
            "latent_in_think": bool(latent_hit),
            "reason": msg,
        }

    if atype == "if_constraints":
        c = task["constraints"]
        lines = [ln for ln in final_text.strip().splitlines() if ln.strip()]
        checks = []
        checks.append(("line_count", len(lines) == c["exact_lines"]))
        pref = c["line_prefix"]
        checks.append(("prefix", bool(lines) and all(ln.startswith(pref) for ln in lines)))
        lo, hi = c["words_per_line"]
        w_ok = bool(lines) and all(
            lo <= len(ln[len(pref) :].split()) <= hi for ln in lines if ln.startswith(pref)
        ) and len([ln for ln in lines if ln.startswith(pref)]) == len(lines)
        checks.append(("words_per_line", w_ok))
        if "forbidden_chars" in c:
            checks.append(("forbidden_chars", not any(ch in final_text for ch in c["forbidden_chars"])))
        if "line_suffix" in c:
            checks.append(("line_suffix", bool(lines) and all(ln.rstrip().endswith(c["line_suffix"]) for ln in lines)))
        ok = all(v for _, v in checks)
        score = sum(1 for _, v in checks if v) / len(checks)
        return {
            "passed": ok,
            "score": round(score, 4),
            "extracted": f"{len(lines)} lines",
            "latent_in_think": False,
            "reason": ", ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks),
        }

    if atype == "if_json_exact_keys":
        c = task["constraints"]
        checks = []
        if c.get("no_code_fence"):
            checks.append(("no_code_fence", "```" not in final_text))
        try:
            obj = json.loads(final_text.strip())
            is_dict = isinstance(obj, dict)
        except Exception:
            obj = None
            is_dict = False
        checks.append(("raw_json_parse", is_dict))
        if is_dict:
            checks.append(("exact_keys", set(obj.keys()) == set(c["exact_keys"])))
            for bk in c.get("bool_keys", []):
                checks.append((f"bool_{bk}", isinstance(obj.get(bk), bool)))
            for lk, llen in c.get("list_len", {}).items():
                val = obj.get(lk)
                checks.append((f"list_{lk}", isinstance(val, list) and len(val) == llen and all(isinstance(x, str) and x.strip() for x in val)))
        else:
            checks.append(("exact_keys", False))
        ok = all(v for _, v in checks)
        score = sum(1 for _, v in checks if v) / len(checks)
        return {
            "passed": ok,
            "score": round(score, 4),
            "extracted": str(list(obj.keys())) if is_dict else "invalid_json",
            "latent_in_think": False,
            "reason": ", ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks),
        }

    if atype == "if_lipogram":
        c = task["constraints"]
        words = final_text.strip().split()
        lo, hi = c["word_range"]
        checks = [
            ("non_empty", len(words) > 0),
            ("word_range", lo <= len(words) <= hi),
            ("forbidden_chars", not any(ch in final_text for ch in c["forbidden_chars"])),
        ]
        ok = all(v for _, v in checks)
        return {
            "passed": ok,
            "score": round(sum(1 for _, v in checks if v) / len(checks), 4),
            "extracted": f"{len(words)} words",
            "latent_in_think": False,
            "reason": ", ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks),
        }

    if atype == "if_acrostic":
        c = task["constraints"]
        target_word = c["acrostic"]
        lines = [ln.strip() for ln in final_text.strip().splitlines() if ln.strip()]
        checks = [("line_count", len(lines) == len(target_word))]
        initials = "".join(re.sub(r"^[^A-Za-z]+", "", ln)[:1].upper() for ln in lines)
        checks.append(("initials", initials == target_word))
        if "forbidden_chars" in c:
            checks.append(("forbidden_chars", not any(ch in final_text for ch in c["forbidden_chars"])))
        if "last_char" in c:
            checks.append(("last_char", bool(lines) and lines[-1].endswith(c["last_char"])))
        ok = all(v for _, v in checks)
        return {
            "passed": ok,
            "score": round(sum(1 for _, v in checks if v) / len(checks), 4),
            "extracted": f"initials={initials}",
            "latent_in_think": False,
            "reason": ", ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks),
        }

    if atype == "if_dual_para":
        c = task["constraints"]
        parts = [p.strip() for p in final_text.strip().split(c["separator"]) if p.strip()]
        lo, hi = c["para_word_range"]
        checks = [("two_paras", len(parts) == 2 and c["separator"] in final_text)]
        if len(parts) == 2:
            checks.append(("p1_words", lo <= len(parts[0].split()) <= hi))
            checks.append(("p2_words", lo <= len(parts[1].split()) <= hi))
        else:
            checks.append(("p1_words", False))
            checks.append(("p2_words", False))
        toks_low = set(re.findall(r"[a-z]+", final_text.lower()))
        checks.append(("forbidden_words", toks_low.isdisjoint(set(c["forbidden_words"]))))
        ok = all(v for _, v in checks)
        return {
            "passed": ok,
            "score": round(sum(1 for _, v in checks if v) / len(checks), 4),
            "extracted": f"paras={len(parts)}",
            "latent_in_think": False,
            "reason": ", ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks),
        }

    if atype == "if_sorted_list":
        c = task["constraints"]
        lines = [ln.strip() for ln in final_text.strip().splitlines() if ln.strip()]
        checks = [("count", len(lines) == c["count"])]
        items = []
        fmt_ok = len(lines) == c["count"]
        for idx, ln in enumerate(lines, 1):
            pref = f"{idx}."
            if not ln.startswith(pref):
                fmt_ok = False
            else:
                city = ln[len(pref) :].strip()
                items.append(city)
                if c.get("uppercase_only") and city != city.upper():
                    fmt_ok = False
        checks.append(("numbered_uppercase", fmt_ok))
        checks.append(("valid_capitals", len(items) == c["count"] and len(set(items)) == c["count"] and all(x in c["allowed_set"] for x in items)))
        checks.append(("sorted_alpha", len(items) == c["count"] and items == sorted(items)))
        ok = all(v for _, v in checks)
        return {
            "passed": ok,
            "score": round(sum(1 for _, v in checks if v) / len(checks), 4),
            "extracted": str(items),
            "latent_in_think": False,
            "reason": ", ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks),
        }

    if atype == "if_xml_phrases":
        c = task["constraints"]
        tag = c["tag"]
        s = final_text.strip()
        m = re.match(rf"^<{tag}>([\s\S]*)</{tag}>$", s)
        checks = [("strict_xml_wrap", m is not None)]
        inner = m.group(1).strip() if m else s
        wc = len(inner.split())
        lo, hi = c["word_range"]
        checks.append(("word_range", lo <= wc <= hi))
        low_in = inner.lower()
        checks.append(("required_phrases", all(p.lower() in low_in for p in c["required_phrases"])))
        ok = all(v for _, v in checks)
        return {
            "passed": ok,
            "score": round(sum(1 for _, v in checks if v) / len(checks), 4),
            "extracted": f"words={wc}",
            "latent_in_think": False,
            "reason": ", ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks),
        }

    if atype == "if_questions":
        c = task["constraints"]
        s = final_text.strip()
        q_count = s.count("?")
        parts = [p.strip() for p in s.split("?") if p.strip()]
        checks = [
            ("ends_with_q", s.endswith("?")),
            ("exact_q_count", q_count == c["question_count"] and len(parts) == c["question_count"]),
            ("no_period_or_bang", "." not in s and "!" not in s),
            ("forbidden_words", set(re.findall(r"[a-z]+", s.lower())).isdisjoint(set(c["forbidden_words"]))),
        ]
        ok = all(v for _, v in checks)
        return {
            "passed": ok,
            "score": round(sum(1 for _, v in checks if v) / len(checks), 4),
            "extracted": f"questions={q_count}",
            "latent_in_think": False,
            "reason": ", ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks),
        }

    if atype == "if_csv_exact":
        c = task["constraints"]
        s = final_text.strip()
        checks = [("no_backticks", "`" not in s)]
        try:
            rows = [[cell.strip() for cell in row] for row in csv.reader(io.StringIO(s)) if any(cell.strip() for cell in row)]
        except Exception:
            rows = []
        checks.append(("header_match", len(rows) >= 1 and [x.lower() for x in rows[0]] == [x.lower() for x in c["header"]]))
        checks.append(("rows_match", len(rows) == 1 + len(c["rows"]) and rows[1:] == c["rows"]))
        ok = all(v for _, v in checks)
        return {
            "passed": ok,
            "score": round(sum(1 for _, v in checks if v) / len(checks), 4),
            "extracted": f"csv_rows={len(rows)}",
            "latent_in_think": False,
            "reason": ", ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks),
        }

    if atype == "if_planet_brackets":
        c = task["constraints"]
        lines = [ln.strip() for ln in final_text.strip().splitlines() if ln.strip()]
        prefs = c["prefixes"]
        checks = [
            ("line_count", len(lines) == len(prefs)),
            ("prefixes", len(lines) == len(prefs) and all(ln.startswith(p) for ln, p in zip(lines, prefs))),
            ("suffixes", bool(lines) and all(ln.endswith(c["suffix"]) for ln in lines)),
            ("no_digits", not any(ch.isdigit() for ch in final_text)),
        ]
        ok = all(v for _, v in checks)
        return {
            "passed": ok,
            "score": round(sum(1 for _, v in checks if v) / len(checks), 4),
            "extracted": f"{len(lines)} lines",
            "latent_in_think": False,
            "reason": ", ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks),
        }

    if atype == "cu_gui_json":
        arr = extract_json_from_text(final_text, allow_fenced=True)
        exp_steps = task["expected"]["steps"]
        if not isinstance(arr, list) or len(arr) != len(exp_steps):
            return {
                "passed": False,
                "score": 0.0,
                "extracted": f"steps={len(arr) if isinstance(arr, list) else 'non-list'}",
                "latent_in_think": False,
                "reason": f"Expected {len(exp_steps)} JSON steps, got {type(arr).__name__}.",
            }
        step_ok = 0
        for got, want in zip(arr, exp_steps):
            if not isinstance(got, dict) or got.get("action") != want["action"]:
                continue
            if want["action"] == "click":
                x, y = got.get("x"), got.get("y")
                x1, y1, x2, y2 = want["bbox"]
                if isinstance(x, (int, float)) and isinstance(y, (int, float)) and (x1 <= x <= x2) and (y1 <= y <= y2):
                    step_ok += 1
            elif want["action"] == "type":
                if str(got.get("text", "")).strip() == want["text"]:
                    step_ok += 1
        ok = step_ok == len(exp_steps)
        return {
            "passed": ok,
            "score": round(step_ok / len(exp_steps), 4),
            "extracted": f"{step_ok}/{len(exp_steps)} steps valid",
            "latent_in_think": False,
            "reason": f"Matched {step_ok}/{len(exp_steps)} GUI actions.",
        }

    if atype == "cu_safe_cmd":
        obj = extract_json_from_text(final_text, allow_fenced=True)
        exp = task["expected"]
        if not isinstance(obj, dict) or not isinstance(obj.get("command"), str):
            return {"passed": False, "score": 0.0, "extracted": "invalid_json", "latent_in_think": False, "reason": "Missing command JSON."}
        cmd = obj["command"]
        checks = [
            ("target", any(t in cmd for t in exp["must_contain_any"])),
            ("safe_forbidden", not any(bad.lower() in cmd.lower() for bad in exp["forbidden"])),
        ]
        if "must_contain_ext" in exp:
            checks.append(("ext", all(e in cmd for e in exp["must_contain_ext"])))
        ok = all(v for _, v in checks)
        return {
            "passed": ok,
            "score": round(sum(1 for _, v in checks if v) / len(checks), 4),
            "extracted": cmd[:100],
            "latent_in_think": False,
            "reason": ", ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks),
        }

    if atype == "json_kv":
        obj = extract_json_from_text(final_text, allow_fenced=True)
        exp = task["expected"]
        req_keys = [k for k in exp.keys() if not k.startswith("alt_")]
        if not isinstance(obj, dict):
            return {"passed": False, "score": 0.0, "extracted": "invalid_json", "latent_in_think": False, "reason": "Could not parse JSON object."}
        matched = 0
        details = []
        for k in req_keys:
            if k not in obj:
                details.append(f"{k}=MISSING")
                continue
            gv = obj[k]
            wv = exp[k]
            alt_list = exp.get(f"alt_{k}")
            ok_k = False
            if isinstance(wv, bool):
                ok_k = isinstance(gv, bool) and gv == wv
            elif isinstance(wv, (int, float)):
                ok_k = isinstance(gv, (int, float)) and not isinstance(gv, bool) and abs(float(gv) - float(wv)) <= 1e-2
            elif isinstance(wv, str):
                allowed = [x.lower() for x in (alt_list if alt_list else [wv])]
                ok_k = isinstance(gv, str) and gv.strip().lower() in allowed
            elif isinstance(wv, list):
                ok_k = gv == wv
            if ok_k:
                matched += 1
            details.append(f"{k}={'OK' if ok_k else f'FAIL({gv!r}!={wv!r})'}")
        extra_keys = set(obj.keys()) - set(req_keys)
        ok = (matched == len(req_keys)) and len(extra_keys) == 0
        score = matched / max(len(req_keys), 1) * (0.85 if extra_keys else 1.0)
        return {
            "passed": ok,
            "score": round(score, 4),
            "extracted": json.dumps(obj)[:120],
            "latent_in_think": False,
            "reason": ", ".join(details) + (f", extra={list(extra_keys)}" if extra_keys else ""),
        }

    if atype == "synthesis_rubric":
        c = task["constraints"]
        words = final_text.strip().split()
        wc = len(words)
        lo, hi = c["word_range"]
        toks = re.findall(r"[a-z0-9']+", final_text.lower())
        bigrams = [tuple(toks[i : i + 2]) for i in range(len(toks) - 1)]
        dist2 = len(set(bigrams)) / max(len(bigrams), 1) if bigrams else 0.0
        min_d2 = c.get("min_distinct2", 0.65)
        rep_info = detect_repetition_loop(final_text)
        checks = [
            ("non_empty", wc >= 20),
            ("no_leaked_think_tag", "<think>" not in final_text and "</think>" not in final_text),
            ("word_range", lo <= wc <= hi),
            ("required_concepts", all(m.lower() in final_text.lower() for m in c["must_mention"])),
            ("lexical_diversity", dist2 >= min_d2 and not rep_info["has_ngram_loop"]),
        ]
        ok = all(v for _, v in checks)
        return {
            "passed": ok,
            "score": round(sum(1 for _, v in checks if v) / len(checks), 4),
            "extracted": f"words={wc}, distinct2={dist2:.3f}",
            "latent_in_think": False,
            "reason": ", ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks),
        }

    raise ValueError(f"Unknown answer_type: {atype}")


def trim_generated_ids(gen_row: torch.Tensor, eos_ids: set[int]) -> torch.Tensor:
    """Trims trailing pad/EOS tokens after the first EOS occurrence."""
    lst = gen_row.tolist()
    for i, tid in enumerate(lst):
        if tid in eos_ids:
            return gen_row[: i + 1]
    return gen_row


def generate_batch(
    model,
    tokenizer,
    messages_list: list[list[dict]],
    max_new_tokens: int = 2048,
    do_sample: bool = False,
    temperature: float = 0.6,
    top_p: float = 0.95,
    top_k: int = 20,
    seed: int = 42,
) -> list[dict]:
    prompt_texts = [
        tokenizer.apply_chat_template(m, tokenize=False, add_generation_prompt=True, enable_thinking=True)
        for m in messages_list
    ]
    unpadded_lens = [len(tokenizer.encode(pt, add_special_tokens=False)) for pt in prompt_texts]
    inputs = tokenizer(prompt_texts, return_tensors="pt", padding=True).to(model.device)
    padded_input_len = int(inputs["input_ids"].shape[1])

    eos_set = {151645, 151643}
    if isinstance(tokenizer.eos_token_id, int):
        eos_set.add(tokenizer.eos_token_id)

    timer_proc = StepTimerProcessor()
    gen_kwargs = {
        "max_new_tokens": max_new_tokens,
        "logits_processor": LogitsProcessorList([timer_proc]),
        "pad_token_id": tokenizer.pad_token_id or 151643,
        "eos_token_id": list(eos_set),
    }
    if do_sample:
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
        gen_kwargs.update({"do_sample": True, "temperature": temperature, "top_p": top_p, "top_k": top_k})
    else:
        gen_kwargs.update({"do_sample": False})

    if torch.cuda.is_available():
        torch.cuda.synchronize()
    t0 = time.perf_counter()
    with torch.inference_mode():
        out_ids = model.generate(**inputs, **gen_kwargs)
    if torch.cuda.is_available():
        torch.cuda.synchronize()
    t1 = time.perf_counter()

    t_first = timer_proc.first_token_time or t0
    batch_prefill_sec = max(t_first - t0, 1e-6)
    batch_decode_sec = max(t1 - t_first, 1e-6)
    batch_total_sec = max(t1 - t0, 1e-6)

    trimmed_rows = [trim_generated_ids(out_ids[b, padded_input_len:], eos_set) for b in range(len(messages_list))]
    total_batch_gen_toks = max(sum(int(r.shape[0]) for r in trimmed_rows), 1)
    batch_tok_per_s = total_batch_gen_toks / batch_decode_sec

    outputs = []
    for b, gen_ids in enumerate(trimmed_rows):
        gen_len = int(gen_ids.shape[0])
        raw_output = tokenizer.decode(gen_ids, skip_special_tokens=True)
        hit_token_limit = (gen_len >= max_new_tokens) and (int(gen_ids[-1].item()) not in eos_set)

        parsed = split_think_and_response(raw_output)
        think_toks = len(tokenizer.encode(parsed["think_text"], add_special_tokens=False)) if parsed["think_text"] else 0
        ans_toks = len(tokenizer.encode(parsed["final_text"], add_special_tokens=False)) if parsed["final_text"] else 0
        loop_stats = detect_repetition_loop(raw_output)

        # Proportional active-token share of batch wall-clock time
        item_share = gen_len / total_batch_gen_toks
        item_dec_sec = batch_decode_sec * item_share
        item_pref_sec = batch_prefill_sec / len(messages_list)
        item_tot_sec = item_pref_sec + item_dec_sec

        outputs.append({
            "raw_output": raw_output,
            "think_text": parsed["think_text"],
            "final_text": parsed["final_text"],
            "closed_think": parsed["closed_think"],
            "hit_token_limit": hit_token_limit,
            "prompt_tokens": unpadded_lens[b],
            "generated_tokens": gen_len,
            "think_tokens": think_toks,
            "answer_tokens": ans_toks,
            "prefill_sec": round(item_pref_sec, 5),
            "decode_sec": round(item_dec_sec, 5),
            "total_sec": round(item_tot_sec, 5),
            "prefill_tok_per_s": round(unpadded_lens[b] / max(item_pref_sec, 1e-6), 2),
            "decode_tok_per_s": round(batch_tok_per_s, 2),
            "e2e_tok_per_s": round(gen_len / max(item_tot_sec, 1e-6), 2),
            **loop_stats,
        })
    return outputs


def safe_sandbox_path(root: str, rel_path: str) -> str | None:
    norm_root = os.path.abspath(root)
    cand = os.path.abspath(os.path.join(norm_root, rel_path.lstrip("/\\")))
    if cand == norm_root or cand.startswith(norm_root + os.sep):
        return cand
    return None


def parse_tool_call(text: str) -> dict | None:
    m = re.search(r"<tool_call>\s*([\s\S]*?)\s*</tool_call>", text)
    if m:
        obj = extract_json_from_text(m.group(1), allow_fenced=True)
        if isinstance(obj, dict) and "tool" in obj:
            return obj
    obj = extract_json_from_text(text, allow_fenced=True)
    if isinstance(obj, dict) and "tool" in obj:
        return obj
    return None


def run_live_computer_usage_batch(
    model,
    tokenizer,
    cu_tasks: list[dict],
    do_sample: bool = False,
    seed: int = 42,
) -> list[dict]:
    """Executes multiple live computer-usage tasks simultaneously, each inside its own
    completely separate TemporaryDirectory sandbox!"""
    if not cu_tasks:
        return []
    max_turns = max(t.get("max_turns", 6) for t in cu_tasks)
    temp_objs = [tempfile.TemporaryDirectory() for _ in cu_tasks]
    sandbox_dirs = [tobj.name for tobj in temp_objs]

    try:
        states = []
        for idx, (task, sdir) in enumerate(zip(cu_tasks, sandbox_dirs)):
            for rel_p, content in task["sandbox_files"].items():
                full_p = safe_sandbox_path(sdir, rel_p)
                os.makedirs(os.path.dirname(full_p), exist_ok=True)
                with open(full_p, "w", encoding="utf-8") as f:
                    f.write(content)
            states.append({
                "task": task,
                "sdir": sdir,
                "messages": [{"role": "user", "content": task["prompt"]}],
                "finished": False,
                "turn_logs": [],
                "tot_prompt_toks": 0,
                "tot_gen_toks": 0,
                "tot_think_toks": 0,
                "tot_ans_toks": 0,
                "tot_prefill_sec": 0.0,
                "tot_decode_sec": 0.0,
                "tot_sec": 0.0,
                "any_token_limit": False,
                "any_loop": False,
                "tot_doubt": 0,
                "closed_all_thinks": True,
            })

        for turn_idx in range(max_turns):
            active = [st for st in states if not st["finished"] and turn_idx < st["task"].get("max_turns", 6)]
            if not active:
                break
            gens = generate_batch(
                model,
                tokenizer,
                [st["messages"] for st in active],
                max_new_tokens=1280,
                do_sample=do_sample,
                seed=seed + turn_idx * 37,
            )
            for st, gen in zip(active, gens):
                st["tot_prompt_toks"] += gen["prompt_tokens"]
                st["tot_gen_toks"] += gen["generated_tokens"]
                st["tot_think_toks"] += gen["think_tokens"]
                st["tot_ans_toks"] += gen["answer_tokens"]
                st["tot_prefill_sec"] += gen["prefill_sec"]
                st["tot_decode_sec"] += gen["decode_sec"]
                st["tot_sec"] += gen["total_sec"]
                st["any_token_limit"] = st["any_token_limit"] or gen["hit_token_limit"]
                st["any_loop"] = st["any_loop"] or gen["has_ngram_loop"]
                st["tot_doubt"] += gen["doubt_marker_count"]
                st["closed_all_thinks"] = st["closed_all_thinks"] and gen["closed_think"]

                sdir = st["sdir"]
                tcall = parse_tool_call(gen["final_text"])
                if tcall is None:
                    obs = "ERROR: Invalid or missing <tool_call>{...}</tool_call> JSON in response."
                else:
                    tname = tcall.get("tool")
                    if tname == "finish":
                        obs = f"FINISHED: {tcall.get('summary', '')}"
                        st["finished"] = True
                    elif tname == "list_dir":
                        sp = safe_sandbox_path(sdir, str(tcall.get("path", ".")))
                        if not sp or not os.path.isdir(sp):
                            obs = "ERROR: Directory not found or outside sandbox."
                        else:
                            obs = json.dumps({"entries": sorted(os.listdir(sp))})
                    elif tname == "read_file":
                        sp = safe_sandbox_path(sdir, str(tcall.get("path", "")))
                        if not sp or not os.path.isfile(sp):
                            obs = "ERROR: File not found or outside sandbox."
                        else:
                            with open(sp, "r", encoding="utf-8") as f:
                                obs = f.read()
                    elif tname == "write_file":
                        sp = safe_sandbox_path(sdir, str(tcall.get("path", "")))
                        if not sp:
                            obs = "ERROR: Path outside sandbox."
                        else:
                            os.makedirs(os.path.dirname(sp), exist_ok=True)
                            content_val = tcall.get("content", "")
                            if not isinstance(content_val, str):
                                content_val = json.dumps(content_val, indent=2)
                            with open(sp, "w", encoding="utf-8") as f:
                                f.write(content_val)
                            obs = f"OK: Wrote {len(content_val)} chars to {tcall.get('path')}."
                    elif tname == "delete_file":
                        sp = safe_sandbox_path(sdir, str(tcall.get("path", "")))
                        if not sp or not os.path.isfile(sp):
                            obs = "ERROR: File not found or outside sandbox."
                        else:
                            os.remove(sp)
                            obs = f"OK: Deleted {tcall.get('path')}."
                    else:
                        obs = f"ERROR: Unknown tool {tname!r}."

                st["turn_logs"].append({
                    "turn": turn_idx + 1,
                    "think_text": gen["think_text"],
                    "final_text": gen["final_text"],
                    "tool_call": tcall,
                    "observation": obs,
                    "tokens": gen["generated_tokens"],
                    "sec": gen["total_sec"],
                })
                st["messages"].append({
                    "role": "assistant",
                    "content": gen["final_text"] if gen["final_text"] else "(truncated in think)",
                })
                st["messages"].append({"role": "user", "content": f"Tool Observation:\n{obs}"})

        out_records = []
        for st in states:
            task = st["task"]
            sdir = st["sdir"]
            final_files = {}
            for root, _, files in os.walk(sdir):
                for fn in files:
                    fp = os.path.join(root, fn)
                    rel = os.path.relpath(fp, sdir).replace("\\", "/")
                    with open(fp, "r", encoding="utf-8", errors="replace") as f:
                        final_files[rel] = f.read()

            chk = task["expected_sandbox_check"]
            checks = []
            if "deleted_files" in chk:
                checks.append(("deleted_bak", all(df not in final_files for df in chk["deleted_files"])))
            if "existing_files" in chk:
                checks.append(("kept_intact", all(ef in final_files for ef in chk["existing_files"])))
            if "unchanged_json" in chk:
                for uf, uobj in chk["unchanged_json"].items():
                    try:
                        got_u = json.loads(final_files.get(uf, ""))
                        checks.append((f"unchanged_{uf}", got_u == uobj))
                    except Exception:
                        checks.append((f"unchanged_{uf}", False))
            if "json_file" in chk:
                jf = chk["json_file"]
                if jf not in final_files:
                    checks.append(("target_json_exists", False))
                else:
                    try:
                        got_j = json.loads(final_files[jf])
                        checks.append(("target_json_exact", got_j == chk["expected_obj"]))
                    except Exception:
                        checks.append(("target_json_exact", False))

            passed = all(v for _, v in checks)
            score = sum(1 for _, v in checks if v) / max(len(checks), 1)
            formatted_think = "\n\n".join(
                f"[Turn {t['turn']} Think]\n{t['think_text']}" for t in st["turn_logs"] if t["think_text"]
            )
            formatted_final = "\n".join(
                f"[Turn {t['turn']}] Action: {t['final_text']}  -->  Obs: {t['observation'][:160]}"
                for t in st["turn_logs"]
            )
            out_records.append({
                "task_id": task["id"],
                "domain": task.get("domain", task.get("category")),
                "title": task.get("title", task["id"]),
                "difficulty": task.get("difficulty", "medium"),
                "passed": passed,
                "score": round(score, 4),
                "reason": ", ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks),
                "extracted": json.dumps(final_files.get(chk.get("json_file", ""), ""))[:120],
                "latent_in_think": False,
                "think_text": formatted_think,
                "final_text": formatted_final,
                "sandbox_final_files": final_files,
                "turn_logs": st["turn_logs"],
                "closed_think": st["closed_all_thinks"],
                "hit_token_limit": st["any_token_limit"],
                "has_ngram_loop": st["any_loop"],
                "doubt_marker_count": st["tot_doubt"],
                "prompt_tokens": st["tot_prompt_toks"],
                "generated_tokens": st["tot_gen_toks"],
                "think_tokens": st["tot_think_toks"],
                "answer_tokens": st["tot_ans_toks"],
                "prefill_sec": round(st["tot_prefill_sec"], 5),
                "decode_sec": round(st["tot_decode_sec"], 5),
                "total_sec": round(st["tot_sec"], 5),
                "prefill_tok_per_s": round(st["tot_prompt_toks"] / max(st["tot_prefill_sec"], 1e-6), 2),
                "decode_tok_per_s": round(st["tot_gen_toks"] / max(st["tot_decode_sec"], 1e-6), 2),
                "e2e_tok_per_s": round(st["tot_gen_toks"] / max(st["tot_sec"], 1e-6), 2),
            })
        return out_records
    finally:
        for tobj in temp_objs:
            tobj.cleanup()


def evaluate_suite(
    model_path: str,
    tasks: list[dict],
    do_sample: bool = False,
    max_new_tokens: int = 2048,
    batch_size: int = 16,
    seed: int = 42,
    label: str = "",
) -> dict:
    tokenizer = AutoTokenizer.from_pretrained(model_path, padding_side="left")
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token_id = tokenizer.eos_token_id
    model = AutoModelForCausalLM.from_pretrained(
        model_path, dtype=torch.bfloat16, attn_implementation="sdpa"
    ).to("cuda")
    model.eval()

    # Warmup
    _ = generate_batch(model, tokenizer, [[{"role": "user", "content": "Reply OK."}]], max_new_tokens=8)

    single_turn_tasks = [t for t in tasks if t["answer_type"] != "cu_live_sandbox"]
    cu_sandbox_tasks = [t for t in tasks if t["answer_type"] == "cu_live_sandbox"]

    by_id = {}
    t_suite_start = time.perf_counter()

    # 1. Run single-turn tasks in batches of `batch_size`
    for b_start in range(0, len(single_turn_tasks), batch_size):
        chunk = single_turn_tasks[b_start : b_start + batch_size]
        msgs_batch = [[{"role": "user", "content": t["prompt"]}] for t in chunk]
        gens = generate_batch(
            model,
            tokenizer,
            msgs_batch,
            max_new_tokens=max_new_tokens,
            do_sample=do_sample,
            seed=seed + b_start,
        )
        for task, gen in zip(chunk, gens):
            grade = grade_single_response(task, gen["final_text"], gen["think_text"])
            rec = {
                "task_id": task["id"],
                "domain": task.get("domain", task.get("category")),
                "title": task.get("title", task["id"]),
                "difficulty": task.get("difficulty", "medium"),
                "passed": grade["passed"],
                "score": grade["score"],
                "reason": grade["reason"],
                "extracted": grade["extracted"],
                "latent_in_think": grade["latent_in_think"],
                "think_text": gen["think_text"],
                "final_text": gen["final_text"],
                "closed_think": gen["closed_think"],
                "hit_token_limit": gen["hit_token_limit"],
                "has_ngram_loop": gen["has_ngram_loop"],
                "max_8gram_repeats": gen.get("max_8gram_repeats", 1),
                "distinct_4gram_ratio": gen.get("distinct_4gram_ratio", 1.0),
                "doubt_marker_count": gen["doubt_marker_count"],
                "prompt_tokens": gen["prompt_tokens"],
                "generated_tokens": gen["generated_tokens"],
                "think_tokens": gen["think_tokens"],
                "answer_tokens": gen["answer_tokens"],
                "prefill_sec": gen["prefill_sec"],
                "decode_sec": gen["decode_sec"],
                "total_sec": gen["total_sec"],
                "prefill_tok_per_s": gen["prefill_tok_per_s"],
                "decode_tok_per_s": gen["decode_tok_per_s"],
                "e2e_tok_per_s": gen["e2e_tok_per_s"],
            }
            by_id[task["id"]] = rec
            status_ch = "PASS" if rec["passed"] else ("TRUNC" if rec["hit_token_limit"] else "FAIL")
            print(
                f"[{label}] {rec['task_id']:12s} | {status_ch:5s} | "
                f"score={rec['score']:.2f} | toks={rec['generated_tokens']:4d} (think={rec['think_tokens']:4d}) | "
                f"batch_tps={rec['decode_tok_per_s']:6.1f}",
                flush=True,
            )

    # 2. Run live sandbox computer-usage tasks simultaneously in isolated sandboxes
    if cu_sandbox_tasks:
        cu_recs = run_live_computer_usage_batch(model, tokenizer, cu_sandbox_tasks, do_sample=do_sample, seed=seed + 999)
        for rec in cu_recs:
            by_id[rec["task_id"]] = rec
            status_ch = "PASS" if rec["passed"] else ("TRUNC" if rec["hit_token_limit"] else "FAIL")
            print(
                f"[{label}] {rec['task_id']:12s} | {status_ch:5s} | "
                f"score={rec['score']:.2f} | toks={rec['generated_tokens']:4d} (think={rec['think_tokens']:4d}) | "
                f"turns={len(rec.get('turn_logs', []))}",
                flush=True,
            )

    wall_sec = time.perf_counter() - t_suite_start
    del model
    torch.cuda.empty_cache()

    # Preserve original task order
    results = [by_id[t["id"]] for t in tasks]
    n = len(results)
    tot_gen = sum(r["generated_tokens"] for r in results)

    summary = {
        "label": label,
        "model_path": model_path,
        "do_sample": do_sample,
        "batch_size": batch_size,
        "num_tasks": n,
        "pass_count": sum(1 for r in results if r["passed"]),
        "pass_rate": round(sum(1 for r in results if r["passed"]) / max(n, 1), 4),
        "mean_partial_score": round(sum(r["score"] for r in results) / max(n, 1), 4),
        "truncation_rate": round(sum(1 for r in results if r["hit_token_limit"]) / max(n, 1), 4),
        "loop_or_trunc_rate": round(sum(1 for r in results if r["has_ngram_loop"] or r["hit_token_limit"]) / max(n, 1), 4),
        "unclosed_think_rate": round(sum(1 for r in results if not r["closed_think"]) / max(n, 1), 4),
        "latent_trapped_count": sum(1 for r in results if (not r["passed"]) and r["latent_in_think"]),
        "mean_generated_tokens": round(tot_gen / max(n, 1), 2),
        "mean_think_tokens": round(sum(r["think_tokens"] for r in results) / max(n, 1), 2),
        "mean_answer_tokens": round(sum(r["answer_tokens"] for r in results) / max(n, 1), 2),
        "mean_doubt_markers": round(sum(r["doubt_marker_count"] for r in results) / max(n, 1), 2),
        "suite_effective_tok_per_s": round(tot_gen / max(wall_sec, 1e-6), 2),
        "mean_item_decode_tok_per_s": round(sum(r["decode_tok_per_s"] for r in results) / max(n, 1), 2),
        "mean_wall_sec_per_task": round(wall_sec / max(n, 1), 3),
        "total_suite_wall_sec": round(wall_sec, 2),
        "effective_correct_tasks_per_min": round(sum(1 for r in results if r["passed"]) / max(wall_sec / 60.0, 1e-6), 2),
    }
    return {"summary": summary, "results": results}
