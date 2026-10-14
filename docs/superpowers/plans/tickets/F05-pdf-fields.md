# F05 — Inspect supported PDF fields: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: single-bounded-ticket plan; one agent context, TDD. Predecessor F02 verified+integrated. Porting source: OpenMuse's existing PDF inspection logic (READ-ONLY prior art).

**Goal:** `POST /api/mobile/openmuse-files/:id/inspect` returns the PDF's form fields: text and checkbox fields `supported` with exact names; dropdown/radio/option-list `unsupported` with {fieldName, reason}; encrypted/XFA/malformed refuse with DISTINCT errors; >500-page PDFs refuse; the original file is untouched.

**Architecture:** New module `server/src/openmuse-documents/`: `inspect.ts` (pure field classification over an extracted field list — the extraction seam `extractPdfFields(buffer)` injectable; production impl via the SAME pdf library OpenMuse uses — Task 0: read OpenMuse's apps/server PDF code + apps/mobile PdfReader prior art READ-ONLY at /Users/wuyongjun/trea/openmuse/.worktrees/v4-base (rg pdf-form/AcroForm) and record the library + version to add as a dependency; if the extraction needs the pdf-lib/pdfjs dependency added to server/package.json, add it + lockfile (noted)); `routes.ts` (requireUser; loads the file via openmuse-files store getOwnedFile + byte store read (one export addition allowed); 30 MiB guard inherits F02 limits — PDF ≤10 MiB re-asserted; 500-page count via the extractor's page count). Mount via the files module's existing sub-app (extend openmuse-files/routes.ts? NO — separate sub-app mounted in the same conditional: app.ts ONE tail param `openMuseDocuments` OR extend the files mount — choose minimal: add the routes INSIDE openmuse-files/routes.ts is wrong ownership; create the sub-app and mount it beside files in app.ts with ONE tail param; ready.test.ts offset).

**Spec:** Contracts §5 PDF (text/checkbox supported; dropdown/radio/list unsupported with reason; encrypted/XFA/malformed distinct; >500 pages refuse; original unchanged); catalog F05; Issue #44. Fixture P-1: text `person.name`, checkbox `consent`, dropdown `region`.

## Global Constraints

- Work ONLY in /Users/wuyongjun/trea/OpenBot/.worktrees/v4-base (READ-ONLY access to the OpenMuse worktree for prior art). NO commits.
- Owned files: Create server/src/openmuse-documents/{inspect.ts,routes.ts}, server/tests/openmuse-documents.test.ts; Modify server/package.json (+pdf lib per Task 0) + bun.lock, server/src/app.ts (ONE tail param + mount + ready.test.ts offset), server/src/index.ts (import+arg); openmuse-files store ONE export addition (byte-read for owner file, noted). Never touch openmuse-reviewed-actions/openmuse-tasks (concurrent workers).

### Task 0

- [ ] Cite OpenMuse's PDF prior art (library, field-type detection, page counting) from /Users/wuyongjun/trea/openmuse/.worktrees/v4-base (rg -l "AcroForm|pdf" apps/server/src apps/mobile/src | head, read the relevant file(s)); record the chosen library + version.

### Task 1: RED — tests

1. classification over an extracted-field fixture (pure seam): text → supported {name:"person.name", type:"text", maxChars?}; checkbox → supported {name:"consent", type:"checkbox"}; dropdown/radio/list → unsupported {fieldName:"region", reason} with per-type reasons;
2. encrypted → distinct error kind pdf_encrypted; XFA → pdf_xfa; malformed → pdf_malformed (the extractor seam throws typed errors the routes map to 400/422 — choose + record);
3. >500 pages → refusal naming the page count;
4. route: owner-scoped (foreign 404); reads bytes through the files store (server-derived path — never client input); original file untouched (byte store write count zero);
5. §9 disabled owner 403.

### Task 2: GREEN

- Implement per matrix + wiring + dependency (lockfile diff noted); `bun test tests/openmuse-documents.test.ts tests/openmuse-files.test.ts tests/ready.test.ts` PASS; typecheck + biome clean.

### Task 3: Checkpoint

- Report: Task 0 citations + library choice, lockfile delta summary, migration SQL none (no tables), files + shasum, test tails, S25 live fixture deferred note. No commit.

## Failure handling

- If no pure-JS extraction library in the OpenMuse prior art is viable server-side, port the classification over a minimal extractor interface with a documented production adapter TODO and STOP to ask before adding heavyweight deps.
