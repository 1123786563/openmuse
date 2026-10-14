# F06 — Generate a filled PDF copy: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor F05 verified+integrated (openmuse-documents + pdf-lib in place).

**Goal:** `POST /api/mobile/openmuse-files/:id/fill {values}` creates a NEW file version with the requested field values: the Ava/consent fixture fills text `person.name="Ava"` and checkbox `consent=true`; unsupported/unknown/wrong-type input refuses (no version created); the ORIGINAL's sha256 stays unchanged; the derived version records parent + values; deterministic in the §5 sense (same source + values → same semantic field values + provenance, not byte-identical serialization).

**Architecture:** Extend `openmuse-documents`: `fill.ts` — pure `validateFill(fields, values)` (supported∩known∩type-checked → typed map; violations → distinct errors) + `applyFill(buffer, fields, values)` via pdf-lib (injectable pdf adapter for tests where useful); routes: `POST /:id/fill` (owner-scoped; reads original bytes; writes the derived version through the files store's version-append seam — Task 0: F01's store has version creation (byte store put + version row) — cite/reuse, one export allowed; derived version records parentVersionId + values in metadata).

**Spec:** Contracts §5 PDF (fill creates a new version; original unchanged; unknown name or wrong type refuses before writing; deterministic semantics); catalog F06; Issue #45.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base. NO commits.
- Owned files: Create server/src/openmuse-documents/fill.ts; Modify server/src/openmuse-documents/{inspect.ts (share the extractor seam),routes.ts}, server/tests/openmuse-documents.test.ts; openmuse-files store ONE version-append export (noted). NO app.ts/index.ts/migrations (version row shape suffices — record). Never touch openmuse-reviewed-actions/openmuse-finance (concurrent workers).

### Task 1: RED — tests

1. validateFill: Ava/consent fixture passes; unknown field name → distinct refusal; wrong type (boolean into text; string into checkbox; >10,000-char text) → distinct refusals; unsupported field → refusal naming it;
2. applyFill (fake pdf adapter): the typed map is applied; output buffer recorded;
3. route happy: derived version row {parentVersionId, values} + byte store written ONCE under a server-derived key; ORIGINAL byte-store path untouched + original sha256 re-read unchanged;
4. invalid input → NO version row, NO byte write (counts);
5. owner-scoped (foreign 404); tombstoned → 404; §9 disabled owner 403;
6. determinism (semantic): same source+values twice → both versions' recorded values equal (byte-equality NOT asserted — contract §5's definition, recorded).

### Task 2: GREEN

- Implement per matrix; `bun test tests/openmuse-documents.test.ts tests/openmuse-files.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: version-append reuse citation, files + shasum, test tails, S26 live fixture deferred note. No commit.

## Failure handling

- If pdf-lib's checkbox/text setting needs form-flattening choices, keep fields live (no flatten) and record the choice.
