import { SkillNodeSchema, type SkillNode } from "../../contracts";
import magicJson from "./magic.json";
import weaponJson from "./weapon.json";

// Fail loudly at module load if either JSON file drifts from the contract.
const NodeListSchema = SkillNodeSchema.array();

export const MAGIC_NODES: SkillNode[] = NodeListSchema.parse(magicJson);
export const WEAPON_NODES: SkillNode[] = NodeListSchema.parse(weaponJson);
export const ALL_NODES: SkillNode[] = [...MAGIC_NODES, ...WEAPON_NODES];

export const NODE_IDS: ReadonlySet<string> = new Set(ALL_NODES.map((n) => n.id));

const NODE_BY_ID: ReadonlyMap<string, SkillNode> = new Map(ALL_NODES.map((n) => [n.id, n]));

export function getNode(id: string): SkillNode | undefined {
  return NODE_BY_ID.get(id);
}
