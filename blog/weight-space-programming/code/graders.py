"""Automated deterministic graders for all 6 domains in the Multi-Domain Evaluation Suite."""
import json
import math
import re
from typing import Any, Tuple


def split_thinking_and_answer(raw_text: str) -> Tuple[str, str, bool]:
    """Splits Qwen3 output into (thinking_trace, final_answer, closed_think_tag)."""
    if "</think>" in raw_text:
        parts = raw_text.split("</think>", 1)
        think_part = parts[0].replace("<think>", "").strip()
        ans_part = parts[1].strip()
        return think_part, ans_part, True
    else:
        # Model never closed </think> (hit token limit inside thinking loop!)
        think_part = raw_text.replace("<think>", "").strip()
        return think_part, "", False


def compute_ngram_repetition_rate(text: str, n: int = 8) -> float:
    """Fraction of n-grams in text that are duplicates (measures looping severity)."""
    words = re.findall(r"\S+", text.lower())
    if len(words) < n:
        return 0.0
    ngrams = [tuple(words[i:i + n]) for i in range(len(words) - n + 1)]
    unique_count = len(set(ngrams))
    return 1.0 - (unique_count / len(ngrams))


def extract_last_boxed(text: str) -> str:
    """Extracts the content of the last \\boxed{...} with balanced brace matching."""
    idx = text.rfind("\\boxed{")
    if idx == -1:
        return ""
    i = idx + len("\\boxed{")
    depth = 1
    out = []
    while i < len(text) and depth > 0:
        if text[i] == "{":
            depth += 1
            out.append(text[i])
        elif text[i] == "}":
            depth -= 1
            if depth > 0:
                out.append(text[i])
        else:
            out.append(text[i])
        i += 1
    return "".join(out).strip()


def extract_python_code(text: str) -> str:
    """Extracts Python code from markdown code blocks or raw function definition."""
    m = re.findall(r"```(?:python)?\s*(.*?)```", text, flags=re.S | re.I)
    if m:
        return m[-1].strip()
    # Fallback: find 'def ' to end
    idx = text.find("def ")
    if idx != -1:
        return text[idx:].strip()
    return text.strip()


def extract_json_payload(text: str) -> str:
    """Extracts JSON string, stripping optional markdown fences if present."""
    s = text.strip()
    m = re.findall(r"```(?:json)?\s*(.*?)```", s, flags=re.S | re.I)
    if m:
        return m[-1].strip()
    return s


def grade_instruction_check(check_id: str, ans: str) -> Tuple[bool, str]:
    """Grades the 5 strict IFEval-style instruction-following tasks."""
    if not ans:
        return False, "Empty post-think answer (cutoff inside <think>)"

    if check_id == "inst_01_json_no_z":
        if "```" in ans:
            return False, "Contains forbidden markdown code fence"
        if "z" in ans.lower():
            return False, "Contains forbidden letter 'z'/'Z'"
        try:
            obj = json.loads(ans.strip())
        except Exception as e:
            return False, f"Invalid raw JSON: {e}"
        if not isinstance(obj, dict) or list(obj.keys()) != ["databases"]:
            return False, "Top-level key must be exactly ['databases']"
        dbs = obj["databases"]
        if not isinstance(dbs, list) or len(dbs) != 3:
            return False, "databases must be a list of 3 objects"
        for item in dbs:
            if not isinstance(item, dict) or set(item.keys()) != {"name", "port", "category"}:
                return False, f"Invalid item keys: {item}"
            if not isinstance(item["name"], str) or not isinstance(item["port"], int) or not isinstance(item["category"], str):
                return False, f"Invalid item types: {item}"
        return True, "Passed all JSON schema and negative character constraints"

    elif check_id == "inst_02_four_bullets":
        lines = [ln.strip() for ln in ans.strip().splitlines() if ln.strip()]
        if len(lines) != 4:
            return False, f"Expected 4 lines, got {len(lines)}"
        for i, ln in enumerate(lines, 1):
            prefix = f"- [Phase {i}]:"
            if not ln.startswith(prefix):
                return False, f"Line {i} does not start with '{prefix}' (got '{ln[:25]}')"
            wc = len(ln.split())
            if not (10 <= wc <= 24):
                return False, f"Line {i} word count {wc} outside [10, 24]"
        return True, "Passed 4-bullet prefix and word-count bounds"

    elif check_id == "inst_03_acrostic_light":
        lines = [ln.strip() for ln in ans.strip().splitlines() if ln.strip()]
        if len(lines) != 5:
            return False, f"Expected 5 lines, got {len(lines)}"
        first_letters = "".join(ln[0].upper() for ln in lines if ln)
        if first_letters != "LIGHT":
            return False, f"Acrostic initials spelled '{first_letters}' instead of 'LIGHT'"
        if re.search(r"[.,:;!\-\?\"']", ans):
            return False, "Output contains forbidden punctuation characters"
        return True, "Passed LIGHT acrostic and zero-punctuation constraints"

    elif check_id == "inst_04_table_sentinel":
        s = ans.strip()
        if not s.endswith("[TABLE_DONE]"):
            return False, "Response does not end with exact token [TABLE_DONE]"
        if "| Algorithm | Worst-Case Time | Auxiliary Space |" not in s:
            return False, "Missing exact table header '| Algorithm | Worst-Case Time | Auxiliary Space |'"
        for alg in ("mergesort", "quicksort", "heapsort"):
            if alg not in s.lower():
                return False, f"Missing row for {alg}"
        return True, "Passed exact Markdown table header, rows, and sentinel suffix"

    elif check_id == "inst_05_lexical_window":
        s = ans.strip()
        words = s.split()
        wc = len(words)
        if not (45 <= wc <= 80):
            return False, f"Word count {wc} outside [45, 80]"
        low = s.lower()
        for bad in ("memory", "ram", "disk", "slow"):
            if re.search(r"\b" + bad, low):
                return False, f"Contains forbidden word '{bad}'"
        if not low.endswith("latency is minimized."):
            return False, "Does not end with 'latency is minimized.'"
        return True, "Passed lexical window, forbidden words, and exact ending"

    return False, f"Unknown check_id {check_id}"


