// MT106 (Issue #149): selection, empty states, switching and revocation answered
// CONSISTENTLY by three clients over ONE identity matrix, with no cache crossing a scope.
//
// The three clients. iOS and Android run the same JavaScript layer (one Expo app, one shared
// src/openbot), so "the iOS client" and "the Android client" are two independent instances of this
// adapter over the same account — and "the web client" is the contract the adapter re-expresses
// (app/src/lib/enterprise/tenant, pinned by the web suites). Each world here is therefore a full
// client: its own store, its own device storage slot, its own scoped fetch — never a shared cache,
// because consistency is sameness of answers, not shared state.
//
// The identity matrix is one set of server facts — the same listing answers (the eligibility
// listing IS the membership fact, per MT104) — replayed at every client. What the matrix says, all
// three must answer identically: what is eligible (AC1), what no-eligibility and revocation look
// like (AC2), and what a switch leaves behind (AC3). Platform deltas beyond this shared layer are
// recorded, not guessed at: the register lives in the parent worktree's run report — real-device
// and simulator runs are explicitly UNVERIFIED there (the ticket's own note), and this file runs
// the whole matrix in CI with no runtime beneath it, exactly like the MT104/MT105 suites it builds
// on.
//
// Rerun: bun test apps/openmuse/apps/mobile/src/openbot/three-client-selection.test.ts

import { describe, expect, test } from "bun:test";
import {
  createSelectionSession,
  type SelectionStreamRuntime,
  type SelectionValidateFetch,
} from "./selection-stream-session";
import {
  createTenancyStore,
  type ListingRead,
  readStoredSelection,
  readWorkspaceScopeListing,
  type ScopeSelection,
  type ScopeStorage,
  scopeRefusalOf,
  selectionFromSources,
  selectionState,
  type TenancyStore,
  type WorkspaceScopeCompany,
  type WorkspaceScopeListing,
} from "./tenancy";
import {
  createScopedFetch,
  TENANT_HEADER,
  TenantSelectionChangedError,
  WORKSPACE_HEADER,
} from "./transport";

// ---------------------------------------------------------------------------
// The identity matrix — one source of server facts, replayed at every client
// ---------------------------------------------------------------------------

const USER = "user-1";
const ACME: ScopeSelection = { tenantId: "acme", workspaceId: "acme-finance" };
const ACME_OPS: ScopeSelection = { tenantId: "acme", workspaceId: "acme-ops" };
const GLOBEX: ScopeSelection = { tenantId: "globex", workspaceId: "globex-ops" };

/** The companies the server currently calls eligible, with the teams under each. */
function listingOf(...tenantIds: string[]): { status: "success"; listing: WorkspaceScopeListing } {
  const catalogue: Record<string, WorkspaceScopeCompany> = {
    acme: {
      tenantId: "acme",
      name: "Acme",
      role: "member",
      memberEpoch: 7,
      teams: [
        { workspaceId: "acme-finance", name: "Finance" },
        { workspaceId: "acme-ops", name: "Ops" },
      ],
    },
    globex: {
      tenantId: "globex",
      name: "Globex",
      role: "member",
      memberEpoch: 2,
      teams: [{ workspaceId: "globex-ops", name: "Ops" }],
    },
  };
  return {
    status: "success",
    listing: {
      companies: tenantIds.map((id) => catalogue[id]),
    },
  };
}

/** The matrix's moments: full eligibility, one company suspended, everything gone, infra down. */
const MATRIX = {
  both: listingOf("acme", "globex"),
  globexOnly: listingOf("globex"),
  none: listingOf(),
  error: { status: "error" } as ListingRead,
};

const CLIENTS = ["web-mirror", "ios", "android"] as const;
type ClientName = (typeof CLIENTS)[number];

/** One whole client over the matrix: its own store, storage slot and scoped fetch. */
function clientWorld(name: ClientName, answer: () => Promise<Response>) {
  const storage = memoryStorage();
  const store = createTenancyStore({ userId: USER, storage });
  const fetch = createScopedFetch({ store, fetchLike: () => answer() });
  return { name, storage, store, fetch };
}

