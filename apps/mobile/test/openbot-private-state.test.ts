import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCleared,
  clearWebPrivateState,
  OPENBOT_SESSION_STORAGE_KEY,
  secureStorePrefix,
  webPrivateStorageKeys,
} from "../src/openbot/private-state.ts";

/** Minimal Storage stub (node:test has no DOM): a plain map with the Storage surface. */
function storageStub(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const store = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
  return store;
}

test("registry lists every web-private key the code actually writes (single source)", () => {
  // Built from the real I01/I03 code: the session key is the only key our
  // code persists; CopilotKit runtime/session state uses the documented
  // `copilotkit-*` pattern. Workspace snapshot, drafts and preview/viewer
  // URLs are React state cleared by remount, not storage keys.
  assert.ok(webPrivateStorageKeys.exact.includes(OPENBOT_SESSION_STORAGE_KEY));
  assert.ok(webPrivateStorageKeys.prefixes.some((p) => p === "copilotkit-"));
});

test("clearWebPrivateState removes exact keys and prefix matches in both stores", () => {
  const session = storageStub({
    [OPENBOT_SESSION_STORAGE_KEY]: '{"botId":"b1"}',
    "copilotkit-runtime-agent-1": "{}",
    "unrelated-theme": "dark",
  });
  const local = storageStub({
    "copilotkit-session-state": "{}",
    "openmuse-openbot-session-v1-draft": "keep", // prefix of the key, not the exact key
    "unrelated-locale": "zh-CN",
  });
  clearWebPrivateState({ sessionStorage: session, localStorage: local });
  assert.equal(session.getItem(OPENBOT_SESSION_STORAGE_KEY), null);
  assert.equal(session.getItem("copilotkit-runtime-agent-1"), null);
  assert.equal(local.getItem("copilotkit-session-state"), null);
  // Unrelated keys survive, including one merely sharing the key's name prefix.
  assert.equal(session.getItem("unrelated-theme"), "dark");
  assert.equal(local.getItem("openmuse-openbot-session-v1-draft"), "keep");
  assert.equal(local.getItem("unrelated-locale"), "zh-CN");
});

test("after sign-out, a second user's sign-in starts with zero registry keys", () => {
  const session = storageStub();
  const local = storageStub();
  // User A's session lands.
  session.setItem(OPENBOT_SESSION_STORAGE_KEY, '{"botId":"bot-a"}');
  local.setItem("copilotkit-thread-cache", "user A data");
  // Sign-out sequence (gate 401 path / App sign-out handler both call this).
  clearWebPrivateState({ sessionStorage: session, localStorage: local });
  assertCleared({ sessionStorage: session, localStorage: local });
  // User B signs in on the same browser: no registry key from A remains.
  const keys = [...Array(session.length)].map((_, i) => session.key(i));
  assert.ok(!keys.includes(OPENBOT_SESSION_STORAGE_KEY));
});

test("web registry covers the expo plugin jar: secureStorePrefix keys clear from web localStorage", () => {
  // auth.ts wires the same storagePrefix into expoClient's localStorage-backed
  // storage on web, so the plugin's jar (`_cookie`/`_session_data` and `.N`
  // chunks) lands under secureStorePrefix in web localStorage too — the sweep
  // must reach it there, or a previous user's session material survives a new
  // user's sign-in on the same browser.
  assert.ok(webPrivateStorageKeys.prefixes.some((p) => p === secureStorePrefix));
  const local = storageStub({
    [`${secureStorePrefix}_cookie`]: "{}",
    [`${secureStorePrefix}_session_data.0`]: "user A chunk",
    "unrelated-locale": "keep",
  });
  clearWebPrivateState({ localStorage: local });
  assertCleared({ localStorage: local });
  assert.equal(local.getItem("unrelated-locale"), "keep");
});

test("assertCleared throws while any registry key survives", () => {
  const session = storageStub({ [OPENBOT_SESSION_STORAGE_KEY]: "{}" });
  assert.throws(() => assertCleared({ sessionStorage: session }));
  clearWebPrivateState({ sessionStorage: session });
  assertCleared({ sessionStorage: session });
});
