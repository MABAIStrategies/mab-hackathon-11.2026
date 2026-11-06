// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CategorySchema, SkillNodeSchema, type Category, type SkillNode } from "../../src/contracts";
import { ALL_NODES, MAGIC_NODES, NODE_IDS, WEAPON_NODES, getNode } from "../../src/data/taxonomy";

const CATEGORIES = CategorySchema.options as readonly Category[];
const SLUG = /^[a-z0-9]+(_[a-z0-9]+)*$/;

describe("taxonomy counts (AC-1, AC-2)", () => {
  it("magic tree has 32-40 nodes, 4-6 per category, tiers 1-4", () => {
    expect(MAGIC_NODES.length).toBeGreaterThanOrEqual(32);
    expect(MAGIC_NODES.length).toBeLessThanOrEqual(40);
    for (const c of CATEGORIES) {
      const n = MAGIC_NODES.filter((x) => x.category === c).length;
      expect(n, c).toBeGreaterThanOrEqual(4);
      expect(n, c).toBeLessThanOrEqual(6);
    }
    expect(new Set(MAGIC_NODES.map((n) => n.tier))).toEqual(new Set([1, 2, 3, 4]));
    expect(MAGIC_NODES.every((n) => n.tree === "magic")).toBe(true);
  });

  it("weapon tree has 12-16 nodes with tree=weapon", () => {
    expect(WEAPON_NODES.length).toBeGreaterThanOrEqual(12);
    expect(WEAPON_NODES.length).toBeLessThanOrEqual(16);
    expect(WEAPON_NODES.every((n) => n.tree === "weapon")).toBe(true);
  });

  it("includes the required example nodes", () => {
    for (const id of [
      "agentic_frameworks.multi_agent_orchestration",
      "agentic_frameworks.mcp_servers",
      "agentic_frameworks.tool_use_loops",
      "harness_engineering.subagents_worktrees",
      "harness_engineering.evals",
      "harness_engineering.prompt_contracts",
      "database_integrations.postgres",
      "database_integrations.supabase",
      "database_integrations.neon",
      "database_integrations.vector_search",
      "deploy_devops.docker",
      "deploy_devops.vercel",
      "deploy_devops.cloud_run",
      "deploy_devops.ci_cd",
    ]) {
      expect(getNode(id)?.tree, id).toBe("magic");
    }
  });
});

describe("kubernetes node (AC-3)", () => {
  it("is a tier 3 magic deploy_devops node with docker as prereq", () => {
    const k = getNode("deploy_devops.kubernetes");
    expect(k).toBeDefined();
    expect(k?.tree).toBe("magic");
    expect(k?.category).toBe("deploy_devops");
    expect(k?.tier).toBe(3);
    expect(k?.prereqs).toEqual(["deploy_devops.docker"]);
  });
});

describe("taxonomy integrity (AC-4)", () => {
  it("ids are unique across both trees", () => {
    const ids = ALL_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(NODE_IDS.size).toBe(ids.length);
  });

  it("ids follow <category>.<slug> and the prefix equals the category", () => {
    for (const n of ALL_NODES) {
      const [prefix, slug, ...rest] = n.id.split(".");
      expect(rest, n.id).toHaveLength(0);
      expect(prefix, n.id).toBe(n.category);
      expect(slug ?? "", n.id).toMatch(SLUG);
    }
  });

  it("every prereq exists, in the same tree and category, at a lower tier", () => {
    for (const n of ALL_NODES) {
      for (const p of n.prereqs) {
        const pre = getNode(p);
        expect(pre, `${n.id} -> ${p}`).toBeDefined();
        expect(pre?.tree, `${n.id} -> ${p}`).toBe(n.tree);
        expect(pre?.category, `${n.id} -> ${p}`).toBe(n.category);
        expect(pre!.tier, `${n.id} -> ${p}`).toBeLessThan(n.tier);
      }
    }
  });

  it("has no cycles", () => {
    const state = new Map<string, 1 | 2>(); // 1 = visiting, 2 = done
    const visit = (id: string): void => {
      const s = state.get(id);
      if (s === 2) return;
      expect(s, `cycle at ${id}`).toBeUndefined();
      state.set(id, 1);
      for (const p of getNode(id)?.prereqs ?? []) visit(p);
      state.set(id, 2);
    };
    ALL_NODES.forEach((n) => visit(n.id));
  });

  it("every node validates against SkillNodeSchema", () => {
    for (const n of ALL_NODES as SkillNode[]) {
      expect(SkillNodeSchema.safeParse(n).success, n.id).toBe(true);
    }
  });
});