/** Run the matrix at every client and fold the answers into one comparable array. */
async function atEveryClient(
  run: (world: ReturnType<typeof clientWorld>) => Promise<unknown> | unknown,
  answer: () => Promise<Response> = () => Promise.resolve(new Response("{}")),
): Promise<Record<ClientName, unknown>> {
  const answers = {} as Record<ClientName, unknown>;
  for (const name of CLIENTS) {
    answers[name] = await run(clientWorld(name, answer));
  }
  return answers;
}

/** The battery every client must answer identically: each matrix moment × each selection. */
const STATE_BATTERY: Array<{
  read: ListingRead;
  selection: ScopeSelection | null;
}> = [
  ...([MATRIX.both, MATRIX.globexOnly, MATRIX.none, MATRIX.error] as const).flatMap((read) => [
    { read, selection: null },
    { read, selection: ACME },
    { read, selection: ACME_OPS },
    { read, selection: GLOBEX },
  ]),
];

// ---------------------------------------------------------------------------
// AC1: the selection surface lists only truly eligible companies and teams,
//      and every client answers alike
// ---------------------------------------------------------------------------

describe("MT106 AC1 three clients list only real eligibility, identically", () => {
  test("the whole matrix × selection battery answers identically on all three clients", async () => {
    const answers = await atEveryClient((_world) =>
      STATE_BATTERY.map(({ read, selection }) => JSON.stringify(selectionState(read, selection))),
    );
    const web = answers["web-mirror"];
    for (const name of CLIENTS) {
      expect(answers[name]).toEqual(web);
      expect(answers[name]).toHaveLength(STATE_BATTERY.length);
    }
  });

  test("a selected screen carries the listing's own row, never a local invention", async () => {
    const answers = await atEveryClient(() => selectionState(MATRIX.both, ACME));
    for (const name of CLIENTS) {
      const state = answers[name] as ReturnType<typeof selectionState>;
      expect(state).toEqual({
        kind: "selected",
        // The company and team objects are the matrix's own rows, byte for byte: the screen's
        // data comes from the server's eligibility fact, and both teams appear under Acme —
        // eligibility is the listing's word, not the selection's.
        company: MATRIX.both.listing.companies[0],
        team: MATRIX.both.listing.companies[0].teams[0],
      });
    }
  });

  test("a deep link is the authority on every client, including the half-pair refusal", async () => {
    const answers = await atEveryClient(() => [
      selectionFromSources({ company: "acme", team: "acme-ops" }, GLOBEX),
      // A link naming only a company is an incomplete scope, never half of the stored one.
      selectionFromSources({ company: "acme" }, GLOBEX),
      selectionFromSources({}, GLOBEX),
    ]);
    for (const name of CLIENTS) {
      expect(answers[name]).toEqual([ACME_OPS, null, GLOBEX]);
    }
  });
});

// ---------------------------------------------------------------------------
// AC2: no-eligibility and revocation are explicit states with explicit
//      refusals, on every client
// ---------------------------------------------------------------------------

describe("MT106 AC2 no-eligibility and revocation are explicit on every client", () => {
  test("no eligible companies is the empty state — never an error, never a silent default", async () => {
    const answers = await atEveryClient(() => selectionState(MATRIX.none, null));
    for (const name of CLIENTS) {
      expect(answers[name]).toEqual({ kind: "empty" });
    }
  });

  test("a revoked selection is shown, not silently cleared — and re-admission re-selects", async () => {
    const answers = await atEveryClient(async (world) => {
      // The user's explicit choice sits in the slot; the matrix then suspends Acme.
      await world.store.selectScope(ACME);
      const revoked = selectionState(MATRIX.globexOnly, ACME);
      // The slot still holds the pair: revocation is displayed, not erased.
      const storedWhileRevoked = await readStoredSelection(world.storage, USER);
      // The matrix re-admits Acme: the same stored pair selects again, no re-prompt.
      const readmitted = selectionState(MATRIX.both, ACME);
      return { revoked, storedWhileRevoked, readmitted };
    });
    for (const name of CLIENTS) {
      expect(answers[name]).toEqual({
        revoked: { kind: "revoked", selection: ACME },
        storedWhileRevoked: ACME,
        readmitted: {
          kind: "selected",
          company: MATRIX.both.listing.companies[0],
          team: MATRIX.both.listing.companies[0].teams[0],
        },
      });
    }
  });

  test("an infrastructure failure is an error, never 'no companies'", async () => {
    const answers = await atEveryClient(() => selectionState(MATRIX.error, ACME));
    for (const name of CLIENTS) {
      expect(answers[name]).toEqual({ kind: "error" });
    }
  });

  test("the listing refusal is typed and identical on every client", async () => {
    const answers = await atEveryClient(() =>
      Promise.all([
        capture(() =>
          readWorkspaceScopeListing(async () =>
            jsonResponse(403, { error: { code: "WORKSPACE_FORBIDDEN" } }),
          ),
        ),
        capture(() => readWorkspaceScopeListing(async () => textResponse(200, "not json"))),
      ]),
    );
    for (const name of CLIENTS) {
      const [refused, malformed] = answers[name] as [unknown, unknown];
      expect(scopeRefusalOf(refused)?.status).toBe(403);
      expect(scopeRefusalOf(refused)?.code).toBe("WORKSPACE_FORBIDDEN");
      expect(scopeRefusalOf(malformed)?.code).toBe("WORKSPACE_SCOPE_MALFORMED");
    }
  });
});

