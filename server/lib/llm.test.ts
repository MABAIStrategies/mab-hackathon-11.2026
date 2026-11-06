// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BudgetExceededError,
  LLMRequestError,
  MissingApiKeyError,
  StructuredOutputError,
  TruncatedOutputError,
  UnknownAliasError,
  createLLM,
  type Alias,
} from "./llm";
import { estimateCostUSD } from "./llm-rates";

const FAKE_KEY = "test-key-not-real";
const baseOpts = { system: "sys", messages: [{ role: "user" as const, content: "hi" }], maxTokens: 64 };

function messageBody(
  content: unknown[],
  usage = { input_tokens: 1000, output_tokens: 100 },
  stop_reason = "end_turn",
) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { ...usage, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fixturesDir(files: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(tmpdir(), "llm-fixtures-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), JSON.stringify(body));
  return dir;
}

describe("llm client", () => {
  it("throws on an unknown alias", async () => {
    const llm = createLLM({ env: { LLM_MOCK: "1" } });
    await expect(llm.complete({ ...baseOpts, alias: "nope" as Alias })).rejects.toBeInstanceOf(UnknownAliasError);
  });

  it("throws a clear error when the key is missing (live mode)", async () => {
    const llm = createLLM({ env: { BUDGET_USD_CAP: "10" } });
    await expect(llm.complete({ ...baseOpts, alias: "fast" })).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("fails closed when BUDGET_USD_CAP is missing", async () => {
    const llm = createLLM({ env: { ANTHROPIC_API_KEY: FAKE_KEY } });
    await expect(llm.complete({ ...baseOpts, alias: "fast" })).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("retries a 429 then succeeds, using the SDK's backoff", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, { "retry-after-ms": "1" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, messageBody([{ type: "text", text: "ok" }])));
    const llm = createLLM({ env: { ANTHROPIC_API_KEY: FAKE_KEY, BUDGET_USD_CAP: "10" }, fetch: fetchMock });
    const res = await llm.complete({ ...baseOpts, alias: "classify" });
    expect(res.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 2 retries and surfaces only the status", async () => {
    const err = { type: "error", error: { type: "overloaded_error", message: "busy" } };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse(529, err, { "retry-after-ms": "1" }));
    const llm = createLLM({ env: { ANTHROPIC_API_KEY: FAKE_KEY, BUDGET_USD_CAP: "10" }, fetch: fetchMock });
    const failure = await llm.complete({ ...baseOpts, alias: "fast" }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(LLMRequestError);
    expect((failure as LLMRequestError).status).toBe(529);
    expect(String((failure as Error).message)).not.toContain(FAKE_KEY);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sends a cached system prompt and forces the schema tool", async () => {
    const create = vi.fn().mockResolvedValue(
      messageBody([{ type: "tool_use", id: "t1", name: "classify_result", input: { skill_nodes: ["coding.ts"] } }]),
    );
    const llm = createLLM({
      env: { ANTHROPIC_API_KEY: FAKE_KEY, BUDGET_USD_CAP: "10" },
      client: { messages: { create } } as never,
    });
    const res = await llm.complete<{ skill_nodes: string[] }>({
      ...baseOpts,
      alias: "classify",
      temperature: 0,
      schema: {
        name: "classify_result",
        jsonSchema: { type: "object", properties: { skill_nodes: { type: "array", items: { type: "string" } } } },
        parse: (v) => {
          const nodes = (v as { skill_nodes?: unknown }).skill_nodes;
          if (!Array.isArray(nodes)) throw new Error("skill_nodes missing");
          return { skill_nodes: nodes as string[] };
        },
      },
    });
    expect(res.data).toEqual({ skill_nodes: ["coding.ts"] });
    const req = create.mock.calls[0]?.[0];
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.temperature).toBe(0);
    expect(req.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(req.tool_choice).toEqual({ type: "tool", name: "classify_result" });
  });

  it("rejects structured output that fails validation", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(messageBody([{ type: "tool_use", id: "t1", name: "out", input: { wrong: true } }]));
    const llm = createLLM({
      env: { ANTHROPIC_API_KEY: FAKE_KEY, BUDGET_USD_CAP: "10" },
      client: { messages: { create } } as never,
    });
    await expect(
      llm.complete({
        ...baseOpts,
        alias: "fast",
        schema: {
          name: "out",
          jsonSchema: { type: "object" },
          parse: () => {
            throw new Error("bad shape");
          },
        },
      }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
  });

  it("exposes max_tokens truncation on text and rejects truncated structured output", async () => {
    const usage = { input_tokens: 10, output_tokens: 64 };
    const create = vi
      .fn()
      .mockResolvedValueOnce(messageBody([{ type: "text", text: "partial" }], usage, "max_tokens"))
      .mockResolvedValueOnce(
        messageBody([{ type: "tool_use", id: "t1", name: "out", input: { ok: true } }], usage, "max_tokens"),
      );
    const llm = createLLM({
      env: { ANTHROPIC_API_KEY: FAKE_KEY, BUDGET_USD_CAP: "10" },
      client: { messages: { create } } as never,
    });
    const text = await llm.complete({ ...baseOpts, alias: "fast" });
    expect(text.stopReason).toBe("max_tokens");
    await expect(
      llm.complete({ ...baseOpts, alias: "fast", schema: { name: "out", jsonSchema: { type: "object" } } }),
    ).rejects.toBeInstanceOf(TruncatedOutputError);
    expect(llm.getSpend()).toBeGreaterThan(0); // truncated calls still cost money
  });

  it("blocks calls once the spend estimate reaches the cap", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(messageBody([{ type: "text", text: "x" }], { input_tokens: 1_000_000, output_tokens: 0 }));
    const llm = createLLM({
      env: { ANTHROPIC_API_KEY: FAKE_KEY, BUDGET_USD_CAP: "1" },
      client: { messages: { create } } as never,
    });
    await llm.complete({ ...baseOpts, alias: "classify" }); // 1M Sonnet input tokens = $2
    expect(llm.getSpend()).toBeCloseTo(2, 6);
    await expect(llm.complete({ ...baseOpts, alias: "classify" })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("serves fixtures in LLM_MOCK mode without a key or network", async () => {
    const dir = fixturesDir({
      "fast.default.json": { text: "hello", usage: { input_tokens: 10, output_tokens: 5 } },
      "classify.repo.json": { toolInput: { skill_nodes: ["db.supabase"] } },
    });
    const llm = createLLM({ env: { LLM_MOCK: "1" }, fixturesDir: dir });
    expect((await llm.complete({ ...baseOpts, alias: "fast" })).text).toBe("hello");
    const res = await llm.complete<{ skill_nodes: string[] }>({
      ...baseOpts,
      alias: "classify",
      mockKey: "repo",
      schema: { name: "r", jsonSchema: { type: "object" } },
    });
    expect(res.data?.skill_nodes).toEqual(["db.supabase"]);
  });

  it("replays a mock 429-then-success sequence", async () => {
    const dir = fixturesDir({
      "fast.retry.json": { sequence: [{ error: { status: 429 } }, { text: "after retry" }] },
    });
    const llm = createLLM({ env: { LLM_MOCK: "1" }, fixturesDir: dir });
    expect((await llm.complete({ ...baseOpts, alias: "fast", mockKey: "retry" })).text).toBe("after retry");
  });

  it("never logs prompts, even with ANTHROPIC_LOG=debug", async () => {
    const prev = process.env.ANTHROPIC_LOG;
    process.env.ANTHROPIC_LOG = "debug";
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, messageBody([{ type: "text", text: "ok" }])));
      const llm = createLLM({ env: { ANTHROPIC_API_KEY: FAKE_KEY, BUDGET_USD_CAP: "10" }, fetch: fetchMock });
      await llm.complete({ ...baseOpts, alias: "fast", system: "SECRET-SYSTEM-PROMPT" });
      for (const spy of spies) {
        for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain("SECRET-SYSTEM-PROMPT");
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
      if (prev === undefined) delete process.env.ANTHROPIC_LOG;
      else process.env.ANTHROPIC_LOG = prev;
    }
  });

  it("never writes the key to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(401, { type: "error", error: {} }));
    const llm = createLLM({ env: { ANTHROPIC_API_KEY: FAKE_KEY, BUDGET_USD_CAP: "10" }, fetch: fetchMock });
    await llm.complete({ ...baseOpts, alias: "fast" }).catch(() => {});
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(FAKE_KEY);
      spy.mockRestore();
    }
  });
});

describe("rates", () => {
  it("prices Haiku 5.5 on the higher tier above 100K prompt tokens", () => {
    const small = estimateCostUSD("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 0 });
    const large = estimateCostUSD("claude-haiku-5-5", { input_tokens: 100_001, output_tokens: 0 });
    expect(small).toBeCloseTo(0.01, 8);
    expect(large).toBeCloseTo(100_001 * 0.5e-6, 8);
  });

  it("counts cache reads and writes", () => {
    const cost = estimateCostUSD("claude-sonnet-5-5", {
      input_tokens: 0,
      output_tokens: 1_000_000,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(10 + 2.5 + 0.1, 6);
  });
});
