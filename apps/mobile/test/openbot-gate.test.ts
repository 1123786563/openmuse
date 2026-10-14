import assert from "node:assert/strict";
import test from "node:test";
import {
  entryPhaseReducer,
  entrySequenceReducer,
  type GateState,
  initialEntrySequence,
} from "../src/openbot/gate-state.ts";
import {
  clearWebPrivateState,
  OPENBOT_SESSION_STORAGE_KEY,
  type StorageLike,
} from "../src/openbot/private-state.ts";

const checking: GateState = { phase: "checking" };
const loading: GateState = { phase: "loading" };
const signin: GateState = { phase: "signin" };

test("no local session goes to sign-in", () => {
  assert.deepEqual(entryPhaseReducer(checking, { type: "no-local-session" }), signin);
});

test("auth failure clears the session and returns to sign-in", () => {
  assert.deepEqual(entryPhaseReducer(loading, { type: "auth-failed" }), signin);
});

test("me-ok moves from checking to loading", () => {
  assert.deepEqual(entryPhaseReducer(checking, { type: "me-ok" }), loading);
});

const session = { botId: "b1", channelId: "ch1", threadId: "t1" };
const roster = [{ id: "b1" }, { id: "b2" }];

test("entrySequence happy path: provision → workspace → conversation ends ready with all three ids", () => {
  let state = entrySequenceReducer(initialEntrySequence, { type: "start" });
  assert.equal(state.phase, "provisioning");
  state = entrySequenceReducer(state, { type: "provision-ok", botId: "b1" });
  assert.equal(state.phase, "workspace");
  assert.equal(state.botId, "b1");
  state = entrySequenceReducer(state, { type: "workspace-ok", agents: roster });
  assert.equal(state.phase, "conversation");
  state = entrySequenceReducer(state, { type: "conversation-ok", session });
  assert.equal(state.phase, "ready");
  assert.equal(state.botId, "b1");
  assert.deepEqual(state.session, session);
});

test("provision 401 returns to sign-in", () => {
  const state = entrySequenceReducer(initialEntrySequence, {
    type: "failed",
    code: "authentication_required",
    message: "Sign in first.",
  });
  assert.equal(state.phase, "signin");
});

test("provision 409/5xx is a retryable error; retry restarts at provision", () => {
  // 409 arrives as invalid_input and 5xx as outcome_unknown (write semantics);
  // both must stay retryable, unlike contract drift (invalid_response).
  for (const code of ["outcome_unknown", "invalid_input"] as const) {
    let state = entrySequenceReducer(initialEntrySequence, {
      type: "failed",
      code,
      message: "冲突",
    });
    assert.equal(state.phase, "error");
    assert.equal(state.failure?.retryable, true);
    state = entrySequenceReducer(state, { type: "start" });
    assert.equal(state.phase, "provisioning");
  }
  const drift = entrySequenceReducer(initialEntrySequence, {
    type: "failed",
    code: "invalid_response",
    message: "结构不符",
  });
  assert.equal(drift.failure?.retryable, false);
});

test("workspace missing the provisioned Bot is a non-retryable data inconsistency", () => {
  let state = entrySequenceReducer(initialEntrySequence, { type: "provision-ok", botId: "b1" });
  state = entrySequenceReducer(state, { type: "workspace-ok", agents: [{ id: "b2" }] });
  assert.equal(state.phase, "error");
  assert.equal(state.failure?.retryable, false);
  assert.ok(state.failure?.message);
});

test("conversation 404 surfaces not_found", () => {
  const state = entrySequenceReducer(initialEntrySequence, {
    type: "failed",
    code: "not_found",
    message: "No such Bot.",
  });
  assert.equal(state.phase, "error");
  assert.equal(state.failure?.code, "not_found");
  assert.equal(state.failure?.message, "No such Bot.");
});

test("stored session skips provision and conversation, going straight to ready", () => {
  let state = entrySequenceReducer(initialEntrySequence, { type: "stored", session });
  assert.equal(state.phase, "workspace");
  state = entrySequenceReducer(state, { type: "workspace-ok", agents: roster });
  assert.equal(state.phase, "ready");
  assert.deepEqual(state.session, session);
});

function storageStub(initial: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

test("two sequential users: B's workspace-ok never observes A's session key", () => {
  const session = storageStub();
  // User A's entry lands and persists its session.
  let a = entrySequenceReducer(initialEntrySequence, { type: "start" });
  a = entrySequenceReducer(a, { type: "provision-ok", botId: "bot-a" });
  a = entrySequenceReducer(a, { type: "workspace-ok", agents: [{ id: "bot-a" }] });
  a = entrySequenceReducer(a, {
    type: "conversation-ok",
    session: { botId: "bot-a", channelId: "ch-a", threadId: "t-a" },
  });
  assert.equal(a.phase, "ready");
  session.setItem(OPENBOT_SESSION_STORAGE_KEY, JSON.stringify(a.session));

  // Sign-out: every web-private key clears and the flow returns to sign-in
  // (App-layer sign-out unmounts the gate; auth-failed is the reducer's twin).
  const gate = entryPhaseReducer(loading, { type: "auth-failed" });
  assert.equal(gate.phase, "signin");
  clearWebPrivateState({ sessionStorage: session });

  // User B signs in on the same browser and reaches workspace-ok: the stub
  // holds no stored session, so B provisions fresh and never sees A's key.
  assert.equal(session.getItem(OPENBOT_SESSION_STORAGE_KEY), null);
  let b = entrySequenceReducer(initialEntrySequence, { type: "start" });
  b = entrySequenceReducer(b, { type: "provision-ok", botId: "bot-b" });
  b = entrySequenceReducer(b, { type: "workspace-ok", agents: [{ id: "bot-b" }] });
  b = entrySequenceReducer(b, {
    type: "conversation-ok",
    session: { botId: "bot-b", channelId: "ch-b", threadId: "t-b" },
  });
  assert.equal(b.phase, "ready");
  assert.equal(b.session?.botId, "bot-b");
});