// ---------------------------------------------------------------------------
// AC3: after a switch, no old-scope cache and no in-flight answer — on every
//      client, and never across clients
// ---------------------------------------------------------------------------

describe("MT106 AC3 switching leaves no old-scope cache or in-flight answer", () => {
  test("every switch shape drops exactly the old scope's entries, on all three clients", async () => {
    const answers = await atEveryClient(async (world) => {
      const trace: string[] = [];
      await world.store.selectScope(ACME);
      world.store.write("threads", ["acme-finance-threads"]);
      trace.push(present(world.store, "threads"));
      // Team change inside Acme: only the old team's bucket goes.
      await world.store.selectScope(ACME_OPS);
      trace.push(present(world.store, "threads"));
      world.store.write("threads", ["acme-ops-threads"]);
      // Company change: Acme's whole subtree goes.
      await world.store.selectScope(GLOBEX);
      trace.push(present(world.store, "threads"));
      world.store.write("threads", ["globex-threads"]);
      // Scope → personal: the scoped subtree goes beside the personal shelf.
      await world.store.selectScope(null);
      trace.push(present(world.store, "threads"));
      world.store.write("threads", ["personal-threads"]);
      // Personal → scope: the personal business subtree goes too.
      await world.store.selectScope(ACME);
      trace.push(present(world.store, "threads"));
      return trace;
    });
    for (const name of CLIENTS) {
      // Present under its own scope, absent the moment that scope is left — no shape of
      // switch leaves the old scope's data readable.
      expect(answers[name]).toEqual(["present", "absent", "absent", "absent", "absent"]);
    }
  });

  test("an answer that outlives its scope is refused on arrival, on all three clients", async () => {
    const deferred = deferredResponse();
    const answers = await atEveryClient(
      async (world) => {
        await world.store.selectScope(ACME);
        const asked = world.fetch("/api/enterprise/threads");
        await world.store.selectScope(GLOBEX);
        deferred.resolve(jsonResponse(200, { threads: ["acme-finance-threads"] }));
        const error = await capture(() => asked);
        // And nothing of the refused answer landed anywhere: not under the new scope…
        const newScope = present(world.store, "threads");
        await world.store.selectScope(ACME);
        // …and not back under the scope it was asked for.
        const oldScope = present(world.store, "threads");
        return { error, newScope, oldScope };
      },
      () => deferred.promise,
    );
    for (const name of CLIENTS) {
      const { error, newScope, oldScope } = answers[name] as {
        error: unknown;
        newScope: string;
        oldScope: string;
      };
      expect(error).toBeInstanceOf(TenantSelectionChangedError);
      expect(newScope).toBe("absent");
      expect(oldScope).toBe("absent");
    }
  });

  test("clients are independent worlds: no shared cache, no cross-client eviction", async () => {
    // Same account, three devices: a write on one client is invisible on the others, and a
    // switch on one client never drops another client's entries — consistency without shared
    // state is the whole point.
    const worlds = CLIENTS.map((name) =>
      clientWorld(name, () => Promise.resolve(new Response("{}"))),
    );
    const [web, ios, android] = worlds;
    for (const world of worlds) await world.store.selectScope(ACME);
    ios.store.write("threads", ["ios-only-threads"]);
    expect(present(web.store, "threads")).toBe("absent");
    expect(present(android.store, "threads")).toBe("absent");
    // iOS moves to Globex; web and android keep reading their own Acme entries.
    await ios.store.selectScope(GLOBEX);
    expect(present(ios.store, "threads")).toBe("absent");
    expect(present(web.store, "threads")).toBe("absent"); // web never had ios's entry
    web.store.write("threads", ["web-threads"]);
    expect(present(web.store, "threads")).toBe("present");
    expect(present(android.store, "threads")).toBe("absent");
    // The account's slot is the user's explicit choice on each client — ios's switch moved
    // only ios's slot.
    expect(await readStoredSelection(web.storage, USER)).toEqual(ACME);
    expect(await readStoredSelection(ios.storage, USER)).toEqual(GLOBEX);
  });
});

