// The single gateway for every runtime model call (MASTER_PLAN §2, AGENTS rule 4).
// Nothing else in the codebase may import an AI SDK.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import { estimateCostUSD, type ModelId, type TokenUsage } from "./llm-rates";

export const MODELS = {
  classify: "claude-sonnet-5-5",
  fast: "claude-haiku-5-5",
} as const satisfies Record<string, ModelId>;

export type Alias = keyof typeof MODELS;

export class UnknownAliasError extends Error {
  constructor(alias: string) {
    super(`Unknown model alias "${alias}". Use one of: ${Object.keys(MODELS).join(", ")}`);
    this.name = "UnknownAliasError";
  }
}
export class MissingApiKeyError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set. Set it in server env, or set LLM_MOCK=1 for tests.");
    this.name = "MissingApiKeyError";
  }
}
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}
export class StructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StructuredOutputError";
  }
}
export class TruncatedOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TruncatedOutputError";
  }
}
export class LLMRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LLMRequestError";
  }
}

export interface OutputSchema<T> {
  name: string;
  description?: string;
  /** JSON Schema for the tool input. Must describe an object. */
  jsonSchema: Record<string, unknown>;
  /** Optional validator (e.g. a zod schema's `.parse`). Throws on invalid data. */
  parse?: (value: unknown) => T;
}

export interface CompleteOptions<T> {
  alias: Alias;
  system: string;
  messages: Anthropic.MessageParam[];
  schema?: OutputSchema<T>;
  temperature?: number;
  maxTokens: number;
  /** Mock mode only: picks fixture `<alias>.<mockKey>.json`. Defaults to "default". */
  mockKey?: string;
}

export interface CompleteResult<T> {
  model: ModelId;
  text: string;
  data: T | undefined;
  usage: TokenUsage;
  costUSD: number;
  /** "max_tokens" means the text was cut off; callers decide whether partial text is usable. */
  stopReason: string | null;
}

type MessagesClient = Pick<Anthropic, "messages">;

export interface LLMDeps {
  env?: Record<string, string | undefined>;
  /** Inject a client (tests). Built from env on first live call otherwise. */
  client?: MessagesClient;
  /** Passed to the Anthropic SDK (tests use it to simulate HTTP responses). */
  fetch?: typeof fetch;
  fixturesDir?: string;
}

const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const RETRYABLE = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500;

interface MockResponse {
  text?: string;
  stopReason?: string;
  toolInput?: unknown;
  usage?: TokenUsage;
  error?: { status: number; message?: string };
}
interface MockFixture extends MockResponse {
  /** Responses served in order on successive attempts; errors with retryable status are retried. */
  sequence?: MockResponse[];
}

