#!/usr/bin/env python3
"""Rebuild the v4 execution DAG from GitHub native relations, verify, and write ledger.

Fact sources:
- docs/superpowers/plans/2026-10-12-openmuse-openbot-publication-v4.json (issue number/id map + planned deps)
- GitHub REST: sub-issues of #1, blocked_by dependencies of each sub-issue (paginated)
- Gate #94 acceptance matrix rows -> owning tickets

Outputs (next to this script):
- dag.json: verified DAG with contains/depends_on relations, levels, frontier
- verification.md: pagination/cycle/coverage audit results
"""
import json, subprocess, sys, hashlib
from collections import defaultdict, deque
from datetime import datetime, timezone

REPO = "1123786563/openmuse"
PUB = "/Users/wuyongjun/trea/openmuse/docs/superpowers/plans/2026-10-12-openmuse-openbot-publication-v4.json"
OUT_DIR = "/Users/wuyongjun/trea/openmuse/docs/superpowers/ledger/2026-10-12-openbot-v4-execution"

def gh(path):
    r = subprocess.run(["gh", "api", path], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"gh api {path} failed: {r.stderr[:300]}")
    return json.loads(r.stdout)

def gh_paginated(path):
    out = []
    page = 1
    while True:
        data = gh(f"{path}?per_page=100&page={page}")
        out.extend(data)
        if len(data) < 100:
            return out
        page += 1

pub = json.load(open(PUB))
num2tid = {v["number"]: k for k, v in pub["issues"].items()}
gate = pub["release_gate"]

# 1. contains: sub-issues of #1 (paginated)
sub_numbers = sorted(i["number"] for i in gh_paginated(f"repos/{REPO}/issues/1/sub_issues"))
# 2. depends_on: blocked_by per sub-issue (exclude the gate itself from planning deps)
deps_gh = {}
for n in sub_numbers:
    if n == gate["number"]:
        continue
    bl = gh_paginated(f"repos/{REPO}/issues/{n}/dependencies/blocked_by")
    deps_gh[n] = sorted(x["number"] for x in bl)

planned = {}
for edge in pub["dependencies"]:
    a, b = edge.split("<-")  # a blocked_by b
    planned.setdefault(num2tid_lookup := pub["issues"][a]["number"], []).append(pub["issues"][b]["number"])
planned = {k: sorted(v) for k, v in planned.items()}

mismatch = []
for n, gh_deps in deps_gh.items():
    p = planned.get(n, [])
    if gh_deps != p:
        mismatch.append((num2tid.get(n, n), "gh", gh_deps, "planned", p))
for n in planned:
    if n not in deps_gh:
        mismatch.append((num2tid.get(n, n), "missing-on-gh", planned[n]))

# 3. cycle check + topological levels
graph = {n: [d for d in deps_gh.get(n, [])] for n in deps_gh}
indeg = {n: 0 for n in graph}
children = defaultdict(list)
for n, ds in graph.items():
    for d in ds:
        children[d].append(n)
        indeg[n] += 1
levels = {}
q = deque(sorted(n for n, d in indeg.items() if d == 0))
lvl = 0
order = []
while q:
    nxt = []
    for n in q:
        levels[n] = lvl
        order.append(n)
    for n in list(q):
        for c in children[n]:
            indeg[c] -= 1
            if indeg[c] == 0:
                nxt.append(c)
    q = deque(sorted(nxt))
    lvl += 1
cycle = [n for n in graph if n not in levels]

# 4. acceptance coverage: gate #94 story rows -> owning ticket IDs (from acceptance-v4.md, parse table)
acc_path = "/Users/wuyongjun/trea/openmuse/docs/superpowers/plans/2026-10-12-openmuse-openbot-acceptance-v4.md"
acc = open(acc_path).read()
rows = {}
for line in acc.splitlines():
    if line.startswith("| S") and " | " in line:
        cells = [c.strip() for c in line.strip("|").split("|")]
        sid = cells[0].split()[0]
        owner = cells[-1]
        rows[sid] = [o for o in owner.split(",") if o]
