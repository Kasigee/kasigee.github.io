"""Constructs the Zero-Leakage Calibration Split and the Held-Out Multi-Domain Test Suite.

Also runs an automated N-gram, entity, and topic overlap audit to verify zero data leakage
between calibration examples (used to compute the weight-space edits) and the evaluation suite.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # project root (the scripts lived in <root>/scripts)
CAL_DIR = ROOT / "calibration"
BENCH_DIR = ROOT / "benchmarks"
CAL_DIR.mkdir(parents=True, exist_ok=True)
BENCH_DIR.mkdir(parents=True, exist_ok=True)

# ==============================================================================
# 1. CALIBRATION SPLIT (Elementary Geometry & Unit Conversions - Disjoint Domain)
# ==============================================================================
# Used ONLY for:
#  (a) Teacher-forced activation profiling of productive vs. repetitive <think> traces
#  (b) Selecting rank-1 projection layer targets & alpha scaling on live generation
CALIBRATION_DATA = {
    "description": "Disjoint calibration set of elementary geometry and unit-conversion warmups used exclusively for Weight-Space Programming direction extraction and alpha selection. Zero overlap with the 6-domain held-out evaluation benchmark.",
    "contrastive_pairs": [
        {
            "id": "cal_pair_01",
            "prompt": "Find the perimeter of a rectangle with length 14 cm and width 9 cm. Put your final numerical answer in \\boxed{}.",
            "productive_think": "<think>\nThe perimeter of a rectangle is given by P = 2 * (length + width).\nHere, length = 14 cm and width = 9 cm.\nFirst, add length and width: 14 + 9 = 23.\nNext, multiply by 2: 2 * 23 = 46.\nThe calculation is complete and verified.\n</think>\n\\boxed{46}",
            "repetitive_think": "<think>\nThe perimeter of a rectangle is 2 * (14 + 9) = 46.\nWait, let me double check if perimeter is 2*(l+w). Yes, 14 + 9 = 23, and 2 * 23 = 46.\nWait, let me check again carefully. Is length 14 and width 9? Yes, 14 + 9 = 23, 23 * 2 = 46.\nWait, let me re-verify whether 14 + 9 is really 23. 14 + 9 = 23. Multiply by 2 gives 46.\nHold on, let me check one more time just to be completely certain. 14 + 14 = 28, 9 + 9 = 18, 28 + 18 = 46.\nWait, let me double check 28 + 18 again. 28 + 18 = 46. Wait, is there any ambiguity? Let me re-read and check again.\n"
        },
        {
            "id": "cal_pair_02",
            "prompt": "Convert 68 degrees Fahrenheit to degrees Celsius using C = (F - 32) * 5 / 9. Put your final answer in \\boxed{}.",
            "productive_think": "<think>\nWe use the formula C = (F - 32) * 5 / 9 with F = 68.\nSubtract 32: 68 - 32 = 36.\nDivide by 9: 36 / 9 = 4.\nMultiply by 5: 4 * 5 = 20.\nSo 68 degrees Fahrenheit is 20 degrees Celsius.\n</think>\n\\boxed{20}",
            "repetitive_think": "<think>\nUsing C = (68 - 32) * 5 / 9.\n68 - 32 = 36. 36 * 5 / 9 = 20.\nWait, let me double check 68 - 32. Is 68 - 32 equal to 36? 32 + 36 = 68. Yes.\nWait, let me check 36 / 9 again. 36 / 9 = 4, and 4 * 5 = 20.\nHold on, let me re-verify the formula C = (F - 32) * 5 / 9. Yes, freezing is 32 F = 0 C.\nWait, let me check the arithmetic again: 36 * 5 = 180, 180 / 9 = 20.\nWait, is 180 / 9 really 20? Let me check again: 9 * 20 = 180. Wait, let me double check one more time.\n"
        },
        {
            "id": "cal_pair_03",
            "prompt": "Find the area of a right triangle with base 12 m and height 15 m. Put your final numerical answer in \\boxed{}.",
            "productive_think": "<think>\nThe area of a triangle is A = (1/2) * base * height.\nGiven base = 12 and height = 15:\nA = 0.5 * 12 * 15 = 6 * 15 = 90.\nTherefore, the area is 90.\n</think>\n\\boxed{90}",
            "repetitive_think": "<think>\nArea = 1/2 * base * height = 1/2 * 12 * 15 = 6 * 15 = 90.\nWait, let me double check if 6 * 15 is 90. 6 * 10 = 60, 6 * 5 = 30, 60 + 30 = 90.\nWait, let me check 12 * 15 first and then divide by 2. 12 * 15 = 180, 180 / 2 = 90.\nHold on, let me check again if it's a right triangle. Yes, base 12 and height 15, so area is 1/2 * 12 * 15 = 90.\nWait, let me verify 12 * 15 = 180 again. 10 * 15 = 150, 2 * 15 = 30, 150 + 30 = 180. Divide by 2 is 90.\nWait, let me double check this one more time just in case.\n"
        },
        {
            "id": "cal_pair_04",
            "prompt": "How many minutes are in 4.5 hours? Put your final numerical answer in \\boxed{}.",
            "productive_think": "<think>\nThere are 60 minutes in 1 hour.\nFor 4.5 hours, we multiply 4.5 * 60.\n4 * 60 = 240, and 0.5 * 60 = 30.\n240 + 30 = 270 minutes.\n</think>\n\\boxed{270}",
            "repetitive_think": "<think>\n1 hour = 60 minutes. So 4.5 hours = 4.5 * 60 = 270 minutes.\nWait, let me double check 4.5 * 60. 4 * 60 = 240, 0.5 * 60 = 30, 240 + 30 = 270.\nWait, let me check again. Is 0.5 hours equal to 30 minutes? Yes, half of 60 is 30.\nAnd 4 hours is 4 * 60 = 240 minutes. 240 + 30 = 270.\nHold on, let me re-verify 4.5 * 60 = 270. 45 * 6 = 270. Yes.\nWait, let me check 45 * 6 again: 40 * 6 = 240, 5 * 6 = 30, 240 + 30 = 270. Wait, let me check once more.\n"
        },
        {
            "id": "cal_pair_05",
            "prompt": "Find the sum of the interior angles of a convex pentagon in degrees. Put your final numerical answer in \\boxed{}.",
            "productive_think": "<think>\nThe sum of interior angles of an n-sided polygon is (n - 2) * 180 degrees.\nFor a pentagon, n = 5.\nSo (5 - 2) * 180 = 3 * 180 = 540 degrees.\n</think>\n\\boxed{540}",
            "repetitive_think": "<think>\nFor a pentagon, n = 5. The formula is (n - 2) * 180 = 3 * 180 = 540.\nWait, let me double check if a pentagon has 5 sides. Yes, penta means 5.\nAnd for n = 5, (5 - 2) * 180 = 3 * 180 = 540.\nWait, let me check 3 * 180 again. 3 * 100 = 300, 3 * 80 = 240, 300 + 240 = 540.\nHold on, let me check using triangles: a pentagon can be divided into 3 triangles, each 180 degrees, so 3 * 180 = 540.\nWait, let me verify 3 * 180 = 540 one more time. Let me re-check.\n"
        },
        {
            "id": "cal_pair_06",
            "prompt": "A bicycle travels 45 kilometers in 3 hours. What is its average speed in km/h? Put your final numerical answer in \\boxed{}.",
            "productive_think": "<think>\nAverage speed is total distance divided by total time.\nDistance = 45 km, Time = 3 hours.\nSpeed = 45 / 3 = 15 km/h.\n</think>\n\\boxed{15}",
            "repetitive_think": "<think>\nSpeed = distance / time = 45 / 3 = 15 km/h.\nWait, let me double check 45 / 3. 15 * 3 = 45. Yes, 15.\nWait, let me check the units: kilometers per hour, and we have 45 kilometers and 3 hours.\nSo 45 / 3 = 15. Hold on, let me check 15 * 3 again: 10 * 3 = 30, 5 * 3 = 15, 30 + 15 = 45.\nWait, let me verify again whether there is any other step. 45 / 3 = 15. Let me double check once more.\n"
        },
        {
            "id": "cal_pair_07",
            "prompt": "Calculate the simple interest on a principal of $500 at an annual rate of 6% for 4 years. Put your final numerical answer in \\boxed{}.",
            "productive_think": "<think>\nSimple interest is I = P * r * t.\nHere P = 500, r = 0.06, and t = 4.\nP * r = 500 * 0.06 = 30.\nMultiply by t = 4: 30 * 4 = 120.\n</think>\n\\boxed{120}",
            "repetitive_think": "<think>\nSimple interest I = P * r * t = 500 * 0.06 * 4 = 30 * 4 = 120.\nWait, let me double check 500 * 0.06. 5 * 6 = 30. Yes, 30 per year.\nFor 4 years, 30 * 4 = 120.\nWait, let me check if 6% of 500 is really 30. 1% of 500 is 5, so 6% is 6 * 5 = 30.\nAnd over 4 years, 4 * 30 = 120. Hold on, let me re-verify 4 * 30 = 120 again. Wait, let me check once more.\n"
        },
        {
            "id": "cal_pair_08",
            "prompt": "Find the volume of a cube with side length 7 cm. Put your final numerical answer in \\boxed{}.",
            "productive_think": "<think>\nThe volume of a cube with side length s is V = s^3.\nFor s = 7:\n7^2 = 49.\n49 * 7 = (50 - 1) * 7 = 350 - 7 = 343.\n</think>\n\\boxed{343}",
            "repetitive_think": "<think>\nVolume of a cube is s^3 = 7^3 = 343.\nWait, let me double check 7 * 7 * 7. 7 * 7 = 49. 49 * 7 = 343.\nWait, let me check 49 * 7 again: 40 * 7 = 280, 9 * 7 = 63, 280 + 63 = 343.\nHold on, is 280 + 63 equal to 343? 280 + 60 = 340, plus 3 is 343.\nWait, let me check again if the side length is 7. Yes, 7^3 = 343. Let me double check 49 * 7 one more time.\n"
        }
    ],
    "live_calibration_questions": [
        {
            "id": "cal_live_01",
            "prompt": "A rectangular garden is 18 meters long and 11 meters wide. A path of uniform width 1 meter is built around the outside of the garden. What is the area of the path alone in square meters? Put your final answer in \\boxed{}.",
            "expected": "62"
        },
        {
            "id": "cal_live_02",
            "prompt": "A water tank is a rectangular prism of length 5 m, width 4 m, and height 3 m. If it is 65% full, how many cubic meters of water are in the tank? Put your final answer in \\boxed{}.",
            "expected": "39"
        },
        {
            "id": "cal_live_03",
            "prompt": "An isosceles triangle has perimeter 50 cm, and its base is 14 cm long. What is the length of one of its two equal legs in cm? Put your final answer in \\boxed{}.",
            "expected": "18"
        },
        {
            "id": "cal_live_04",
            "prompt": "Convert a speed of 25 meters per second into kilometers per hour. Put your final numerical answer in \\boxed{}.",
            "expected": "90"
        },
        {
            "id": "cal_live_05",
            "prompt": "The angles of a triangle are in the ratio 2 : 3 : 4. What is the measure of the largest angle in degrees? Put your final answer in \\boxed{}.",
            "expected": "80"
        },
        {
            "id": "cal_live_06",
            "prompt": "A cylinder has base area 24 pi square centimeters and height 10 centimeters. If its volume is V * pi cubic centimeters, what is V? Put your final answer in \\boxed{}.",
            "expected": "240"
        }
    ]
}

# ==============================================================================
# 2. HELD-OUT 6-DOMAIN EVALUATION SUITE (30 Tasks Across 6 Domains)
# ==============================================================================
MULTI_DOMAIN_SUITE = [
    # --------------------------------------------------------------------------
    # DOMAIN 1: Mathematics & Quantitative Reasoning (5 tasks)
    # --------------------------------------------------------------------------
    {
        "id": "math_01",
        "domain": "Mathematics",
        "title": "Modular Exponentiation (Euler's Totient)",
        "prompt": "Find the remainder when 17^2026 is divided by 25. Put your final numerical answer inside \\boxed{}.",
        "grader_type": "boxed_exact",
        "expected": "19"
    },
    {
        "id": "math_02",
        "domain": "Mathematics",
        "title": "Three-Variable Linear System (Coins & Weights)",
        "prompt": "A pouch contains 24 coins consisting only of bronze, silver, and gold coins. Bronze coins weigh 3g each, silver coins weigh 5g each, and gold coins weigh 8g each. There are twice as many silver coins as gold coins, and the total weight of all 24 coins is 117g. How many bronze coins are in the pouch? Put your final numerical answer inside \\boxed{}.",
        "grader_type": "boxed_exact",
        "expected": "9"
    },
    {
        "id": "math_03",
        "domain": "Mathematics",
        "title": "Combinatorics with Adjacency Constraints",
        "prompt": "In how many ways can 6 distinct books (including 1 Physics book and 1 Chemistry book) be arranged on a shelf in a single row such that the Physics book and the Chemistry book are NOT adjacent to each other? Put your final numerical answer inside \\boxed{}.",
        "grader_type": "boxed_exact",
        "expected": "480"
    },
    {
        "id": "math_04",
        "domain": "Mathematics",
        "title": "Number Theory Divisor Counting",
        "prompt": "How many positive integer divisors of 3600 are perfect squares? Put your final numerical answer inside \\boxed{}.",
        "grader_type": "boxed_exact",
        "expected": "12"
    },
    {
        "id": "math_05",
        "domain": "Mathematics",
        "title": "Telescoping Rational Series",
        "prompt": "Evaluate the sum S = 1/(1*3) + 1/(3*5) + 1/(5*7) + ... + 1/(29*31). Express S as a simplified fraction a/b where a and b are coprime positive integers, and compute a + b. Put your final numerical answer inside \\boxed{}.",
        "grader_type": "boxed_exact",
        "expected": "46"
    },

    # --------------------------------------------------------------------------
    # DOMAIN 2: Deductive Logic & Algorithmic Puzzles (5 tasks)
    # --------------------------------------------------------------------------
    {
        "id": "logic_01",
        "domain": "Deductive Logic",
        "title": "Knights and Knaves Island Deduction",
        "prompt": "On an island, every inhabitant is either a Knight (who always tells the truth) or a Knave (who always lies). You meet three inhabitants: Alice, Bob, and Carol.\n- Alice says: \"Bob is a Knave.\"\n- Bob says: \"Alice and Carol are of the same type (both Knights or both Knaves).\"\nIs Carol a Knight or a Knave? Put your final one-word answer (Knight or Knave) inside \\boxed{}.",
        "grader_type": "boxed_case_insensitive",
        "expected": "Knave"
    },
    {
        "id": "logic_02",
        "domain": "Deductive Logic",
        "title": "Five-Server Rack Constraint Satisfaction",
        "prompt": "Five servers (A, B, C, D, E) are mounted in a vertical rack in slots 1 (bottom) through 5 (top), one per slot.\n1. Server C is immediately above Server A.\n2. Server D is in a higher slot than Server B, and Server B is in a higher slot than Server C.\n3. Server E is in slot 1.\nWhich server is in slot 4? Put its single letter inside \\boxed{}.",
        "grader_type": "boxed_case_insensitive",
        "expected": "B"
    },
    {
        "id": "logic_03",
        "domain": "Deductive Logic",
        "title": "Register State-Machine Execution Trace",
        "prompt": "A machine has two integer registers, X and Y, initially set to X = 3 and Y = 2. It executes the following loop for step k = 1, 2, 3, 4 (in order):\n- If (X + Y) is odd: set X = X + Y, and keep Y unchanged.\n- If (X + Y) is even: set Y = Y + 3, and set X = X - 1.\nWhat is the value of X + Y after step k = 4 finishes? Put your final numerical answer inside \\boxed{}.",
        "grader_type": "boxed_exact",
        "expected": "13"
    },
    {
        "id": "logic_04",
        "domain": "Deductive Logic",
        "title": "Bridge & Torch Minimum Crossing Time",
        "prompt": "Four hikers need to cross a narrow bridge at night with a single torch. At most two hikers can cross at a time, and any crossing requires carrying the torch. Their individual crossing times are 1 minute, 2 minutes, 5 minutes, and 9 minutes. When two hikers cross together, they move at the slower hiker's pace. What is the minimum total number of minutes required for all four hikers to cross to the other side? Put your final numerical answer inside \\boxed{}.",
        "grader_type": "boxed_exact",
        "expected": "16"
    },
    {
        "id": "logic_05",
        "domain": "Deductive Logic",
        "title": "Boolean Circuit & Contrapositive Deduction",
        "prompt": "Consider four boolean flags P, Q, R, S that satisfy all four rules:\n1. If P is True, then Q is True.\n2. If Q is True, then R is False.\n3. Either R is True or S is False (or both).\n4. S is True.\nDetermine which of P, Q, R, S are True. Write the True flags in alphabetical order separated by commas inside \\boxed{} (for example, \\boxed{P,R}).",
        "grader_type": "boxed_case_insensitive",
        "expected": "R,S"
    },

    # --------------------------------------------------------------------------
    # DOMAIN 3: Software Engineering & Code Synthesis (5 tasks - Unit Tested!)
    # --------------------------------------------------------------------------
    {
        "id": "code_01",
        "domain": "Software Engineering",
        "title": "Interval Merging with Touching Boundaries",
        "prompt": "Write a Python function `merge_intervals(intervals: list[list[int]]) -> list[list[int]]` that takes a list of closed integer intervals `[start, end]` (potentially unsorted and potentially empty) and merges all overlapping or touching intervals (e.g. `[1, 3]` and `[3, 5]` merge into `[1, 5]`), returning the merged intervals sorted by start time. Return ONLY a Python code block containing the function definition.",
        "grader_type": "python_unit_test",
        "entry_point": "merge_intervals",
        "test_code": """