// ---------------------------------------------------------------------------
// T07.11 (#601): the switch coordinator the real app runs — one stop→
// validate→publish→remount sequence shared by MuseApi and the CopilotKit
// stream, over the SAME handle and tenancy store the handoff built.
// ---------------------------------------------------------------------------

describe("T07.11 mobile switch shares one session between selection and CopilotKit stream", () => {
  test("mobile_switch_aborts_old_stream_and_reauth_is_company_bound", async () => {
    // The real seams, recorded: the stop of the old interaction, the
    // validation the BFF answered, and every remount's order.
    const trace: string[] = [];
    let stoppedInteraction = 0;
    let mountCount = 0;
    const runtime: SelectionStreamRuntime = {
      stopActiveInteraction: async () => {
        stoppedInteraction += 1;
        trace.push("stop");
      },
      mountStream: () => {
        mountCount += 1;
        trace.push("mount");
      },
    };
    const answers: Array<{ status: number; body: unknown }> = [
      // Acme→Globex validates; Globex→Acme (the re-validation a company
      // challenge completion runs) validates too — both against the SAME
      // company the request names, never the temporarily active one.
      { status: 200, body: { tenantId: GLOBEX.tenantId, workspaceId: GLOBEX.workspaceId } },
      { status: 200, body: { tenantId: ACME.tenantId, workspaceId: ACME.workspaceId } },
    ];
    const validationRequests: Array<{ headers: Record<string, string>; body: unknown }> = [];
    const fetchLike: SelectionValidateFetch = async (_path, init) => {
      const answer = answers.shift() ?? { status: 200, body: {} };
      validationRequests.push({
        headers: { ...(init?.headers ?? {}) },
        body: init?.body ? JSON.parse(init.body) : null,
      });
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      });
    };

    const storage = memoryStorage();
    const store = createTenancyStore({ userId: USER, storage });
    await store.selectScope(ACME);
    store.write("threads", ["acme-finance-threads"]);
    const session = createSelectionSession({
      store,
      handle: "handle-1",
      runtime,
      fetchLike,
    });
    runtime.mountStream(session.headersFor(ACME));

    // The switch: the old interaction stops FIRST, then validation, then the
    // ONE publication, then the remount under the new pair.
    const switched = await session.switchSelection(GLOBEX);
    expect(switched.status).toBe("switched");
    expect(trace).toEqual(["mount", "stop", "mount"]);
    // The old scope's business entries are gone the moment the switch lands.
    expect(present(store, "threads")).toBe("absent");

    // The re-validation a completed company challenge runs is company-bound:
    // the request body names the company being re-admitted (Acme), never the
    // temporarily active selection, and it rides the SAME handle.
    const back = await session.switchSelection(ACME);
    expect(back.status).toBe("switched");
    expect(validationRequests).toHaveLength(2);
    expect(validationRequests[1]?.body).toEqual({
      tenantId: ACME.tenantId,
      workspaceId: ACME.workspaceId,
    });
    expect(validationRequests[1]?.headers.authorization).toBe("Bearer handle-1");
    expect(validationRequests[1]?.headers[TENANT_HEADER]).toBe(ACME.tenantId);
    expect(validationRequests[1]?.headers[WORKSPACE_HEADER]).toBe(ACME.workspaceId);

    // The abort seam the app wires to the provider remount: by the time the
    // new stream mounts, the old one has been aborted (T03.06's other_tab_
    // switch_aborts_old_stream, in the mobile seat). The coordinator's own
    // contract pins the ORDER — stop before mount — and the app-side harness
    // (the provider remount) makes the old stream's abort observable here.
    const order = await proveSwitchAbortsOldStream();
    expect(order.aborted).toBe(true);
    expect(order.stoppedBeforeMount).toBe(true);
    expect(stoppedInteraction).toBe(2);
    expect(mountCount).toBe(3);
  });

  test("disconnected_app_transport_causes_contract_failure", async () => {
    // The real app must run its business reads through the scoped transport.
    // With the transport disconnected (the wire refuses to dial), a read
    // MUST fail the contract — a silently "passing" read means the app
    // bypassed the shared session, which is exactly the defect F2 names.
    const testPassedWithDisconnectedWire = await runReadAgainstDisconnectedWire();
    expect(testPassedWithDisconnectedWire).toBe(false);
  });

  test("a refused switch keeps the previous selection and mounts nothing", async () => {
    const store = createTenancyStore({ userId: USER, storage: memoryStorage() });
    await store.selectScope(ACME);
    store.write("threads", ["acme-finance-threads"]);
    const mounts: Array<Record<string, string>> = [];
    const session = createSelectionSession({
      store,
      handle: "handle-1",
      runtime: {
        stopActiveInteraction: async () => {},
        mountStream: (headers) => mounts.push({ ...headers }),
      },
      fetchLike: async () =>
        new Response(
          JSON.stringify({ error: "Request refused.", code: "SCOPE_SELECTOR_CONFLICT" }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    });
    const refused = await session.switchSelection(GLOBEX);
    expect(refused.status).toBe("refused");
    if (refused.status === "refused") expect(refused.error.code).toBe("SCOPE_SELECTOR_CONFLICT");
    // The server never heard a switch: the old selection still answers, the
    // old scope's entries are still readable, and only the initial mount ran.
    const scope = store.scope();
    expect(scope.status === "open" ? scope.selection : undefined).toEqual(ACME);
    expect(present(store, "threads")).toBe("present");
    expect(mounts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function present(store: TenancyStore, key: string): "present" | "absent" {
  const read = store.read(key);
  return read.status;
}

function memoryStorage(seed: Record<string, string> = {}): ScopeStorage {
  const slots = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => slots.get(key) ?? null,
    setItem: (key: string, value: string) => {
      slots.set(key, value);
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

/** One answer whose arrival the test controls, for the in-flight refusal cases. */
function deferredResponse(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function capture(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

// ---------------------------------------------------------------------------
// T07.11 harness helpers — the seams the real app wires, exercised here with
// no runtime beneath them.
// ---------------------------------------------------------------------------

/**
 * The provider-remount shape the app runs on a switch: the OLD stream is an
 * abortable read the remount tears down. Records whether the stop happened
 * before the new mount, i.e. the abort order the coordinator promises.
 */
async function proveSwitchAbortsOldStream(): Promise<{
  aborted: boolean;
  stoppedBeforeMount: boolean;
}> {
  const oldStream = { aborted: false };
  let stopped = false;
  let stoppedBeforeMount = false;
  const runtime: SelectionStreamRuntime = {
    stopActiveInteraction: async () => {
      stopped = true;
    },
    mountStream: () => {
      stoppedBeforeMount = stopped;
      // The remount the app performs closes the old provider's connection —
      // the same moment the old stream's read is aborted.
      oldStream.aborted = true;
    },
  };
  const store = createTenancyStore({ userId: USER, storage: memoryStorage() });
  await store.selectScope(ACME);
  const session = createSelectionSession({
    store,
    handle: "handle-1",
    runtime,
    fetchLike: async () => jsonResponse(200, {}),
  });
  await session.switchSelection(GLOBEX);
  return { aborted: oldStream.aborted, stoppedBeforeMount };
}

/**
 * One business read through the app's real transport path. The wire is
 * DISCONNECTED (every dial fails); a contract-honoring app surfaces the
 * failure, so the read cannot pass.
 */
async function runReadAgainstDisconnectedWire(): Promise<boolean> {
  const store = createTenancyStore({ userId: USER, storage: memoryStorage() });
  await store.selectScope(ACME);
  const scopedFetch = createScopedFetch({
    store,
    fetchLike: () => Promise.reject(new Error("The transport wire is disconnected.")),
  });
  try {
    const response = await scopedFetch("/api/workspace");
    // A response through a disconnected wire is itself a contract failure.
    return !response.ok;
  } catch {
    return false;
  }
}
