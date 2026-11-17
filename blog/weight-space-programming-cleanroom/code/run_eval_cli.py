"""CLI wrapper for running cleanroom evaluation suites."""

import argparse
import json
import os
from evaluator import evaluate_suite


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--sample", action="store_true")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--max-new-tokens", type=int, default=2048)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    with open(args.dataset, "r", encoding="utf-8") as f:
        tasks = json.load(f)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    out = evaluate_suite(
        model_path=args.model,
        tasks=tasks,
        do_sample=args.sample,
        max_new_tokens=args.max_new_tokens,
        batch_size=args.batch_size,
        seed=args.seed,
        label=args.label,
    )
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print("=== SUMMARY ===")
    print(json.dumps(out["summary"], indent=2))


if __name__ == "__main__":
    main()
