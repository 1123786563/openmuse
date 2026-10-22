#!/usr/bin/env python3
"""Split ocr-openmuse-final.txt (OpenMuse-side confirming OCR pass, 57 findings,
all in apps/mobile) into non-overlapping clusters for parallel repair dispatch.

Clusters by concern (file-level ownership, no overlap):
- A session/auth/core plumbing: auth, email-signin, gate[+state], client, api, config, App.tsx, package.json
- B chat/computer/control/channels/tools
- C files/connections/private-state/calendar
- D tasks/task-view/pdf-view

Outputs: ocr-mob-final-cluster-{a..d}.txt + summary.
"""
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

SRC = Path(__file__).parent / "ocr-openmuse-final.txt"
OUT = Path(__file__).parent

CLUSTERS = {
    "a": "session/auth/core (auth, email-signin, gate+state, client, api, config, App.tsx, package.json)",
    "b": "chat/computer/control/channels/tools (chat+state, computer, control+state, channels, channel-actions, tool-cards)",
    "c": "files/connections/private-state/calendar (files, connections, private-state, calendar, calendar-view)",
    "d": "tasks/task-view/pdf-view (tasks, task-view, pdf-view)",
}

FILE_MAP = {
    "apps/mobile/src/openbot/auth.ts": "a",
    "apps/mobile/src/openbot/email-signin.tsx": "a",
    "apps/mobile/src/openbot/gate.tsx": "a",
    "apps/mobile/src/openbot/gate-state.ts": "a",
    "apps/mobile/src/openbot/client.ts": "a",
    "apps/mobile/src/openbot/api.ts": "a",
    "apps/mobile/src/openbot/config.ts": "a",
    "apps/mobile/App.tsx": "a",
    "apps/mobile/package.json": "a",
    "apps/mobile/src/openbot/chat.tsx": "b",
    "apps/mobile/src/openbot/chat-state.ts": "b",
    "apps/mobile/src/openbot/computer.tsx": "b",
    "apps/mobile/src/openbot/control.tsx": "b",
    "apps/mobile/src/openbot/control-state.ts": "b",
    "apps/mobile/src/openbot/channels.tsx": "b",
    "apps/mobile/src/openbot/channel-actions.ts": "b",
    "apps/mobile/src/openbot/tool-cards.ts": "b",
    "apps/mobile/src/openbot/files.tsx": "c",
    "apps/mobile/src/openbot/connections.tsx": "c",
    "apps/mobile/src/openbot/private-state.ts": "c",
    "apps/mobile/src/openbot/calendar.tsx": "c",
    "apps/mobile/src/openbot/calendar-view.ts": "c",
    "apps/mobile/src/openbot/tasks.tsx": "d",
    "apps/mobile/src/openbot/task-view.ts": "d",
    "apps/mobile/src/openbot/pdf-view.tsx": "d",
}

HEADER = re.compile(r"^─── (.+?):(\d+(?:-\d+)*) ───$")
SEVERITY = re.compile(r"^\[(\w+) · (\w+)\]")

def main() -> int:
    lines = SRC.read_text(encoding="utf-8").splitlines()
    findings, cur = [], None
    for line in lines:
        m = HEADER.match(line)
        if m:
            if cur: findings.append(cur)
            cur = (m.group(1), [line])
        elif cur:
            cur[1].append(line)
        # preamble ignored
    if cur: findings.append(cur)

    assigned, unknown = defaultdict(list), []
    for f, block in findings:
        sev = next((SEVERITY.match(l).group(2) for l in block if SEVERITY.match(l)), "?")
        cluster = FILE_MAP.get(f)
        if cluster is None:
            unknown.append(f)
        else:
            assigned[cluster].append((f, sev, block))

    total = sum(len(v) for v in assigned.values())
    print(f"source: {len(findings)} | assigned: {total} | unknown: {unknown or 'none'}")
    if unknown or len(findings) != 57:
        print("ABORT: mapping incomplete", file=sys.stderr)
        return 1

    files_in = defaultdict(set)
    for c, items in assigned.items():
        path = OUT / f"ocr-mob-final-cluster-{c}.txt"
        with path.open("w", encoding="utf-8") as fh:
            fh.write(f"# ocr-openmuse-final split — cluster {c.upper()}: {CLUSTERS[c]}\n")
            fh.write(f"# source: ocr-openmuse-final.txt ({len(items)} findings)\n")
            fh.write(f"# repo: /Users/wuyongjun/trea/openmuse/.worktrees/v4-base (branch v4/openbot-exec)\n\n")
            for f, sev, block in items:
                fh.write("\n".join(block).rstrip() + "\n\n")
                files_in[c].add(f)
        sevs = Counter(s for _, s, _ in items)
        print(f"cluster {c.upper()}: {len(items):>2} findings | {len(files_in[c]):>2} files | "
              f"high={sevs['high']} med={sevs['medium']} low={sevs['low']} -> {path.name}")

    cs = list(files_in)
    for i in range(len(cs)):
        for j in range(i + 1, len(cs)):
            overlap = files_in[cs[i]] & files_in[cs[j]]
            if overlap:
                print(f"OVERLAP {cs[i]}/{cs[j]}: {sorted(overlap)}", file=sys.stderr)
                return 1
    print("ownership check: no file in two clusters — OK")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
