import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  mergeAbortSignals,
  openbotFetch,
  openbotFetchBinary,
  timeoutSignalAfter,
} from "../src/openbot/client.ts";
import { openbotUrl } from "../src/openbot/config.ts";
import { isAuthFailure, OpenBotError } from "../src/openbot/errors.ts";

const schema = z.object({ ok: z.boolean() });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stub(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/api/session")) throw new Error(`legacy endpoint hit: ${url}`);
    calls.push({ url, init: init ?? {} });
    return respond(url, init ?? {});
  };
  return { calls, fetchImpl };
}

test("POST sends credentials include and a JSON body with Content-Type", async () => {
  const stubbed = stub(() => jsonResponse(200, { ok: true }));
  const result = await openbotFetch(
    "/api/x",
    schema,
    {
      method: "POST",
      body: { a: 1 },
      fetchImpl: stubbed.fetchImpl,
    },
    true,
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(stubbed.calls.length, 1);
  assert.equal(stubbed.calls[0].url, `${openbotUrl}/api/x`);
  assert.equal(stubbed.calls[0].init.credentials, "include");
  assert.equal(stubbed.calls[0].init.method, "POST");
  assert.equal(new Headers(stubbed.calls[0].init.headers).get("content-type"), "application/json");
  assert.equal(stubbed.calls[0].init.body, JSON.stringify({ a: 1 }));
});

test("401 maps to authentication_required and isAuthFailure", async () => {
  const { fetchImpl } = stub(() => jsonResponse(401, { error: "Sign in first." }));
  const error = await openbotFetch("/api/me", schema, { fetchImpl }).catch((e: unknown) => e);
  assert.ok(error instanceof OpenBotError);
  assert.equal(error.code, "authentication_required");
  assert.equal(isAuthFailure(error), true);
});

test("403 maps to refused and 404 maps to not_found", async () => {
  const refused = await openbotFetch("/api/x", schema, {
    fetchImpl: stub(() => jsonResponse(403, { error: "Not allowed." })).fetchImpl,
  }).catch((e: unknown) => e);
  assert.ok(refused instanceof OpenBotError);
  assert.equal(refused.code, "refused");

  const missing = await openbotFetch("/api/x", schema, {
    fetchImpl: stub(() => jsonResponse(404, { error: "No such Bot." })).fetchImpl,
  }).catch((e: unknown) => e);
  assert.ok(missing instanceof OpenBotError);
  assert.equal(missing.code, "not_found");
});

test("503 on a write is outcome_unknown; on a read it is unavailable", async () => {
  const write = await openbotFetch(
    "/api/x",
    schema,
    {
      method: "POST",
      body: {},
      fetchImpl: stub(() => jsonResponse(503, { error: "down" })).fetchImpl,
    },
    true,
  ).catch((e: unknown) => e);
  assert.ok(write instanceof OpenBotError);
  assert.equal(write.code, "outcome_unknown");

  const read = await openbotFetch("/api/x", schema, {
    fetchImpl: stub(() => jsonResponse(503, { error: "down" })).fetchImpl,
  }).catch((e: unknown) => e);
  assert.ok(read instanceof OpenBotError);
  assert.equal(read.code, "unavailable");
});

test("200 that violates the schema is invalid_response, including non-JSON bodies", async () => {
  const bad = await openbotFetch("/api/x", schema, {
    fetchImpl: stub(() => jsonResponse(200, { nope: 1 })).fetchImpl,
  }).catch((e: unknown) => e);
  assert.ok(bad instanceof OpenBotError);
  assert.equal(bad.code, "invalid_response");

  const nonJson = await openbotFetch("/api/x", schema, {
    fetchImpl: stub(() => new Response("<html>hi</html>", { status: 200 })).fetchImpl,
  }).catch((e: unknown) => e);
  assert.ok(nonJson instanceof OpenBotError);
  assert.equal(nonJson.code, "invalid_response");
});

test("RN abort fallback: requests survive a missing AbortSignal.timeout/any", async () => {
  // RN ≤0.81 (this repo: 0.81.5/Hermes) ships neither static. sendAndCheck
  // builds them BEFORE its try/catch, so without a feature probe every OpenBot
  // call would throw TypeError before any error mapping could run.
  const savedTimeout = AbortSignal.timeout;
  const savedAny = AbortSignal.any;
  // @ts-expect-error simulating the RN runtime for the probe
  AbortSignal.timeout = undefined;
  // @ts-expect-error same
  AbortSignal.any = undefined;
  try {
    const { fetchImpl, calls } = stub(() => jsonResponse(200, { ok: true }));
    const result = await openbotFetch("/api/x", schema, { fetchImpl });
    assert.deepEqual(result, { ok: true });
    assert.ok(calls[0].init.signal instanceof AbortSignal); // a signal still rides along

    // A caller abort still classifies as an abort (not a network error) on
    // the fallback path: the merged signal follows the caller's reason.
    const controller = new AbortController();
    controller.abort();
    const error = await openbotFetch("/api/x", schema, {
      signal: controller.signal,
      fetchImpl: async () => {
        throw new DOMException("This operation was aborted", "AbortError");
      },
    }).catch((e: unknown) => e);
    assert.equal((error as Error).name, "AbortError");
  } finally {
    AbortSignal.timeout = savedTimeout;
    AbortSignal.any = savedAny;
  }
});

test("RN abort fallback helpers: timeout aborts TimeoutError-named; merge follows either source", async () => {
  const timedOut = timeoutSignalAfter(10);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(timedOut.aborted, true);
  assert.equal((timedOut.reason as Error).name, "TimeoutError");

  const caller = new AbortController();
  const merged = mergeAbortSignals([caller.signal, timeoutSignalAfter(50)]);
  caller.abort();
  assert.equal(merged.aborted, true);

  const mergedTimeout = mergeAbortSignals([new AbortController().signal, timeoutSignalAfter(5)]);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(mergedTimeout.aborted, true);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  assert.equal(mergeAbortSignals([alreadyAborted.signal]).aborted, true);
});

test("a caller's abort passes through untouched instead of becoming a network error", async () => {
  const controller = new AbortController();
  controller.abort();
  const error = await openbotFetch("/api/x", schema, {
    signal: controller.signal,
    fetchImpl: async () => {
      throw new DOMException("This operation was aborted", "AbortError");
    },
  }).catch((e: unknown) => e);
  assert.ok(error instanceof Error);
  assert.ok(!(error instanceof OpenBotError));
  assert.equal((error as Error).name, "AbortError");

  // Same classification on the binary twin, which callers cancel mid-stream.
  const binaryError = await openbotFetchBinary("/api/x", {
    fetchImpl: async () => {
      throw new DOMException("This operation was aborted", "AbortError");
    },
  }).catch((e: unknown) => e);
  assert.equal((binaryError as Error).name, "AbortError");
});
