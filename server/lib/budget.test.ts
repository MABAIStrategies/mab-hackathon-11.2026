// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../api/admin/spend";
import {
  MockInProductionError,
  PausedError,
  assertBudget,
  budgetStatus,
  handleSpendRequest,
  isKilled,
  parseCap,
  pausedResponse,
  safeEqual,
} from "./budget";
import { BudgetExceededError, LLMRequestError, createLLM } from "./llm";

const FAKE_KEY = "test-key-not-real";
const baseOpts = { system: "sys", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 64 };
const liveEnv = { ANTHROPIC_API_KEY: FAKE_KEY, BUDGET_USD_CAP: "10" };

function messageBody(usage = { input_tokens: 1000, output_tokens: 100 }) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text: "ok" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { ...usage, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}
const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function fixturesDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "budget-fixtures-"));
  writeFileSync(path.join(dir, "fast.default.json"), JSON.stringify({ text: "hello" }));
  return dir;
}

afterEach(() => vi.unstubAllEnvs());

describe("budgetStatus thresholds (AC-3)", () => {
  it("is ok below 80%, warn from 80%, exhausted from 100%", () => {
    expect(budgetStatus(0, 10)).toBe("ok");
    expect(budgetStatus(7.99, 10)).toBe("ok");
    expect(budgetStatus(8, 10)).toBe("warn");
    expect(budgetStatus(9.99, 10)).toBe("warn");
    expect(budgetStatus(10, 10)).toBe("exhausted");
    expect(budgetStatus(25, 10)).toBe("exhausted");
  });

  it("assertBudget blocks at 100%, allows and flags at 80%, and fails closed without a cap", () => {
    expect(assertBudget({ BUDGET_USD_CAP: "10" }, 5)).toBe("ok");
    expect(assertBudget({ BUDGET_USD_CAP: "10" }, 8)).toBe("warn");
    expect(() => assertBudget({ BUDGET_USD_CAP: "10" }, 10)).toThrow(BudgetExceededError);
    for (const bad of [undefined, "", "  ", "abc", "0", "-5"]) {
      expect(() => assertBudget({ BUDGET_USD_CAP: bad }, 0)).toThrow(BudgetExceededError);
    }
  });

  it("flags warn on the result at 80% but still runs; blocks the next call at 100%", async () => {
    // Sonnet: $2 per 1M input tokens. Cap $10: first call $8 (warn), second call $2 (exhausted), third blocked.
    const create = vi.fn().mockResolvedValue(messageBody({ input_tokens: 4_000_000, output_tokens: 0 }));
    const llm = createLLM({ env: liveEnv, client: { messages: { create } } as never });
    const first = await llm.complete({ ...baseOpts, alias: "classify" });
    expect(first.budgetStatus).toBe("warn");
    create.mockResolvedValue(messageBody({ input_tokens: 1_000_000, output_tokens: 0 }));
    const second = await llm.complete({ ...baseOpts, alias: "classify" }); // ran, because it started at 80%
    expect(second.budgetStatus).toBe("exhausted");
    await expect(llm.complete({ ...baseOpts, alias: "classify" })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("still reports ok below 80%", async () => {
    const create = vi.fn().mockResolvedValue(messageBody());
    const llm = createLLM({ env: liveEnv, client: { messages: { create } } as never });
    expect((await llm.complete({ ...baseOpts, alias: "fast" })).budgetStatus).toBe("ok");
  });
});

describe("kill switch (AC-2, AC-7)", () => {
  it("LLM_KILL=1 throws PausedError (503 paused) before any network call", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const llm = createLLM({ env: { ...liveEnv, LLM_KILL: "1" }, fetch: fetchMock });
    const err = await llm.complete({ ...baseOpts, alias: "fast" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PausedError);
    expect((err as PausedError).status).toBe(503);
    expect((err as PausedError).body).toEqual({ error: "paused" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("LLM_KILL=1 also blocks mock mode, before fixture access", async () => {
    const llm = createLLM({ env: { LLM_MOCK: "1", LLM_KILL: "1" }, fixturesDir: "/nonexistent-dir" });
    await expect(llm.complete({ ...baseOpts, alias: "fast" })).rejects.toBeInstanceOf(PausedError);
  });

  it("is read at call time, so flipping the env takes effect without a new instance", async () => {
    const env: Record<string, string | undefined> = { LLM_MOCK: "1" };
    const llm = createLLM({ env, fixturesDir: fixturesDir() });
    expect((await llm.complete({ ...baseOpts, alias: "fast" })).text).toBe("hello");
    env.LLM_KILL = "1";
    await expect(llm.complete({ ...baseOpts, alias: "fast" })).rejects.toBeInstanceOf(PausedError);
    env.LLM_KILL = "";
    expect((await llm.complete({ ...baseOpts, alias: "fast" })).text).toBe("hello");
  });

  it("pausedResponse is HTTP 503 { error: 'paused' }", async () => {
    const res = pausedResponse();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "paused" });
  });

  it("isKilled only for exactly '1'", () => {
    expect(isKilled({ LLM_KILL: "1" })).toBe(true);
    expect(isKilled({ LLM_KILL: "0" })).toBe(false);
    expect(isKilled({})).toBe(false);
  });
});

describe("LLM_MOCK in production (AC-5)", () => {
  it.each([{ VERCEL_ENV: "production" }, { NODE_ENV: "production" }])("is refused when %o", async (prod) => {
    const llm = createLLM({ env: { LLM_MOCK: "1", ...prod }, fixturesDir: fixturesDir() });
    const err = await llm.complete({ ...baseOpts, alias: "fast" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MockInProductionError);
    expect(String((err as Error).message)).toContain("LLM_MOCK");
  });

  it("is allowed in preview and test", async () => {
    for (const env of [{ VERCEL_ENV: "preview" }, { NODE_ENV: "test" }, {}]) {
      const llm = createLLM({ env: { LLM_MOCK: "1", ...env }, fixturesDir: fixturesDir() });
      expect((await llm.complete({ ...baseOpts, alias: "fast" })).text).toBe("hello");
    }
  });
});

describe("per-call deadline (AC-4)", () => {
  it("a huge retry-after cannot stall a call past the deadline", async () => {
    const err429 = { type: "error", error: { type: "rate_limit_error", message: "slow down" } };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse(429, err429, { "retry-after": "3600" }));
    const llm = createLLM({ env: liveEnv, fetch: fetchMock, deadlineMs: 150 });
    const started = Date.now();
    const failure = await llm.complete({ ...baseOpts, alias: "fast" }).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(failure).toBeInstanceOf(LLMRequestError);
    expect((failure as LLMRequestError).status).toBe(504);
    expect(fetchMock).toHaveBeenCalledTimes(1); // aborted during the backoff sleep; no second attempt
  });

  it("bounds a fetch that hangs forever", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => {}));
    const llm = createLLM({ env: liveEnv, fetch: fetchMock, deadlineMs: 100 });
    const failure = await llm.complete({ ...baseOpts, alias: "fast" }).catch((e: unknown) => e);
    expect((failure as LLMRequestError).status).toBe(504);
  });

  it("bounds an injected client that ignores the signal, and passes the signal to it", async () => {
    const create = vi.fn().mockImplementation(() => new Promise(() => {}));
    const llm = createLLM({ env: liveEnv, client: { messages: { create } } as never, deadlineMs: 80 });
    const failure = await llm.complete({ ...baseOpts, alias: "fast" }).catch((e: unknown) => e);
    expect((failure as LLMRequestError).status).toBe(504);
    expect(create.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not interfere with a normal fast success", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, messageBody()));
    const llm = createLLM({ env: liveEnv, fetch: fetchMock, deadlineMs: 5_000 });
    expect((await llm.complete({ ...baseOpts, alias: "fast" })).text).toBe("ok");
  });
});

describe("GET /api/admin/spend (AC-1)", () => {
  const url = "http://localhost/api/admin/spend";
  const req = (token?: string, method = "GET") =>
    new Request(url, { method, headers: token === undefined ? {} : { "x-admin-token": token } });

  it("returns { spend, cap, killed } for the right token", async () => {
    const env = { ADMIN_TOKEN: "s3cret-admin", BUDGET_USD_CAP: "12.5", LLM_KILL: "1" };
    const res = handleSpendRequest(req("s3cret-admin"), env, { spend: 3.25 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ spend: 3.25, cap: 12.5, killed: true });
  });

  it("reports cap null and killed false when unset", async () => {
    const res = handleSpendRequest(req("t"), { ADMIN_TOKEN: "t" }, { spend: 0 });
    expect(await res.json()).toEqual({ spend: 0, cap: null, killed: false });
  });

  it("401s on missing or wrong token without echoing it", async () => {
    const env = { ADMIN_TOKEN: "s3cret-admin" };
    for (const token of [undefined, "", "wrong", "s3cret-admin2", "s3cret-admi"]) {
      const res = handleSpendRequest(req(token), env, { spend: 1 });
      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).not.toContain("s3cret-admin");
      if (token) expect(text).not.toContain(token);
    }
  });

  it("fails closed (401) when ADMIN_TOKEN is unset or empty, even for an empty header", async () => {
    for (const adminToken of [undefined, ""]) {
      for (const token of [undefined, "", "anything"]) {
        expect(handleSpendRequest(req(token), { ADMIN_TOKEN: adminToken }, { spend: 1 }).status).toBe(401);
      }
    }
  });

  it("rejects non-GET methods after auth", () => {
    expect(handleSpendRequest(req("t", "POST"), { ADMIN_TOKEN: "t" }, { spend: 0 }).status).toBe(405);
    expect(handleSpendRequest(req(undefined, "POST"), { ADMIN_TOKEN: "t" }, { spend: 0 }).status).toBe(401);
  });

  it("the exported GET handler reads process.env at call time", async () => {
    vi.stubEnv("ADMIN_TOKEN", "route-token");
    vi.stubEnv("BUDGET_USD_CAP", "7");
    vi.stubEnv("LLM_KILL", "");
    expect((await GET(req("nope"))).status).toBe(401);
    const ok = await GET(req("route-token"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ cap: 7, killed: false });
    vi.stubEnv("LLM_KILL", "1");
    expect(await (await GET(req("route-token"))).json()).toMatchObject({ killed: true });
    vi.stubEnv("ADMIN_TOKEN", "");
    expect((await GET(req("route-token"))).status).toBe(401);
  });

  it("safeEqual compares equal and unequal strings of any length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("parseCap", () => {
  it("parses positive numbers only", () => {
    expect(parseCap({ BUDGET_USD_CAP: "5" })).toBe(5);
    expect(parseCap({ BUDGET_USD_CAP: "0" })).toBeNull();
    expect(parseCap({})).toBeNull();
  });
});
