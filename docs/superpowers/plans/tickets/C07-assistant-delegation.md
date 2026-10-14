# C07 — Port observable assistant delegation behavior: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD where the seams allow. Predecessors C01+T02 + P01/P02/P03 lookup seams verified+integrated.

**Goal:** The private OpenMuse Bot's runtime offers: (1) personal context tools — goal/idea/memory lookups returning EXACT records for the owner (P trio's seams consumed: this is their closure); (2) a delegation tool — the fixed prompt 'summarize this task and delegate it' results in ONE durable Task creation (T01 seam) and the reply NEVER claims completion before the Task's terminal state (observable contract: the tool result carries the task id + status; the reply references it).

**Architecture:** Task 0: cite how OpenBot registers runtime tools today (the copilot runtime's tool registry — rg the app's BotTools/computer-tools registration path in app/src + server copilot.ts's tool surface; determine SERVER-side vs CLIENT-side registration for a Bot's tools). Server-side is the goal (per- Bot grants): register three read tools `openmuse_goal_read`/`openmuse_idea_read`/`openmuse_memory_read` + `openmuse_task_delegate` bound to the CALLING owner (runtime actor → ownerUserId), consuming goalLookupFor/ideaLookupFor/memoryLookupFor (exports exist from P01/P02/P03) and the T01 create seam. Tests: tool handlers as pure functions over injected lookups (owner binding, exact-record returns, foreign-refusal, delegate creates one task with the prompt and returns {taskId,status:"queued"}); the "never claims completion" contract is asserted at the tool-result level (the result's status field is the live task status, never a fabricated succeeded). If runtime tool registration turns out CLIENT-side only, STOP after Task 0 and report (that changes the wiring decision).

**Spec:** Contracts §7 personal context + catalog C07 (S14: tool invocation creates one durable Task; reply never says complete before terminal); Issue #59.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-personal/tools.ts, server/tests/openmuse-personal-tools.test.ts; Modify server/src/agents/openmuse-template-store.ts ONLY if the tool registration needs a template grant hook (record), server/src/index.ts or copilot wiring per Task 0's finding (cite; minimal). Never touch openmuse-deletion/tasks-internals/baseline scripts (concurrent workers).

### Task 0 (facts; STOP if client-side only)

- [ ] Cite the server-side Bot tool registration seam (file:line) and how a tool handler receives the actor/owner.

### Task 1: RED — tool tests

1. goal_read: owner's goals → exact {id,title,milestones}; foreign owner's data absent; deleted excluded;
2. idea_read / memory_read: same discipline (kind/text/source; withdrawn/deleted excluded);
3. task_delegate: one task created {kind:"agent", prompt} via the T01 seam (queue offered once); result {taskId, status:"queued"} — the STATUS READ FROM THE ROW (never fabricated); a second call with the same Idempotency-Key converges (one task);
4. owner binding: every tool resolves the owner from the actor (never a parameter — a userId param is ignored/rejected).

### Task 2: GREEN

- Implement tools.ts per matrix; wire per Task 0; `bun test tests/openmuse-personal-tools.test.ts tests/openmuse-goals.test.ts tests/openmuse-ideas.test.ts tests/openmuse-memories.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 citation + wiring decision, files + shasum, test tails, S14 live note deferred; P01/P02/P03 closure statement (seams consumed). No commit.

## Failure handling

- If the runtime grants need admin-template changes, wire the MINIMAL registration and record the grant-model follow-up — never widen tool access beyond the private Bot's owner.
