#!/usr/bin/env python3
"""Split ocr-openbot-final.txt (final confirming OCR pass, 154 findings) into
non-overlapping module clusters for parallel repair dispatch.

Clusters follow the round-3 pattern (A/B/C by module) rebalanced to 4 waves so
writable-file ownership never overlaps between workers.

Outputs (next to this script):
- ocr-final-cluster-{a,b,c,d}.txt : finding blocks per cluster, original order
- stdout summary : per-cluster finding counts + severity distribution
"""
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

SRC = Path(__file__).parent / "ocr-openbot-final.txt"
OUT = Path(__file__).parent

CLUSTERS = {
    "a": "connectors / mail / calendar / reviewed-actions",
    "b": "deletion / notifications / activity / personal / ops",
    "c": "tasks / finance / documents / files",
    "d": "computer / agent-computer / mobile-bff / baseline / templates / app-wiring / db+drizzle / .gitmodules",
}

PREFIX_MAP = [
    ("a", ("server/src/openmuse-connectors/", "server/src/openmuse-mail/",
           "server/src/openmuse-calendar/", "server/src/openmuse-reviewed-actions/")),
    ("b", ("server/src/openmuse-deletion/", "server/src/openmuse-notifications/",
           "server/src/openmuse-activity/", "server/src/openmuse-personal/",
           "server/src/openmuse-ops/")),
    ("c", ("server/src/openmuse-tasks/", "server/src/openmuse-finance/",
           "server/src/openmuse-documents/", "server/src/openmuse-files/")),
    # everything else -> d
]

HEADER = re.compile(r"^─── (.+?):(\d+(?:-\d+)*) ───$")
SEVERITY = re.compile(r"^\[(\w+) · (\w+)\]")

def main() -> int:
    text = SRC.read_text(encoding="utf-8")
    lines = text.splitlines()
    preamble = []          # lines before first header
    findings = []          # (file, block_lines)
    cur = None
    for line in lines:
        m = HEADER.match(line)
        if m:
            if cur:
                findings.append(cur)
            cur = (m.group(1), [line])
        elif cur:
            cur[1].append(line)
        else:
            preamble.append(line)
    if cur:
        findings.append(cur)

    assigned = defaultdict(list)
    unassigned = []
    for f, block in findings:
        sev = next((SEVERITY.match(l).group(2) for l in block if SEVERITY.match(l)), "?")
        kind = next((SEVERITY.match(l).group(1) for l in block if SEVERITY.match(l)), "?")
        cluster = next((c for c, prefixes in PREFIX_MAP if f.startswith(prefixes)), "d")
        assigned[cluster].append((f, sev, kind, block))

    total = sum(len(v) for v in assigned.values())
    print(f"source findings: {len(findings)} | assigned: {total} | unassigned: {len(unassigned)}")
    if len(findings) != 154:
        print(f"WARNING: expected 154 findings, parsed {len(findings)}", file=sys.stderr)

    files_in = defaultdict(set)
    for c, items in assigned.items():
        path = OUT / f"ocr-final-cluster-{c}.txt"
        with path.open("w", encoding="utf-8") as fh:
            fh.write(f"# ocr-openbot-final split — cluster {c.upper()}: {CLUSTERS[c]}\n")
            fh.write(f"# source: ocr-openbot-final.txt ({len(items)} findings)\n")
            fh.write(f"# repo: /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base (branch v4/openbot-exec)\n\n")
            for f, sev, kind, block in items:
                fh.write("\n".join(block).rstrip() + "\n\n")
                files_in[c].add(f)
        sevs = Counter(s for _, s, _, _ in items)
        print(f"cluster {c.upper():>1}: {len(items):>3} findings | {len(files_in[c]):>2} files | "
              f"high={sevs['high']} med={sevs['medium']} low={sevs['low']} -> {path.name}")
    # ownership overlap check
    all_sets = {c: files_in[c] for c in assigned}
    cs = list(all_sets)
    for i in range(len(cs)):
        for j in range(i + 1, len(cs)):
            overlap = all_sets[cs[i]] & all_sets[cs[j]]
            if overlap:
                print(f"OVERLAP between {cs[i]} and {cs[j]}: {sorted(overlap)}", file=sys.stderr)
                return 1
    print("ownership check: no file appears in two clusters — OK")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