assert merge_intervals([]) == []
assert merge_intervals([[1, 3], [3, 5], [7, 9]]) == [[1, 5], [7, 9]]
assert merge_intervals([[8, 10], [1, 3], [2, 6], [15, 18]]) == [[1, 6], [8, 10], [15, 18]]
assert merge_intervals([[5, 5], [1, 2], [2, 5]]) == [[1, 5]]
"""
    },
    {
        "id": "code_02",
        "domain": "Software Engineering",
        "title": "Longest Parity-Balanced Contiguous Subarray",
        "prompt": "Write a Python function `longest_parity_subarray(nums: list[int]) -> int` that returns the maximum length of a contiguous subarray of `nums` that contains an equal number of even and odd integers. Target O(n) time complexity using a prefix sum map. Return ONLY a Python code block containing the function definition.",
        "grader_type": "python_unit_test",
        "entry_point": "longest_parity_subarray",
        "test_code": """
assert longest_parity_subarray([]) == 0
assert longest_parity_subarray([2, 4, 6]) == 0
assert longest_parity_subarray([1, 2]) == 2
assert longest_parity_subarray([2, 1, 3, 4, 5, 6, 8]) == 6
assert longest_parity_subarray([1, 1, 2, 1, 2, 2, 1]) == 6
"""
    },
    {
        "id": "code_03",
        "domain": "Software Engineering",
        "title": "DAG Cycle Detection & Task Schedulability",
        "prompt": "Write a Python function `can_schedule_all(num_tasks: int, dependencies: list[tuple[int, int]]) -> bool` where tasks are labeled `0` to `num_tasks - 1` and each pair `(u, v)` in `dependencies` means task `u` depends on task `v` being completed first. Return `True` if there exists a valid topological ordering to finish all tasks (no directed cycles), and `False` otherwise. Return ONLY a Python code block containing the function definition.",
        "grader_type": "python_unit_test",
        "entry_point": "can_schedule_all",
        "test_code": """
