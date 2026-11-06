/**
 * Scoring engine. Pure, deterministic, no I/O, no randomness, no LLM.
 * The only place scores come from (MASTER_PLAN.md section 7).
 *
 * Orchestrator rulings applied here:
 * 1. Types: `taxonomy` is `readonly SkillNode[]`, `now` is a `Date`, `base` is
 *    `Pick<Player, "handle" | "name" | "title" | "archetype">`. `buildPlayer`
 *    returns a full `Player` with `categories` in CATEGORY_ORDER.
 * 2. Node-to-category: ids map to categories via `taxonomy`; unknown ids are
 *    ignored. An item counts once per category it touches (not once per node);
 *    an item spanning two categories counts in each.
 * 3. Months = max(0, (now - observed_at) / (1000*60*60*24*30.4375)); a future
 *    date clamps to 0 months (decay 1). `observed_at` is parsed with `new Date(str)`.
 * 4. artifactCount = items touching the category with prov > 0 (self-claims
 *    are not artifacts).
 * 5. total_xp has no decay and sums each item once overall (weight*prov*100),
 *    counting only items that touch at least one known category.
 * 6. Rounding is Math.round (half-up) everywhere; clamp after rounding.
 * 7. nodeState = best provenance among items listing the node
 *    (verified > corroborated > self_claimed), else "locked".
 * 8. nodeRecency = max decay among items with prov > 0 that list the node, else 0.
 * 9. Empty evidence: ratings 40, band 8, OVR 40, xp 0, level 1.
 * 10. `./index.ts` re-exports the public API plus the pure helpers.
 */
import type { Category, CategoryScore, Evidence, Player, Provenance, SkillNode } from "../contracts";

export type NodeState = "locked" | "self_claimed" | "corroborated" | "verified";

export const CATEGORY_ORDER: readonly Category[] = [
  "ai_fluency",
  "agentic_frameworks",
  "harness_engineering",
  "coding",
  "safety_compliance",
  "cybersecurity",
  "database_integrations",
  "deploy_devops",
];

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.4375;

/** Provenance multiplier: verified 1.0, corroborated 0.6, self_claimed 0. */
export function provFactor(p: Provenance): number {
  switch (p) {
    case "verified":
      return 1;
    case "corroborated":
      return 0.6;
    default:
      return 0;
  }
}

/** decay = 0.5^(months/18). Negative months clamp to 0 (decay 1). */
export function decayFactor(months: number): number {
  const m = Number.isFinite(months) ? Math.max(0, months) : 0;
  return Math.pow(0.5, m / 18);
}

/** rating = round(40 + 59*(1 - e^(-raw/12))), clamped to 40..99. */
export function ratingFromRaw(raw: number): number {
  const r = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  const v = Math.round(40 + 59 * (1 - Math.exp(-r / 12)));
  return Math.min(99, Math.max(40, v));
}

/** band = round(8 / sqrt(artifactCount + 1)). */
export function bandFor(artifactCount: number): number {
  const n = Number.isFinite(artifactCount) ? Math.max(0, artifactCount) : 0;
  return Math.round(8 / Math.sqrt(n + 1));
}

/** level = floor(sqrt(total_xp / 50)) + 1. */
export function levelFor(totalXp: number): number {
  const xp = Number.isFinite(totalXp) ? Math.max(0, totalXp) : 0;
  return Math.floor(Math.sqrt(xp / 50)) + 1;
}

/** Months between `observedAt` and `now`, clamped to >= 0. Bad dates give 0. */
function monthsSince(observedAt: string, now: Date): number {
  const t = new Date(observedAt).getTime();
  const n = now.getTime();
  if (!Number.isFinite(t) || !Number.isFinite(n)) return 0;
  return Math.max(0, (n - t) / MS_PER_MONTH);
}

function categoryMap(taxonomy: readonly SkillNode[]): Map<string, Category> {
  const m = new Map<string, Category>();
  for (const n of taxonomy) m.set(n.id, n.category);
  return m;
}

function categoriesOf(ev: Evidence, cats: Map<string, Category>): Set<Category> {
  const out = new Set<Category>();
  for (const id of ev.skill_nodes ?? []) {
    const c = cats.get(id);
    if (c) out.add(c);
  }
  return out;
}

/** Score all 8 categories, returned in CATEGORY_ORDER. */
export function scoreCategories(
  evidence: readonly Evidence[],
  taxonomy: readonly SkillNode[],
  now: Date,
): CategoryScore[] {
  const cats = categoryMap(taxonomy);
  const raw = new Map<Category, number>();
  const count = new Map<Category, number>();
  for (const c of CATEGORY_ORDER) {
    raw.set(c, 0);
    count.set(c, 0);
  }
  for (const ev of evidence) {
    const prov = provFactor(ev.provenance);
    const contribution = ev.weight * prov * decayFactor(monthsSince(ev.observed_at, now));
    for (const c of categoriesOf(ev, cats)) {
      raw.set(c, (raw.get(c) ?? 0) + contribution);
      if (prov > 0) count.set(c, (count.get(c) ?? 0) + 1);
    }
  }
  return CATEGORY_ORDER.map((category) => {
    const artifactCount = count.get(category) ?? 0;
    return {
      category,
      rating: ratingFromRaw(raw.get(category) ?? 0),
      band: bandFor(artifactCount),
      artifactCount,
    };
  });
}

/** Build a full Player from base identity fields plus evidence. */
export function buildPlayer(
  base: Pick<Player, "handle" | "name" | "title" | "archetype">,
  evidence: readonly Evidence[],
  taxonomy: readonly SkillNode[],
  now: Date,
): Player {
  const categories = scoreCategories(evidence, taxonomy, now);
  const cats = categoryMap(taxonomy);
  let xp = 0;
  for (const ev of evidence) {
    if (categoriesOf(ev, cats).size === 0) continue;
    xp += ev.weight * provFactor(ev.provenance) * 100;
  }
  const ovr = Math.min(
    99,
    Math.max(40, Math.round(categories.reduce((s, c) => s + c.rating, 0) / categories.length)),
  );
  return {
    handle: base.handle,
    name: base.name,
    title: base.title,
    archetype: base.archetype,
    ovr,
    level: levelFor(xp),
    xp,
    categories,
  };
}

const PROV_RANK: Record<Provenance, number> = { self_claimed: 1, corroborated: 2, verified: 3 };

/** Best provenance among evidence listing the node; "locked" if none. */
export function nodeState(nodeId: string, evidence: readonly Evidence[]): NodeState {
  let best: Provenance | null = null;
  for (const ev of evidence) {
    if (!(ev.skill_nodes ?? []).includes(nodeId)) continue;
    if (best === null || PROV_RANK[ev.provenance] > PROV_RANK[best]) best = ev.provenance;
  }
  return best ?? "locked";
}

/** Max decay (0..1) across prov > 0 evidence listing the node; 0 if none. */
export function nodeRecency(nodeId: string, evidence: readonly Evidence[], now: Date): number {
  let best = 0;
  for (const ev of evidence) {
    if (provFactor(ev.provenance) <= 0) continue;
    if (!(ev.skill_nodes ?? []).includes(nodeId)) continue;
    best = Math.max(best, decayFactor(monthsSince(ev.observed_at, now)));
  }
  return best;
}