def grade_computer_use_check(check_id: str, ans: str) -> Tuple[bool, str]:
    """Grades the structured Computer Usage tasks (GUI actions, tool calls, Git CLI, Log parsing)."""
    if not ans:
        return False, "Empty post-think answer (cutoff inside <think>)"

    payload = extract_json_payload(ans)
    try:
        data = json.loads(payload)
    except Exception as e:
        return False, f"Invalid JSON output: {e}"

    if check_id == "comp_02_gui_trajectory":
        if not isinstance(data, list) or len(data) != 4:
            return False, f"Expected list of 4 GUI actions, got {type(data)}"
        # Action 1: click search_input [420, 110, 780, 150]
        a0, a1, a2, a3 = data
        if a0.get("action") != "click" or not (420 <= a0.get("x", -1) <= 780 and 110 <= a0.get("y", -1) <= 150):
            return False, f"Step 1 click out of search_input bounds: {a0}"
        if a1.get("action") != "type" or a1.get("text") != "error_502":
            return False, f"Step 2 type mismatch: {a1}"
        if a2.get("action") != "click" or not (1420 <= a2.get("x", -1) <= 1580 and 220 <= a2.get("y", -1) <= 260):
            return False, f"Step 3 click out of export_csv_btn bounds: {a2}"
        if a3.get("action") != "click" or not (910 <= a3.get("x", -1) <= 1010 and 540 <= a3.get("y", -1) <= 580):
            return False, f"Step 4 click out of confirm_modal_ok bounds: {a3}"
        return True, "Valid 4-step GUI coordinate & typing trajectory"

    elif check_id == "comp_03_tool_calls":
        if not isinstance(data, list) or len(data) != 3:
            return False, f"Expected 3 tool calls, got {data}"
        c0, c1, c2 = data
        if c0.get("tool") != "check_port" or c0.get("args") != {"port": 8443}:
            return False, f"Tool call 1 mismatch: {c0}"
        if c1.get("tool") != "kill_process" or c1.get("args") != {"pid": 4912, "force": True}:
            return False, f"Tool call 2 mismatch: {c1}"
        if c2.get("tool") != "start_service" or c2.get("args") != {"service_name": "auth-gateway", "port": 8443}:
            return False, f"Tool call 3 mismatch: {c2}"
        return True, "Valid 3-step tool call sequence"

    elif check_id == "comp_04_git_cli":
        if not isinstance(data, dict) or "commands" not in data or not isinstance(data["commands"], list):
            return False, "Missing 'commands' list in JSON"
        cmds = [str(c).strip() for c in data["commands"]]
        if len(cmds) != 4:
            return False, f"Expected 4 commands, got {len(cmds)}"
        c0_ok = ("checkout -b fix/login-bug" in cmds[0]) or ("switch -c fix/login-bug" in cmds[0])
        c1_ok = "git add" in cmds[1] and "src/auth.py" in cmds[1]
        c2_ok = "git commit" in cmds[2] and "Fix token expiry" in cmds[2]
        c3_ok = "git clean" in cmds[3] and ("-fd" in cmds[3] or "-df" in cmds[3] or ("-f" in cmds[3] and "-d" in cmds[3]))
        if c0_ok and c1_ok and c2_ok and c3_ok:
            return True, "Valid 4-step Git recovery CLI sequence"
        return False, f"Command check failed: {cmds}"

    elif check_id == "comp_05_log_extraction":
        if not isinstance(data, dict):
            return False, "Expected JSON object"
        expected = {
            "culprit_ip": "192.168.55.89",
            "failing_worker": "worker-3",
            "error_count": 3,
            "peak_mem_mb": 2048,
        }
        if data == expected:
            return True, "Exact log telemetry extraction match"
        return False, f"Mismatch: got {data}, expected {expected}"

    return False, f"Unknown check_id {check_id}"