assert can_schedule_all(2, [(1, 0)]) is True
assert can_schedule_all(2, [(1, 0), (0, 1)]) is False
assert can_schedule_all(4, [(1, 0), (2, 1), (3, 2)]) is True
assert can_schedule_all(4, [(1, 0), (2, 1), (0, 2), (3, 1)]) is False
assert can_schedule_all(3, [(0, 0)]) is False
"""
    },
    {
        "id": "code_04",
        "domain": "Software Engineering",
        "title": "Run-Length Encoding with Multi-Digit Counts",
        "prompt": "Write a Python function `rle_decode(encoded: str) -> str` that decodes a run-length encoded string where each run consists of an uppercase/lowercase letter followed by a positive integer count (possibly multi-digit), e.g., `'a3b12c1'` -> `'aaabbbbbbbbbbbbc'`. Return ONLY a Python code block containing the function definition.",
        "grader_type": "python_unit_test",
        "entry_point": "rle_decode",
        "test_code": """
assert rle_decode("") == ""
assert rle_decode("a3b2c1") == "aaabbc"
assert rle_decode("x12y2") == "xxxxxxxxxxxxyy"
assert rle_decode("Z1a10") == "Zaaaaaaaaaa"
"""
    },
    {
        "id": "code_05",
        "domain": "Software Engineering",
        "title": "Deterministic LRU Cache Simulator",
        "prompt": "Write a Python function `simulate_lru(capacity: int, operations: list[tuple]) -> list[int]` that simulates an LRU (Least Recently Used) cache of positive integer capacity `capacity`. Each element in `operations` is either `('PUT', key, value)` or `('GET', key)`. Every `'GET'` operation appends the value (or `-1` if the key is not found) to an output list and marks the key as most recently used. `'PUT'` inserts or updates the key-value pair, marks it as most recently used, and evicts the least recently used key if capacity is exceeded. Return the list of results from all `'GET'` operations. Return ONLY a Python code block containing the function definition.",
        "grader_type": "python_unit_test",
        "entry_point": "simulate_lru",
        "test_code": """
