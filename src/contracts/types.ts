// FROZEN — changes need a new Linear issue filed by Mark (MASTER_PLAN.md §7, AGENTS.md rule 3).
// Shared types every lane imports. Runtime validation lives in ./schemas.ts.

export type Provenance = "verified" | "corroborated" | "self_claimed";
export type EvidenceType = "repo" | "deploy" | "cert" | "attestation" | "rig_probe" | "claim";

export interface Evidence {
  id: string;
  artifact_url: string | null;
  type: EvidenceType;
  provenance: Provenance;
  /** Taxonomy node ids only. */
  skill_nodes: string[];
  /** Set by rules, never by an LLM. */
  weight: 1 | 2 | 3 | 5;
  /** ISO date or datetime. */
  observed_at: string;
  classified_by: "llm" | "human" | "rule";
  /** Set when classified_by === "llm". */
  model_id?: string;
  redacted: boolean;
  title: string;
}

export type Category =
  | "ai_fluency"
  | "agentic_frameworks"
  | "harness_engineering"
  | "coding"
  | "safety_compliance"
  | "cybersecurity"
  | "database_integrations"
  | "deploy_devops";

export interface SkillNode {
  id: string;
  tree: "magic" | "weapon";
  label: string;
  category: Category;
  tier: 1 | 2 | 3 | 4;
  prereqs: string[];
}

export interface CategoryScore {
  category: Category;
  rating: number;
  band: number;
  artifactCount: number;
}

export interface Player {
  handle: string;
  name: string;
  title: string;
  ovr: number;
  level: number;
  xp: number;
  archetype: string;
  categories: CategoryScore[];
}

export interface FightStats {
  atk: number;
  mag: number;
  def: number;
  spd: number;
  int: number;
  vit: number;
  arm: number;
}

/** POST /api/levelup request. At least one of `url` or `claim` is required. */
export interface LevelUpRequest {
  url?: string;
  claim?: { node_id: string };
}

/** POST /api/levelup response. Scores are recomputed server-side by the engine. */
export interface LevelUpResponse {
  evidence: Evidence;
  player: Player;
}

/** What the LLM classifier may return: node ids and a reason. Never scores. */
export interface ClassifierOutput {
  skill_nodes: string[];
  rationale: string;
}

/** Hardware probe output. No hostname, username, serials, UUIDs, MACs or IPs. */
export interface RigProbe {
  cpu: { brand: string; cores: number };
  gpu: { model: string; vramGb: number | null }[];
  ramGb: number;
  os: string;
  probedAt: string;
  hostname?: never;
}