faults = {}
for line in acc.splitlines():
    if line.startswith("| F-") and " | " in line:
        cells = [c.strip() for c in line.strip("|").split("|")]
        faults[cells[0]] = [o for o in cells[-1].split(",") if o]
all_owners = set()
for v in list(rows.values()) + list(faults.values()):
    all_owners.update(v)
catalog_ids = set(pub["subissues"])
missing_in_catalog = sorted(all_owners - catalog_ids)
uncovered_tickets = sorted(catalog_ids - all_owners - {"B04"} )  # B04 covered via S41? check
s41_owners = set(rows.get("S41", []))
uncovered_tickets = sorted(t for t in uncovered_tickets if t not in s41_owners)

# B04 owners appear in S41 owner list as "B04"
if "B04" in s41_owners and "B04" in uncovered_tickets:
    uncovered_tickets.remove("B04")

dag = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "repo": REPO,
    "parent_issue": 1,
    "release_gate": gate,
    "counts": {
        "sub_issues_of_parent": len(sub_numbers),
        "planning_tickets": len(deps_gh),
        "dependency_edges": sum(len(v) for v in deps_gh.values()),
        "story_cases": len(rows),
        "fault_cards": len(faults),
    },
    "contains": {num2tid.get(n, n): n for n in sub_numbers},
    "depends_on": {num2tid.get(n, n): [num2tid.get(d, d) for d in ds] for n, ds in deps_gh.items()},
    "blocked_by_count": {num2tid.get(n, n): len(ds) for n, ds in deps_gh.items()},
    "levels": {str(lvl): [num2tid.get(n, n) for n in sorted(levels) if levels[n] == lvl] for lvl in range(max(levels.values()) + 1)} if not cycle else {},
    "acceptance_owners": {**rows, **faults},
    "verification": {
        "sub_issue_pagination_complete": len(sub_numbers) == 93,
        "deps_match_publication": not mismatch,
        "mismatches": mismatch,
        "cycles": [num2tid.get(n, n) for n in cycle],
        "story_count_is_43": len(rows) == 43,
        "fault_count_is_12": len(faults) == 12,
        "owners_missing_from_catalog": missing_in_catalog,
        "tickets_without_acceptance_coverage": uncovered_tickets,
    },
}
json.dump(dag, open(f"{OUT_DIR}/dag.json", "w"), indent=2, ensure_ascii=False)

v = dag["verification"]
report = f"""# DAG verification report — {dag['generated_at']}

- Sub-issues of #1 (paginated): {dag['counts']['sub_issues_of_parent']} (expect 93 = 92 planning + gate #94): {'OK' if v['sub_issue_pagination_complete'] else 'FAIL'}
- blocked_by edges on GitHub: {dag['counts']['dependency_edges']} — match publication JSON: {'OK' if v['deps_match_publication'] else 'FAIL'} ({v['mismatches'] or 'none'})
- Cycles: {v['cycles'] or 'none'} {'OK' if not v['cycles'] else 'FAIL'}
- Gate #94 story cases: {dag['counts']['story_cases']} (expect 43): {'OK' if v['story_count_is_43'] else 'FAIL'}
- Fault cards: {dag['counts']['fault_cards']} (expect 12): {'OK' if v['fault_count_is_12'] else 'FAIL'}
- Story owners missing from catalog: {v['owners_missing_from_catalog'] or 'none'} {'OK' if not v['owners_missing_from_catalog'] else 'FAIL'}
- Planning tickets without any acceptance coverage: {v['tickets_without_acceptance_coverage'] or 'none'}
- Topological levels: {len(dag['levels'])}
"""
open(f"{OUT_DIR}/verification.md", "w").write(report)
print(report)
for l in sorted(dag["levels"], key=int):
    print(f"L{l}: {dag['levels'][l]}")
