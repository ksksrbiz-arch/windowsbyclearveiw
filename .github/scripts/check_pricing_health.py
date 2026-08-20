#!/usr/bin/env python3
"""Fail loudly when the estimator's pricing needs a human look.

Reads the pricing worker's /health JSON on stdin (or a path as argv[1]) and
exits non-zero when the stored pricing is invalid or overdue for review.
Nothing stored is a pass: the site falls back to the numbers in the repo.
"""

import json
import sys


def main() -> int:
    raw = open(sys.argv[1]).read() if len(sys.argv) > 1 else sys.stdin.read()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"::error::/health did not return JSON: {exc}")
        print(raw[:500])
        return 1

    if not data.get("stored"):
        print(
            "::notice::No pricing stored in KV, so the estimator is using the "
            "figures committed in src/data/pricing.ts. That is safe — but Mark's "
            "own numbers would convert better than regional averages."
        )
        return 0

    problems = data.get("problems") or []
    warnings = data.get("warnings") or []

    for warning in warnings:
        print(f"::warning::{warning}")
    for problem in problems:
        print(f"::error::{problem}")

    if problems:
        print(
            "Stored pricing is invalid. The worker is refusing to serve it and "
            "the site has fallen back to its bundled numbers, so nothing is "
            "broken for visitors — but the stored copy needs fixing."
        )
        return 1

    if warnings:
        print(
            f"Pricing is valid but {data.get('ageDays')} days old "
            f"(source: {data.get('source')}). Time to re-confirm the numbers."
        )
        return 1

    print(
        f"Pricing OK — source={data.get('source')} "
        f"reviewed={data.get('reviewedAt')} age={data.get('ageDays')}d"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