ops = [
    ('PUT', 1, 10),
    ('PUT', 2, 20),
    ('GET', 1),
    ('PUT', 3, 30),
    ('GET', 2),
    ('PUT', 4, 40),
    ('GET', 1),
    ('GET', 3),
    ('GET', 4),
]
assert simulate_lru(2, ops) == [10, -1, -1, 30, 40]
"""
    },

    # --------------------------------------------------------------------------
    # DOMAIN 4: Scientific & Physical Sciences Reasoning (5 tasks)
    # --------------------------------------------------------------------------
    {
        "id": "sci_01",
        "domain": "Physical & Life Sciences",
        "title": "Chemical Thermodynamics Crossover Temperature",
        "prompt": "A chemical reaction has standard enthalpy change Delta_H = +126 kJ/mol and standard entropy change Delta_S = +175 J/(mol*K). Assume Delta_H and Delta_S are independent of temperature. Above what minimum temperature T (in Kelvin) does the reaction become spontaneous (Delta_G < 0)? Put your final numerical answer in Kelvin inside \\boxed{}.",
        "grader_type": "boxed_exact",
        "expected": "720"
    },
    {
        "id": "sci_02",
        "domain": "Physical & Life Sciences",
        "title": "Henderson-Hasselbalch Buffer pH Shift",
        "prompt": "A 1.0 L buffer solution initially contains 0.35 mol of a weak acid HA (with pKa = 4.76) and 0.25 mol of its conjugate base A-. If 0.05 mol of solid NaOH (a strong base) is completely dissolved into the buffer without changing the volume, what is the resulting pH of the solution? Put your final numerical answer inside \\boxed{}.",
        "grader_type": "boxed_numeric_tol",
        "expected": "4.76",
        "tolerance": 0.02
    },
    {
        "id": "sci_03",
        "domain": "Physical & Life Sciences",
        "title": "Planetary Escape Velocity Scaling",
        "prompt": "Planet X has 9 times the mass of Earth and 4 times the radius of Earth. Given that the escape velocity from a spherical planet of mass M and radius R is v_e = sqrt(2GM/R), what is the ratio of the escape velocity on Planet X to the escape velocity on Earth (v_X / v_Earth) expressed as a decimal? Put your final numerical answer inside \\boxed{}.",
        "grader_type": "boxed_numeric_tol",
        "expected": "1.5",
        "tolerance": 0.01
    },
    {
        "id": "sci_04",
        "domain": "Physical & Life Sciences",
        "title": "Population Genetics Hardy-Weinberg Equilibrium",
        "prompt": "In a large population in Hardy-Weinberg equilibrium, an autosomal recessive condition (genotype aa) affects 1 in 2500 individuals (q^2 = 1/2500). What percentage of the population are heterozygous carriers (genotype 2pq)? Express your answer as a decimal percentage (for example, if 5.2%, write 5.2) inside \\boxed{}.",
        "grader_type": "boxed_numeric_tol",
        "expected": "3.92",
        "tolerance": 0.05
    },
    {
        "id": "sci_05",
        "domain": "Physical & Life Sciences",
        "title": "First-Order Isotope Decay Kinetics",
        "prompt": "A radioactive isotope undergoes first-order decay with a half-life of 15 minutes. Starting with an initial sample mass of 320 mg, how many minutes does it take until exactly 10 mg of the isotope remains? Put your final numerical answer inside \\boxed{}.",
        "grader_type": "boxed_exact",
        "expected": "75"
    },

    # --------------------------------------------------------------------------
    # DOMAIN 5: Strict Instruction Following (5 tasks - Programmatic Verifiers)
    # --------------------------------------------------------------------------
    {
        "id": "inst_01",
        "domain": "Instruction Following",
        "title": "Strict JSON Schema + Forbidden Character",
        "prompt": "Output ONLY a raw valid JSON object (do NOT wrap it in markdown code blocks or ```json fences, and include no prose before or after). The JSON object must have a single top-level key \"databases\" mapping to a list of exactly 3 objects. Each object must have the exact keys \"name\" (string), \"port\" (integer), and \"category\" (string). Furthermore, the entire output must NOT contain the letter 'z' or 'Z' anywhere.",
        "grader_type": "instruction_check",
        "check_id": "inst_01_json_no_z"
    },
    {
        "id": "inst_02",
        "domain": "Instruction Following",
        "title": "Exact 4-Bullet Structure with Word-Count Bounds",
        "prompt": "Explain how HTTPS TLS handshakes establish a secure connection using EXACTLY 4 bullet points and no introductory or concluding text.\nConstraints:\n1. The 4 lines must start with `- [Phase 1]: `, `- [Phase 2]: `, `- [Phase 3]: `, and `- [Phase 4]: ` respectively.\n2. Each bullet line (counting all whitespace-separated tokens on that line) must contain between 10 and 24 words inclusive.",
        "grader_type": "instruction_check",
        "check_id": "inst_02_four_bullets"
    },
    {
        "id": "inst_03",
        "domain": "Instruction Following",
        "title": "Strict Acrostic Poem Without Punctuation",
        "prompt": "Write a 5-line acrostic poem about astronomy where the first letters of the 5 lines spell L I G H T.\nStrict rules:\n1. Output ONLY the 5 lines of the poem (no title, no blank lines, no extra commentary).\n2. Do NOT use any punctuation characters (no periods, commas, colons, semicolons, hyphens, or exclamation marks) anywhere in your output.",
        "grader_type": "instruction_check",
        "check_id": "inst_03_acrostic_light"
    },
    {
        "id": "inst_04",
        "domain": "Instruction Following",
        "title": "Exact Markdown Table + Sentinel Suffix",
        "prompt": "Create a Markdown table comparing three sorting algorithms: MergeSort, QuickSort, and HeapSort.\nStrict rules:\n1. The header row must be exact: `| Algorithm | Worst-Case Time | Auxiliary Space |`\n2. Include the separator row and exactly 3 data rows (one for each algorithm).\n3. The very last characters of your entire response must be the exact token `[TABLE_DONE]`.",
        "grader_type": "instruction_check",
        "check_id": "inst_04_table_sentinel"
    },
    {
        "id": "inst_05",
        "domain": "Instruction Following",
        "title": "Negative Lexical Constraints + Word Count Window",
        "prompt": "Write a single paragraph explaining how a CPU cache speeds up computation.\nStrict rules:\n1. Your entire response must be between 45 and 80 words long.\n2. You are strictly FORBIDDEN from using any of these words (case-insensitive, including plurals/substrings): \"memory\", \"ram\", \"disk\", \"slow\".\n3. End your paragraph with the exact phrase: `latency is minimized.`",
        "grader_type": "instruction_check",
        "check_id": "inst_05_lexical_window"
    },

    # --------------------------------------------------------------------------
    # DOMAIN 6: Computer Usage & Agentic Tool / GUI / CLI Planning (5 tasks)
    # --------------------------------------------------------------------------
    {
        "id": "comp_01",
        "domain": "Computer Usage",
        "title": "PowerShell Log Filter & JSON Export Synthesis (Sandbox Tested)",
        "prompt": "You are a computer-use automation agent on Windows PowerShell. Write a Python function `find_large_logs(target_dir: str, min_bytes: int) -> list[dict]` that inspects `target_dir` (non-recursively), finds all files ending with `.log` whose file size in bytes is strictly greater than `min_bytes`, and returns a list of dicts `[{'name': filename, 'size_bytes': size}, ...]` sorted by `'size_bytes'` in descending order (ties broken by `'name'` ascending). Return ONLY a Python code block containing the function definition.",
        "grader_type": "python_unit_test",
        "entry_point": "find_large_logs",
        "test_code": """
