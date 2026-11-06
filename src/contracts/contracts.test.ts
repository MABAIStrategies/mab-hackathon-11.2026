// @vitest-environment node
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ClassifierOutputSchema,
  EvidenceSchema,
  FightStatsSchema,
  LevelUpRequestSchema,
  PlayerSchema,
  RigProbeSchema,
  SkillNodeSchema,
  type ClassifierOutput,
  type ClassifierOutputParsed,
  type Evidence,
  type EvidenceParsed,
  type FightStats,
  type FightStatsParsed,
  type LevelUpRequest,
  type LevelUpRequestParsed,
  type Player,
  type PlayerParsed,
  type RigProbe,
  type RigProbeParsed,
  type SkillNode,
  type SkillNodeParsed,
} from "./index";

const evidence: Evidence = {
  id: "ev_001",
  artifact_url: "https://github.com/MABAIStrategies/nexus-crm",
  type: "repo",
  provenance: "verified",
  skill_nodes: ["database_integrations.supabase"],
  weight: 3,
  observed_at: "2026-10-14",
  classified_by: "llm",
  model_id: "claude-sonnet-5-5",
  redacted: true,
  title: "nexus-crm",
};

describe("type ↔ schema sync", () => {
  it("parsed types are assignable to the frozen interfaces and back", () => {
    expectTypeOf<EvidenceParsed>().toMatchTypeOf<Evidence>();
    expectTypeOf<Evidence>().toMatchTypeOf<EvidenceParsed>();
    expectTypeOf<SkillNodeParsed>().toEqualTypeOf<SkillNode>();
    expectTypeOf<PlayerParsed>().toEqualTypeOf<Player>();
    expectTypeOf<FightStatsParsed>().toEqualTypeOf<FightStats>();
    expectTypeOf<ClassifierOutputParsed>().toEqualTypeOf<ClassifierOutput>();
    expectTypeOf<LevelUpRequestParsed>().toMatchTypeOf<LevelUpRequest>();
    expectTypeOf<RigProbeParsed>().toMatchTypeOf<RigProbe>();
  });
});

describe("EvidenceSchema", () => {
  it("accepts a valid llm-classified repo", () => {
    expect(EvidenceSchema.parse(evidence)).toEqual(evidence);
  });

  it("accepts an ISO datetime", () => {
    expect(EvidenceSchema.safeParse({ ...evidence, observed_at: "2026-10-14T12:00:00Z" }).success).toBe(true);
  });

  it.each([
    ["weight 4", { weight: 4 }],
    ["http artifact url", { artifact_url: "http://example.com" }],
    ["llm without model_id", { model_id: undefined }],
    ["model_id on a human classification", { classified_by: "human" }],
    ["claim that is not self_claimed", { type: "claim", artifact_url: null }],
    ["unknown field", { score: 99 }],
    ["bad date", { observed_at: "yesterday" }],
  ])("rejects %s", (_label, patch) => {
    expect(EvidenceSchema.safeParse({ ...evidence, ...patch }).success).toBe(false);
  });

  it("accepts a self-claimed claim with no url", () => {
    const claim = {
      ...evidence,
      id: "ev_k8s",
      artifact_url: null,
      type: "claim",
      provenance: "self_claimed",
      skill_nodes: ["deploy_devops.kubernetes"],
      weight: 1,
      classified_by: "rule",
      model_id: undefined,
      title: "Kubernetes (claimed)",
    };
    expect(EvidenceSchema.safeParse(claim).success).toBe(true);
  });
});

describe("other schemas", () => {
  it("SkillNode enforces tier 1–4 and the category enum", () => {
    const node = { id: "coding.ts", tree: "magic", label: "TypeScript", category: "coding", tier: 2, prereqs: [] };
    expect(SkillNodeSchema.safeParse(node).success).toBe(true);
    expect(SkillNodeSchema.safeParse({ ...node, tier: 5 }).success).toBe(false);
    expect(SkillNodeSchema.safeParse({ ...node, category: "vibes" }).success).toBe(false);
  });

  it("Player keeps ratings inside 40–99", () => {
    const player = {
      handle: "MABAIStrategies",
      name: "Mark Bockrath",
      title: "Founder & CEO, MAB AI Strategies",
      ovr: 84,
      level: 34,
      xp: 57800,
      archetype: "Vision-led Operator",
      categories: [{ category: "coding", rating: 81, band: 3, artifactCount: 6 }],
    };
    expect(PlayerSchema.safeParse(player).success).toBe(true);
    expect(PlayerSchema.safeParse({ ...player, ovr: 100 }).success).toBe(false);
    expect(
      PlayerSchema.safeParse({ ...player, categories: [{ category: "coding", rating: 39, band: 3, artifactCount: 0 }] })
        .success,
    ).toBe(false);
  });

  it("FightStats are non-negative integers", () => {
    const stats = { atk: 8, mag: 9, def: 6, spd: 7, int: 9, vit: 6, arm: 7 };
    expect(FightStatsSchema.safeParse(stats).success).toBe(true);
    expect(FightStatsSchema.safeParse({ ...stats, atk: 7.5 }).success).toBe(false);
  });

  it("LevelUpRequest needs an https url or a claim", () => {
    expect(LevelUpRequestSchema.safeParse({ url: "https://github.com/a/b" }).success).toBe(true);
    expect(LevelUpRequestSchema.safeParse({ claim: { node_id: "deploy_devops.kubernetes" } }).success).toBe(true);
    expect(LevelUpRequestSchema.safeParse({}).success).toBe(false);
    expect(LevelUpRequestSchema.safeParse({ url: "http://github.com/a/b" }).success).toBe(false);
    expect(LevelUpRequestSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
  });

  it("ClassifierOutput carries nodes and a rationale, nothing else", () => {
    expect(ClassifierOutputSchema.safeParse({ skill_nodes: ["coding.ts"], rationale: "TS repo" }).success).toBe(true);
    expect(ClassifierOutputSchema.safeParse({ skill_nodes: [], rationale: "", score: 99 }).success).toBe(false);
  });

  it("RigProbe forbids hostname and other identifying fields", () => {
    const probe = {
      cpu: { brand: "AMD Ryzen 9", cores: 16 },
      gpu: [{ model: "Radeon RX 7900 XTX", vramGb: 24 }],
      ramGb: 64,
      os: "Windows",
      probedAt: "2026-11-06",
    };
    expect(RigProbeSchema.safeParse(probe).success).toBe(true);
    expect(RigProbeSchema.safeParse({ ...probe, hostname: "Colonel_Cluster" }).success).toBe(false);
    expect(RigProbeSchema.safeParse({ ...probe, serial: "X123" }).success).toBe(false);
  });
});
