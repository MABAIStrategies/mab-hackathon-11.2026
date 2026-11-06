// FROZEN — changes need a new Linear issue filed by Mark (MASTER_PLAN.md §7, AGENTS.md rule 3).
// Zod schemas mirroring ./types.ts. contracts.test.ts proves the two stay in sync.
import { z } from "zod";

const isoDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const nonEmpty = z.string().min(1);
const httpsUrl = z.url({ protocol: /^https$/ });

export const ProvenanceSchema = z.enum(["verified", "corroborated", "self_claimed"]);
export const EvidenceTypeSchema = z.enum(["repo", "deploy", "cert", "attestation", "rig_probe", "claim"]);
export const CategorySchema = z.enum([
  "ai_fluency",
  "agentic_frameworks",
  "harness_engineering",
  "coding",
  "safety_compliance",
  "cybersecurity",
  "database_integrations",
  "deploy_devops",
]);

export const EvidenceSchema = z
  .object({
    id: nonEmpty,
    artifact_url: httpsUrl.nullable(),
    type: EvidenceTypeSchema,
    provenance: ProvenanceSchema,
    skill_nodes: z.array(nonEmpty),
    weight: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5)]),
    observed_at: isoDate,
    classified_by: z.enum(["llm", "human", "rule"]),
    model_id: nonEmpty.optional(),
    redacted: z.boolean(),
    title: nonEmpty,
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.classified_by === "llm" && !e.model_id) {
      ctx.addIssue({ code: "custom", path: ["model_id"], message: "model_id is required when classified_by is llm" });
    }
    if (e.classified_by !== "llm" && e.model_id !== undefined) {
      ctx.addIssue({ code: "custom", path: ["model_id"], message: "model_id is only set when classified_by is llm" });
    }
    if (e.type === "claim" && e.provenance !== "self_claimed") {
      ctx.addIssue({ code: "custom", path: ["provenance"], message: "a claim is always self_claimed" });
    }
  });

export const SkillNodeSchema = z
  .object({
    id: nonEmpty,
    tree: z.enum(["magic", "weapon"]),
    label: nonEmpty,
    category: CategorySchema,
    tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    prereqs: z.array(nonEmpty),
  })
  .strict();

export const CategoryScoreSchema = z
  .object({
    category: CategorySchema,
    rating: z.number().int().min(40).max(99),
    band: z.number().int().min(0),
    artifactCount: z.number().int().min(0),
  })
  .strict();

export const PlayerSchema = z
  .object({
    handle: nonEmpty,
    name: nonEmpty,
    title: z.string(),
    ovr: z.number().int().min(40).max(99),
    level: z.number().int().min(1),
    xp: z.number().min(0),
    archetype: z.string(),
    categories: z.array(CategoryScoreSchema),
  })
  .strict();

const stat = z.number().int().min(0);
export const FightStatsSchema = z
  .object({ atk: stat, mag: stat, def: stat, spd: stat, int: stat, vit: stat, arm: stat })
  .strict();

export const LevelUpRequestSchema = z
  .object({
    url: httpsUrl.optional(),
    claim: z.object({ node_id: nonEmpty }).strict().optional(),
  })
  .strict()
  .refine((r) => r.url !== undefined || r.claim !== undefined, {
    message: "Provide a url or a claim",
  });

export const LevelUpResponseSchema = z.object({ evidence: EvidenceSchema, player: PlayerSchema }).strict();

export const ClassifierOutputSchema = z
  .object({ skill_nodes: z.array(nonEmpty), rationale: z.string() })
  .strict();

export const RigProbeSchema = z
  .object({
    cpu: z.object({ brand: nonEmpty, cores: z.number().int().min(1) }).strict(),
    gpu: z.array(z.object({ model: nonEmpty, vramGb: z.number().min(0).nullable() }).strict()),
    ramGb: z.number().min(0),
    os: nonEmpty,
    probedAt: isoDate,
  })
  .strict(); // .strict() rejects hostname and any other identifying field.

export type ProvenanceParsed = z.infer<typeof ProvenanceSchema>;
export type EvidenceTypeParsed = z.infer<typeof EvidenceTypeSchema>;
export type CategoryParsed = z.infer<typeof CategorySchema>;
export type EvidenceParsed = z.infer<typeof EvidenceSchema>;
export type SkillNodeParsed = z.infer<typeof SkillNodeSchema>;
export type CategoryScoreParsed = z.infer<typeof CategoryScoreSchema>;
export type PlayerParsed = z.infer<typeof PlayerSchema>;
export type FightStatsParsed = z.infer<typeof FightStatsSchema>;
export type LevelUpRequestParsed = z.infer<typeof LevelUpRequestSchema>;
export type LevelUpResponseParsed = z.infer<typeof LevelUpResponseSchema>;
export type ClassifierOutputParsed = z.infer<typeof ClassifierOutputSchema>;
export type RigProbeParsed = z.infer<typeof RigProbeSchema>;