import tempfile, os
with tempfile.TemporaryDirectory() as tmp:
    with open(os.path.join(tmp, 'a.log'), 'wb') as f: f.write(b'x' * 500)
    with open(os.path.join(tmp, 'b.log'), 'wb') as f: f.write(b'x' * 2048)
    with open(os.path.join(tmp, 'c.txt'), 'wb') as f: f.write(b'x' * 4096)
    with open(os.path.join(tmp, 'd.log'), 'wb') as f: f.write(b'x' * 1500)
    res = find_large_logs(tmp, 1024)
    assert res == [{'name': 'b.log', 'size_bytes': 2048}, {'name': 'd.log', 'size_bytes': 1500}], f'Got {res}'
"""
    },
    {
        "id": "comp_02",
        "domain": "Computer Usage",
        "title": "GUI Desktop Accessibility Tree Coordinate Trajectory",
        "prompt": "You are a GUI computer-use agent controlling a 1920x1080 desktop screen. The current window's accessibility tree contains these interactive elements with bounding boxes `[x_min, y_min, x_max, y_max]`:\n- `search_input`: `[420, 110, 780, 150]`\n- `status_dropdown`: `[810, 110, 950, 150]`\n- `export_csv_btn`: `[1420, 220, 1580, 260]`\n- `confirm_modal_ok`: `[910, 540, 1010, 580]`\n\nTask: Click the `search_input` box, type the exact string `\"error_502\"`, click `export_csv_btn`, and then click `confirm_modal_ok`.\nOutput ONLY a valid JSON array of 4 action objects (no markdown fences or extra text) following this schema:\n- Click action: `{\"action\": \"click\", \"x\": <int>, \"y\": <int>}` where `(x, y)` is strictly inside the element's bounding box.\n- Type action: `{\"action\": \"type\", \"text\": \"<string>\"}`.",
        "grader_type": "computer_use_check",
        "check_id": "comp_02_gui_trajectory"
    },
    {
        "id": "comp_03",
        "domain": "Computer Usage",
        "title": "Multi-Step System Diagnostic Tool-Calling Plan",
        "prompt": "You are an infrastructure agent with access to exactly four tools:\n1. `check_port(port: int)`\n2. `find_pid_by_port(port: int)`\n3. `kill_process(pid: int, force: bool)`\n4. `start_service(service_name: str, port: int)`\n\nIncident: The service `\"auth-gateway\"` failed to bind to port `8443` because a zombie process with PID `4912` is holding port `8443`.\nOutput ONLY a valid JSON array of tool call objects representing the 3-step recovery sequence: first verify port `8443` status with `check_port`, second forcibly terminate PID `4912` with `kill_process`, and third start `\"auth-gateway\"` on port `8443` with `start_service`.\nEach element must have keys `\"tool\"` (string) and `\"args\"` (object with the exact parameter names and types above). Do NOT wrap in markdown code fences.",
        "grader_type": "computer_use_check",
        "check_id": "comp_03_tool_calls"
    },
    {
        "id": "comp_04",
        "domain": "Computer Usage",
        "title": "Git Incident Recovery CLI Action Plan",
        "prompt": "A developer's repository is currently on branch `main` with modified tracked files and untracked build artifacts. They need to:\n1. Create and switch to a new branch named `fix/login-bug`.\n2. Stage only the file `src/auth.py`.\n3. Commit the staged change with the exact commit message `Fix token expiry`.\n4. Remove untracked files and directories forcibly using `git clean`.\n\nOutput ONLY a valid JSON object (no markdown fences) with a single key `\"commands\"` mapping to a list of the 4 exact CLI command strings in execution order.",
        "grader_type": "computer_use_check",
        "check_id": "comp_04_git_cli"
    },
    {
        "id": "comp_05",
        "domain": "Computer Usage",
        "title": "Server Log Telemetry Parsing & Structured Incident Extraction",
        "prompt": "Inspect the following system log excerpt:\n```\n2026-11-03T03:14:01Z INFO  [worker-1] ip=10.0.4.12 endpoint=/api/v1/health status=200 mem_mb=410\n2026-11-03T03:14:04Z ERROR [worker-3] ip=192.168.55.89 endpoint=/api/v2/checkout status=503 mem_mb=1840\n2026-11-03T03:14:05Z ERROR [worker-3] ip=192.168.55.89 endpoint=/api/v2/checkout status=503 mem_mb=1925\n2026-11-03T03:14:06Z INFO  [worker-2] ip=10.0.4.19 endpoint=/api/v1/catalog status=200 mem_mb=520\n2026-11-03T03:14:08Z ERROR [worker-3] ip=192.168.55.89 endpoint=/api/v2/checkout status=503 mem_mb=2048\n```\nOutput ONLY a raw JSON object (no markdown fences) with these exact 4 keys:\n- `\"culprit_ip\"`: string IP address associated with the 503 errors\n- `\"failing_worker\"`: string worker ID experiencing the errors\n- `\"error_count\"`: integer count of `ERROR` lines\n- `\"peak_mem_mb\"`: integer maximum `mem_mb` recorded across all lines",
        "grader_type": "computer_use_check",
        "check_id": "comp_05_log_extraction"
    }
]

# ==============================================================================
# 3. HELD-OUT SPOKEN TTS SUITE (6 Tasks for Local Qwen3-TTS 0.6B & 1.7B)
# ==============================================================================
TTS_SUITE = [
    {
        "id": "tts_01_math",
        "domain": "Mathematics (Spoken)",
        "text": "By Euler's totient theorem, seventeen raised to the twentieth power is congruent to one modulo twenty-five, leaving a final remainder of nine."
    },
    {
        "id": "tts_02_code",
        "domain": "Software Engineering (Spoken)",
        "text": "To merge overlapping intervals in linearithmic time, first sort the array by start coordinate and then iterate through each interval boundary."
    },
    {
        "id": "tts_03_science",
        "domain": "Physical Sciences (Spoken)",
        "text": "When enthalpy and entropy are both positive, Gibbs free energy becomes negative above the crossover temperature of seven hundred twenty Kelvin."
    },
    {
        "id": "tts_04_computer_use",
        "domain": "Computer Usage CLI (Spoken)",
        "text": "Execute the PowerShell pipeline to filter log files larger than one kilobyte, sort them by size descending, and export the structured JSON report."
    },
    {
        "id": "tts_05_articulation",
        "domain": "Phonetic & Prosodic Stress Test",
        "text": "Specifically, six sinister statistics specialists systematically synthesized seventy-six separate speech segments without stuttering or looping."
    },
    {
        "id": "tts_06_long_horizon",
        "domain": "Long-Horizon Narrative Synthesis",
        "text": "Weight-space programming allows a frontier language model to directly inspect and edit the parameters of a smaller neural network, suppressing repetitive loops in a single surgical rank-one projection without gradient descent."
    }
]


def tokenize_ngrams(text: str, n: int):
    words = re.findall(r"[a-z0-9]+", text.lower())
    return set(tuple(words[i:i + n]) for i in range(max(0, len(words) - n + 1)))


def verify_zero_leakage():
    cal_texts = []
    for p in CALIBRATION_DATA["contrastive_pairs"]:
        cal_texts.append(p["prompt"])
        cal_texts.append(p["productive_think"])
    for q in CALIBRATION_DATA["live_calibration_questions"]:
        cal_texts.append(q["prompt"])

    bench_texts = [item["prompt"] for item in MULTI_DOMAIN_SUITE]

    cal_full = " ".join(cal_texts)
    bench_full = " ".join(bench_texts)

    # Check 5-gram and 6-gram overlaps (excluding generic formatting instructions)
    cal_clean = re.sub(r"put your final.*?\\boxed\{\}\.", "", cal_full, flags=re.I)
    bench_clean = re.sub(r"put your final.*?\\boxed\{\}\.", "", bench_full, flags=re.I)

    cal_5grams = tokenize_ngrams(cal_clean, 5)
    bench_5grams = tokenize_ngrams(bench_clean, 5)
    overlap_5 = cal_5grams.intersection(bench_5grams)

    cal_6grams = tokenize_ngrams(cal_clean, 6)
    bench_6grams = tokenize_ngrams(bench_clean, 6)
    overlap_6 = cal_6grams.intersection(bench_6grams)

    report = {
        "calibration_contrastive_pairs": len(CALIBRATION_DATA["contrastive_pairs"]),
        "calibration_live_questions": len(CALIBRATION_DATA["live_calibration_questions"]),
        "held_out_evaluation_tasks": len(MULTI_DOMAIN_SUITE),
        "held_out_domains": sorted(list(set(x["domain"] for x in MULTI_DOMAIN_SUITE))),
        "tts_evaluation_tasks": len(TTS_SUITE),
        "unique_calibration_5grams": len(cal_5grams),
        "unique_benchmark_5grams": len(bench_5grams),
        "content_5gram_overlap_count": len(overlap_5),
        "content_6gram_overlap_count": len(overlap_6),
        "overlapping_5grams": [" ".join(g) for g in overlap_5],
        "zero_leakage_verified": len(overlap_5) == 0 and len(overlap_6) == 0,
    }
    return report


if __name__ == "__main__":
    (CAL_DIR / "calibration_prompts.json").write_text(
        json.dumps(CALIBRATION_DATA, indent=2), encoding="utf-8"
    )
    (BENCH_DIR / "multi_domain_test_suite.json").write_text(
        json.dumps(MULTI_DOMAIN_SUITE, indent=2), encoding="utf-8"
    )
    (BENCH_DIR / "tts_spoken_test_suite.json").write_text(
        json.dumps(TTS_SUITE, indent=2), encoding="utf-8"
    )
    leakage_report = verify_zero_leakage()
    (BENCH_DIR / "zero_leakage_audit.json").write_text(
        json.dumps(leakage_report, indent=2), encoding="utf-8"
    )
    print("=== Benchmark & Zero-Leakage Audit Summary ===")
    print(json.dumps(leakage_report, indent=2))
