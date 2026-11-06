// Budget guard and kill switch for runtime model calls (MASTER_PLAN §0 C3, §11; ENV-10).
//
// IMPORTANT: the cap enforced here is a per-instance SOFT ceiling.
//   - Spend is an in-memory estimate held by one server instance. Concurrent calls
//     (in one instance or across serverless instances) can overshoot the cap.
//   - The estimate resets to $0 on every cold start. There is deliberately no
//     persistent billing DB (ENV-10 NG-1).
// The Anthropic Console monthly spend limit (ENV-07) is the HARD stop.
import { createHash, timingSafeEqual } from "node:crypto";

export type Env = Record<string, string | undefined>;

/** "warn" = at least 80% of the cap is spent; "exhausted" = at least 100%. */
export type BudgetStatus = "ok" | "warn" | "exhausted";

export const WARN_FRACTION = 0.8;

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/** Thrown when LLM_KILL=1. API handlers map it to HTTP 503 with `body` (see `pausedResponse`). */
export class PausedError extends Error {
  readonly status = 503 as const;
  readonly body = { error: "paused" } as const;
  constructor() {
    super("Model calls are paused (LLM_KILL=1).");
    this.name = "PausedError";
  }
}

export class MockInProductionError extends Error {
  constructor() {
    super("LLM_MOCK=1 is refused in production (VERCEL_ENV or NODE_ENV is 'production'). Unset LLM_MOCK.");
    this.name = "MockInProductionError";
  }
}

/** Parsed BUDGET_USD_CAP, or null when missing/invalid/non-positive (fail closed for live calls). */
export function parseCap(env: Env): number | null {
  const raw = env.BUDGET_USD_CAP;
  if (raw === undefined || raw.trim() === "") return null;
  const cap = Number(raw);
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}

/** Read at call time (never import time) so flipping the env takes effect immediately. */
export function isKilled(env: Env): boolean {
  return env.LLM_KILL === "1";
}

export function assertNotKilled(env: Env): void {
  if (isKilled(env)) throw new PausedError();
}

export function isProduction(env: Env): boolean {
  return env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
}

export function assertMockAllowed(env: Env): void {
  if (env.LLM_MOCK === "1" && isProduction(env)) throw new MockInProductionError();
}

export function budgetStatus(spend: number, cap: number): BudgetStatus {
  if (spend >= cap) return "exhausted";
  if (spend >= cap * WARN_FRACTION) return "warn";
  return "ok";
}

/**
 * Blocks a live call. Fails closed: a missing or invalid cap blocks everything, and
 * "exhausted" (>= 100%) blocks. "warn" (>= 80%) still runs; the caller flags it.
 */
export function assertBudget(env: Env, spend: number): BudgetStatus {
  const cap = parseCap(env);
  if (cap === null) {
    throw new BudgetExceededError(
      "BUDGET_USD_CAP is not set to a positive number; live LLM calls are blocked.",
    );
  }
  const status = budgetStatus(spend, cap);
  if (status === "exhausted") {
    throw new BudgetExceededError(`Runtime LLM spend estimate reached the cap of $${cap}.`);
  }
  return status;
}

export function pausedResponse(): Response {
  return Response.json({ error: "paused" }, { status: 503, headers: { "cache-control": "no-store" } });
}

/** Constant-time string compare: hashes both sides so lengths are equal and nothing leaks. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export interface SpendState {
  spend: number;
}

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * GET /api/admin/spend logic. Requires header `x-admin-token` equal to env ADMIN_TOKEN.
 * Fails closed: 401 when the header is missing or wrong, and when ADMIN_TOKEN is unset or empty.
 * The token is never echoed.
 */
export function handleSpendRequest(request: Request, env: Env, state: SpendState): Response {
  const expected = env.ADMIN_TOKEN;
  const given = request.headers.get("x-admin-token");
  // Compare even when one side is missing so timing does not reveal which check failed.
  const ok = safeEqual(given ?? "", expected ?? "") && !!expected && given !== null;
  if (!ok) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  if (request.method !== "GET") {
    return Response.json(
      { error: "method not allowed" },
      { status: 405, headers: { ...NO_STORE, allow: "GET" } },
    );
  }
  return Response.json(
    { spend: state.spend, cap: parseCap(env), killed: isKilled(env) },
    { headers: NO_STORE },
  );
}