export function createLLM(deps: LLMDeps = {}) {
  const env = deps.env ?? process.env;
  let spend = 0;
  let client: MessagesClient | undefined = deps.client;

  const isMock = () => env.LLM_MOCK === "1";

  function getClient(): MessagesClient {
    if (client) return client;
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new MissingApiKeyError();
    client = new Anthropic({
      apiKey,
      timeout: TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
      fetch: deps.fetch,
      // AC-6: overrides ANTHROPIC_LOG so debug logging can never print prompts.
      logLevel: "off",
    });
    return client;
  }

  function capUSD(): number {
    const raw = env.BUDGET_USD_CAP;
    const cap = raw === undefined || raw.trim() === "" ? Number.NaN : Number(raw);
    return cap;
  }

  function assertBudget() {
    if (isMock()) return;
    const cap = capUSD();
    // Fail closed: no valid cap means no live calls.
    if (!Number.isFinite(cap) || cap <= 0) {
      throw new BudgetExceededError("BUDGET_USD_CAP is not set to a positive number; live LLM calls are blocked.");
    }
    if (spend >= cap) {
      throw new BudgetExceededError(`Runtime LLM spend estimate reached the cap of $${cap}.`);
    }
  }

  function resolveModel(alias: string): ModelId {
    if (!Object.hasOwn(MODELS, alias)) throw new UnknownAliasError(alias);
    return MODELS[alias as Alias];
  }

  function assertNotTruncated(schema: OutputSchema<unknown> | undefined, stopReason: string | null) {
    // A cut-off tool call can still parse; never trust structured output that hit the token limit.
    if (schema && stopReason === "max_tokens") {
      throw new TruncatedOutputError(`"${schema.name}" output hit maxTokens before finishing; raise maxTokens.`);
    }
  }

  function parseToolInput<T>(schema: OutputSchema<T>, input: unknown): T {
    if (input === undefined) throw new StructuredOutputError(`Model returned no "${schema.name}" tool call.`);
    try {
      return schema.parse ? schema.parse(input) : (input as T);
    } catch (err) {
      throw new StructuredOutputError(
        `"${schema.name}" output failed validation: ${err instanceof Error ? err.message : "invalid"}`,
      );
    }
  }

  function loadFixture(alias: Alias, key: string): MockFixture {
    const dir = deps.fixturesDir ?? env.LLM_FIXTURES_DIR ?? path.join(process.cwd(), "tests", "fixtures", "llm");
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    const file = path.join(dir, `${alias}.${safeKey}.json`);
    try {
      return JSON.parse(readFileSync(file, "utf8")) as MockFixture;
    } catch {
      throw new Error(`LLM_MOCK fixture not found or invalid: ${alias}.${safeKey}.json`);
    }
  }

  async function completeMock<T>(opts: CompleteOptions<T>, model: ModelId): Promise<CompleteResult<T>> {
    const fixture = loadFixture(opts.alias, opts.mockKey ?? "default");
    const attempts = fixture.sequence ?? [fixture];
    let response: MockResponse | undefined;
    for (let i = 0; i <= MAX_RETRIES && i < attempts.length; i++) {
      const candidate = attempts[i];
      if (!candidate) break;
      if (candidate.error) {
        if (RETRYABLE(candidate.error.status) && i < MAX_RETRIES && i + 1 < attempts.length) continue;
        throw new LLMRequestError(candidate.error.status, candidate.error.message ?? "Mock error");
      }
      response = candidate;
      break;
    }
    if (!response) throw new LLMRequestError(500, "Mock fixture produced no response");
    const usage = response.usage ?? { input_tokens: 0, output_tokens: 0 };
    const costUSD = estimateCostUSD(model, usage);
    spend += costUSD;
    const stopReason = response.stopReason ?? "end_turn";
    assertNotTruncated(opts.schema, stopReason);
    const data = opts.schema ? parseToolInput(opts.schema, response.toolInput) : undefined;
    return { model, text: response.text ?? "", data, usage, costUSD, stopReason };
  }

  async function complete<T = unknown>(opts: CompleteOptions<T>): Promise<CompleteResult<T>> {
    const model = resolveModel(opts.alias);
    if (isMock()) return completeMock(opts, model);
    assertBudget();
    const api = getClient();

    const tools = opts.schema
      ? [
          {
            name: opts.schema.name,
            description: opts.schema.description ?? `Return the result as ${opts.schema.name}.`,
            input_schema: opts.schema.jsonSchema as Anthropic.Tool.InputSchema,
          },
        ]
      : undefined;

    let response: Anthropic.Message;
    try {
      response = await api.messages.create({
        model,
        max_tokens: opts.maxTokens,
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        messages: opts.messages,
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(tools && opts.schema ? { tools, tool_choice: { type: "tool", name: opts.schema.name } } : {}),
      });
    } catch (err) {
      // Never surface request bodies or keys; status + SDK message only.
      if (err instanceof Anthropic.APIError) {
        throw new LLMRequestError(err.status ?? 500, `Claude API error ${err.status ?? ""}`.trim());
      }
      throw err;
    }

    const usage: TokenUsage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens,
    };
    const costUSD = estimateCostUSD(model, usage);
    spend += costUSD;

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const toolInput = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === opts.schema?.name,
    )?.input;
    const stopReason = response.stop_reason ?? null;
    assertNotTruncated(opts.schema, stopReason);
    const data = opts.schema ? parseToolInput(opts.schema, toolInput) : undefined;
    return { model, text, data, usage, costUSD, stopReason };
  }

  return {
    complete,
    getSpend: () => spend,
    /** Per-instance estimate only. The Anthropic Console spend limit is the hard stop. */
    resetSpend: () => {
      spend = 0;
    },
  };
}

let defaultInstance: ReturnType<typeof createLLM> | undefined;
const instance = () => (defaultInstance ??= createLLM());

export const complete = <T = unknown>(opts: CompleteOptions<T>) => instance().complete<T>(opts);
export const getSpend = () => instance().getSpend();
