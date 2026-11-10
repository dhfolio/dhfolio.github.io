#!/usr/bin/env python3
"""Bump the cache-bust version across every frontend file in one shot.

Usage:
    python _scripts/bump_version.py 0.9.126

Scans the repo for `?v=X.Y.Z` query strings — used both as the
cache-bust marker on index.html asset tags and as the ES-module import
identifier (e.g. `import ... from "./router.js?v=0.9.125"`) — and
replaces every occurrence with the new version.

Run this before each frontend deploy. Backend-only commits don't need
a bump.

WHY THIS EXISTS: the `?v=` query string serves two purposes in the
browser. (1) Cache invalidation — different URLs, different cache
entries. (2) ES-module identity — `router.js?v=0.9.84` and
`router.js?v=0.9.125` are two separate module instances in memory even
though they resolve to the same file. When main.js was bumped to 0.9.124
but navigation.js's internal import still said `?v=0.9.84`, the browser
loaded TWO router.js instances and clicking sidebar tabs rendered a
blank page (commit 7f10cb0). This script makes that class of mismatch
impossible: every `?v=` in the repo is rewritten atomically to the same
version.

Scope: only `?v=X.Y.Z` patterns are touched. The footer text version
in index.html (e.g. `v0.9.78`) is independent and updated by hand when
a release ships; that text is for human readers, not for browser
cache or module identity.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# Repo root is the parent of this script's directory (_scripts/).
ROOT = Path(__file__).resolve().parent.parent

# Glob patterns relative to ROOT. Order doesn't matter; results are deduped.
# Add new globs here if new frontend file types start using `?v=`.
SCAN = [
    "index.html",
    "app.js",
    "js/**/*.js",
]

# Matches any `?v=` followed by a SemVer-ish dotted triple. Tolerates future
# major bumps like `?v=1.0.0` or `?v=0.10.5` — not locked to the 0.9.x line.
PATTERN = re.compile(r"\?v=\d+\.\d+\.\d+")


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not re.fullmatch(r"\d+\.\d+\.\d+", argv[1]):
        print(__doc__, file=sys.stderr)
        provided = argv[1:] if len(argv) > 1 else "(no args)"
        print(
            f"\nUsage error: expected one arg matching X.Y.Z, got: {provided}",
            file=sys.stderr,
        )
        return 1

    target = f"?v={argv[1]}"

    files: list[Path] = []
    for spec in SCAN:
        files.extend(ROOT.glob(spec))

    total_changes = 0
    for path in sorted(set(files)):
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            # Skip binary or non-utf8 files that happened to glob-match.
            continue
        new_content, n = PATTERN.subn(target, content)
        if n == 0 or new_content == content:
            continue
        path.write_text(new_content, encoding="utf-8")
        rel = path.relative_to(ROOT)
        print(f"  {rel}: {n}")
        total_changes += n

    if total_changes == 0:
        print("No `?v=X.Y.Z` patterns found. Nothing to bump.")
        return 0

    print(f"\nBumped {total_changes} reference(s) to v={argv[1]}.")
    print("Review with `git diff`, then commit and push.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