def grade_task(task: dict, raw_output: str) -> dict:
    """Grades a single task output, returning strict and lenient correctness + diagnostics."""
    think_part, ans_part, closed_think = split_thinking_and_answer(raw_output)
    gtype = task["grader_type"]

    strict_correct = False
    lenient_correct = False
    reason = ""
    extracted_pred = ""

    if gtype in ("boxed_exact", "boxed_case_insensitive", "boxed_numeric_tol"):
        pred_post = extract_last_boxed(ans_part)
        pred_concl = pred_post if pred_post else (extract_last_boxed(think_part[-300:]) if closed_think else "")
        pred_any = pred_concl if pred_concl else extract_last_boxed(raw_output)
        extracted_pred = pred_concl or pred_any
        exp = str(task["expected"]).strip()

        def match_val(p: str) -> bool:
            if not p:
                return False
            p_clean = p.replace(" ", "").replace("$", "").replace("\\%", "").replace("%", "")
            e_clean = exp.replace(" ", "")
            if gtype == "boxed_exact":
                return p_clean == e_clean
            elif gtype == "boxed_case_insensitive":
                return p_clean.lower() == e_clean.lower()
            elif gtype == "boxed_numeric_tol":
                try:
                    return abs(float(p_clean) - float(e_clean)) <= float(task.get("tolerance", 1e-2))
                except Exception:
                    return False
            return False

        strict_correct = closed_think and match_val(pred_concl)
        lenient_correct = match_val(pred_any)
        reason = f"closed_think={closed_think}, pred_concl='{pred_concl}', pred_any='{pred_any}', expected='{exp}'"

    elif gtype == "python_unit_test":
        code_str = extract_python_code(ans_part if closed_think else raw_output)
        extracted_pred = code_str[:120] + ("..." if len(code_str) > 120 else "")
        if not closed_think or not ans_part.strip():
            strict_correct = False
            reason = "Cutoff inside <think> before emitting code"
        else:
            ns: dict[str, Any] = {}
            try:
                exec(code_str, ns, ns)
                exec(task["test_code"], ns, ns)
                strict_correct = True
                lenient_correct = True
                reason = "All unit tests passed"
            except Exception as e:
                strict_correct = False
                reason = f"Unit test error: {type(e).__name__}: {e}"

    elif gtype == "instruction_check":
        strict_correct, reason = grade_instruction_check(task["check_id"], ans_part)
        lenient_correct = strict_correct
        extracted_pred = ans_part[:120]

    elif gtype == "computer_use_check":
        strict_correct, reason = grade_computer_use_check(task["check_id"], ans_part)
        lenient_correct = strict_correct
        extracted_pred = ans_part[:120]

    return {
        "strict_correct": bool(strict_correct),
        "lenient_correct": bool(lenient_correct),
        "closed_think": bool(closed_think),
        "extracted_pred": extracted_pred,
        "grade_reason": reason,
        "think_8gram_rep_rate": round(compute_ngram_repetition_rate(think_part, 8), 4),
    }
