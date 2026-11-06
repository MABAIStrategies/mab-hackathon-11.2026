# MyPl(ai)yer — Master Plan v2 (Claude edition)

Repo: `MABAIStrategies/mab-hackathon-11.2026` · Linear team: `MAB` (Mabaistrategies) · Project: **MyPl(ai)yer** (P-MAB-12)

> One goal, one end state: a deployed web app where a person's resume is a living MyPl(ai)yer — Player Card, Magic Skill Tree (software), Weapon Skill Tree (hardware), Overall ratings, and Fight Mode — every number traceable to evidence, every score computed by deterministic math, and a live "Level Up" that accepts real evidence and rejects fake claims. Built by Claude agents in Claude Code; runtime AI on the Claude API. Packaged with a pitch kit for Mark's students.

---

## 0. Hard constraints (read first)

| # | Constraint | Consequence |
|---|---|---|
| C1 | **No Meta models, APIs, tools, or platforms** anywhere: build or runtime. | Harness = **Claude Code + Finn-loop skills**. Runtime model calls = **Claude API** through `server/lib/llm.ts`. |
| C2 | **One gateway for runtime AI.** | Only `server/lib/llm.ts` imports `@anthropic-ai/sdk`. Key = `ANTHROPIC_API_KEY`, server env only. |
| C3 | **Cost control.** | `BUDGET_USD_CAP` (Mark sets the value) + `LLM_KILL=1` kill switch + `LLM_MOCK=1` for every automated test. The hard stop is a spend limit set in the Anthropic Console. |
| C4 | **Claude runs the factory; Mark keeps the human-only work.** | Mark delegated queue approval and merges to Claude (2026-11-05). Claude merges only PRs that pass CI and a fresh-context review. Mark owns `model:human` issues (keys, evidence, recording) and can veto anything by removing `agent-ready` or reverting. |
| C5 | **No wall clock.** | Milestone gates (§3) replace the hackathon timer. Zero-shot is not guaranteed by any plan; convergence comes from tests + a 2-round fix cap + a human gate. |
| C6 | **Biometric data stays on the device.** | Mannerism capture runs pose estimation in the browser. Video and frames never upload. |
| C7 | Standing rules. | Never commit secrets. No force push. No direct commits to `main`. Deny any path matching `**/verizon*` / `**/Verizon*`. |

---

## 1. Definition of done (the single finalized output)

1. Production URL on Vercel loads in < 3 s and shows Mark's Player Card.
2. Every number on the card, trees, and Overall panel opens an evidence drawer listing artifacts with provenance tier.
3. Magic Skill Tree renders in 3D (with a 2D fallback); node states reflect provenance and recency.
4. Weapon Skill Tree renders from `rig.json` + deploy evidence.
5. Overall shows 8 category ratings with ± band and artifact count.
6. **Live Level Up:** pasting a real public repo/deploy URL unlocks the right node(s) and recomputes scores. Self-claiming **Kubernetes** with no evidence stays gray at 0 points.
7. **Fight Mode:** two players battle; the outcome comes from a seeded deterministic sim; the LLM only narrates.
8. CI green: typecheck, lint, unit, e2e (mocked LLM), gitleaks, SAST.
9. No secrets in the client bundle. PII redaction runs before every LLM call.
10. 3-minute pitch video + one-pager published for students.

---

## 2. Model registry (Claude only)

**Build time: Claude Code subagents** (`.claude/agents/*.md`, each with a `model:` line, created by ENV-06)

| Linear label | Model | Used for |
|---|---|---|
| `model:opus` | Claude Opus 5.5 | Contracts, security-sensitive builds, integrator; reviewer for all P0 and `model:opus` issues |
| `model:sonnet` | Claude Sonnet 5.5 | Default builder; reviewer for P1/P2 |
| `model:haiku` | Claude Haiku 5.5 | Scaffolding, config, fixtures, docs, mechanical fixes |
| `model:human` | Mark | Never claimed by agents |

**Runtime: `server/lib/llm.ts` aliases**

| Alias | Model ID | Used for |
|---|---|---|
| `classify` | `claude-sonnet-5-5` | Level Up classifier. Temperature 0, structured output. |
| `fast` | `claude-haiku-5-5` | Scout drafts, archetype names, fight narration, mannerism profile wording |

There is no runtime image or video model:
- Avatars are procedural SVG (FGT-07).
- Mannerism capture uses in-browser pose estimation (MNR-02).

**Model switching (deterministic, from the plan)**
- Every Linear issue carries exactly one `model:*` label.
- The builder dispatches the matching subagent.
- The reviewer is **never weaker** than the builder.
- **Usage pressure override:** if build usage limits get tight, P1/P2 reviews drop to Sonnet and P2 issues pause.

---

## 3. Milestones & gates (replaces the clock)

| Milestone | Issues | Gate to pass |
|---|---|---|
| **M0 · Environment & permissions** | ENV-01..10 | CI green on the scaffold; the permissions negative test is refused |
| **M1 · Contracts frozen** | COR-01..06 | COR-01 merged, so contracts are read-only; engine golden tests pass |
| **M2 · Parallel lanes** (≤ 6 builders, isolated worktrees) | CRD, MTR, WPN, OVR, LVL, SCT, FGT, SEC, QA-02 | Every P0 lane issue merged |
| **M3 · Integration** | INT-01, QA-01, QA-03 | E2E golden path green on a preview |
| **M4 · Release** | INT-02 | Prod live smoke passes |
| **M5 · Pitch kit** | DEMO-01, DEMO-02 | Video + one-pager published |

P2 issues (MNR-*, CRD-05, WPN-04, MTR-06, FGT-06, FGT-07) start only after M4, or in idle builder slots.

The watchdog (OPS-01) runs as a scheduled task every 30 minutes while builder loops run. It reports:
- issues stuck In Progress for more than 60 minutes
- red CI on `main`
- runtime spend vs. cap

---

## 4. Lane ownership map (zero overlap)

An issue may **edit only** the paths of its lane. Anything outside them is read-only. Contracts are frozen after COR-01 merges; changing them requires a new Linear issue filed by Mark.

| Lane label | Owns (edit) | Notes |
|---|---|---|
| `lane:env` | `.github/`, `.claude/`, `.githooks/pre-push`, `vercel.json`, `.gitignore`, `.env.example`, `package.json`, lockfile, root configs, `AGENTS.md`, `server/lib/llm*.ts`, `server/lib/budget.ts` | Only ENV issues touch dependencies. Other lanes request deps via a Blocked comment. |
| `lane:core` | `src/contracts/`, `src/engine/`, `src/data/taxonomy/`, `tests/engine/` | Contracts frozen after COR-01. |
| `lane:integrator` | `src/app/`, `src/styles/`, `src/main.tsx` | INT + COR-05 only. |
| `lane:card` | `src/features/card/`, `src/features/shared/evidence/`, `api/card/`, `server/card/` | Owns the shared EvidenceDrawer; others import it. |
| `lane:magic` | `src/features/magic-tree/`, `src/features/tree-engine/` | Owns the tree-engine primitives. Weapon lane imports, never edits. |
| `lane:weapon` | `src/features/weapon-tree/`, `tools/rig-probe/`, `src/data/rig.json` | |
| `lane:overall` | `src/features/overall/` | |
| `lane:levelup` | `api/levelup/`, `src/features/levelup/`, `server/levelup/` | |
| `lane:scout` | `api/scout/`, `server/scout/`, `src/features/scout/` | |
| `lane:fight` | `src/features/fight/`, `server/fight/`, `api/fight/` | |
| `lane:mannerism` | `src/features/mannerism/`, `api/mannerism/`, `server/mannerism/`, `public/models/pose/` | P2 only |
| `lane:security` | `server/lib/redact/`, `server/lib/guard/`, `security/`, `.semgrep/`, `.githooks/pre-commit` | Sensitive; human merge. |
| `lane:qa` | `tests/e2e/`, `tests/fixtures/llm/`, `playwright.config.ts` | |
| `lane:data` | `src/data/evidence.json`, `src/data/players/` | Seed data |
| `lane:demo` | `docs/demo/` | |
| `lane:ops` | `docs/ops/`, scheduled tasks | |

`server/lib/llm.ts` (the LLM client) is owned by ENV-08. Everyone imports it; no one else edits it.

---

## 5. Governance, merge policy, loop rules (Finn-loop extended)

**Contract rules**
- If it is not in the Linear issue, it does not exist.
- One issue = one branch = one PR. Branch: `feat/<ref-lower>-kebab`.
- Acceptance criteria (`AC-n`) are observable. Non-goals (`NG-n`) are binding.

**Approval gate (delegated)**
- Claude applies `agent-ready` after re-reading each contract against this plan. Mark can pull any issue by removing the label.
- Agents claim only issues that are `agent-ready`, not `Blocked`, and have all blockers Done.

**Build → review → fix loop**
1. The builder implements and runs the issue's **Test** command locally.
2. The builder opens a PR with the test output pasted in.
3. A **fresh-context reviewer** checks the head SHA against the AC/NG list and CI, then posts `loop-approved` or `loop-changes-requested`.
4. The builder fixes **only** must-fix findings.
5. Maximum **2 fix rounds**. After that, label `loop-stuck`, comment the blocker, and stop.
6. If CI fails, the builder reads the failing job log, fixes only within owned paths, and re-pushes. CI failures count toward the 2-round cap.

**Merge policy (Claude merges)**

| Rule | Detail |
|---|---|
| Who | Claude (orchestrator) squash-merges. Builders never merge their own PR. |
| When | `loop-approved` at the current head SHA + all required checks green + no conflicts. |
| Extra care | PRs labeled `needs-human-review` (security, env, CI, `api/`, `server/lib/`) are reviewed by `reviewer-opus` and merged only with a written risk note in the PR. |
| Undo | Any bad merge is reverted with a PR, never a force push. |

**Blocked state:** blocked issues carry the `Blocked` label (existing team label) plus exactly one concrete question in a comment. Mark answers, then removes the label.

---

## 6. Environment & permissions bootstrap (M0)

Machine: Mark's Windows build box (Git Bash), or a Claude Code cloud session on the same repo.

### 6.1 Repo + protection (ENV-01, human)

The repo already exists as `MABAIStrategies/mab-hackathon-11.2026` (public; nothing secret is ever committed).

```bash
# Git Bash — repo root: ~/Projects/mab-hackathon-11.2026
gh label create loop-approved --color 0E8A16
gh label create loop-changes-requested --color D93F0B
gh label create needs-human-review --color FBCA04
gh label create loop-stuck --color B60205
```

Branch protection on `main` (GitHub → Settings → Branches):
- require PR
- require status check `ci` (add after ENV-05 creates it)
- no force push
- no deletions

### 6.2 Claude Code + Finn-loop (ENV-02, human)

```bash
# Git Bash — repo root: ~/Projects/mab-hackathon-11.2026
claude --version     # must be 2.1.71 or newer (/loop)
gh auth status       # must show write access to the repo
```

Then, inside Claude Code at the repo root, paste the install prompt from the Finn-loop README (https://github.com/finna/Finn-loop). Use **MAB** as the Linear team key. `AGENTS.md` extends Finn-loop with:
- lanes
- model labels
- the 2-round fix cap

### 6.3 Permissions state (ENV-06): intent the config must enforce

Config files:
- `.claude/settings.json`
- `.githooks/pre-push`

ENV-06 verifies exact syntax against current Claude Code docs.

**Allow**
- read/write inside the repo working tree and its worktrees
- `pnpm`, `node`, `git` (no push to `main`), `gh pr *`, `npx playwright`, `npx vitest`

**Deny**
- `git push --force`, `git push origin main`, `rm -rf` outside the repo
- reading `~/.ssh`, any `.env*` except `.env.example`
- any path matching `**/verizon*`

**Network**
- Use the package registries, `github.com`, `api.github.com`, `api.linear.app`, `api.anthropic.com`, `*.vercel.app`.

**MCP / connectors**
- Linear and GitHub only.

**Subagents** (`.claude/agents/`)

| Name | Model |
|---|---|
| `builder-opus` | Opus |
| `builder-sonnet` | Sonnet |
| `builder-haiku` | Haiku |
| `reviewer-opus` | Opus |
| `reviewer-sonnet` | Sonnet |

Each subagent reads `AGENTS.md` first.

**Merge**
- Only the orchestrator merges, under the §5 merge policy. Builders and reviewers never merge.

### 6.4 Runtime secrets (ENV-07, human)

Vercel project env, server-side only:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Claude API key |
| `BUDGET_USD_CAP` | your monthly runtime cap |
| `GITHUB_HANDLE` | `MABAIStrategies` |
| `ADMIN_TOKEN` | a long random string |

Also set a monthly spend limit in the Anthropic Console. That is the hard stop, because the in-app meter is a per-instance estimate.

Never use the `VITE_` prefix for secrets. Every PR gets a preview deploy.

---

## 7. Contracts (COR-01 freezes these)

```ts
// src/contracts/types.ts — frozen after COR-01
export type Provenance = "verified" | "corroborated" | "self_claimed";
export type EvidenceType = "repo" | "deploy" | "cert" | "attestation" | "rig_probe" | "claim";
export interface Evidence {
  id: string; artifact_url: string | null; type: EvidenceType; provenance: Provenance;
  skill_nodes: string[];            // taxonomy node ids only
  weight: 1 | 2 | 3 | 5;            // set by rules, never by an LLM
  observed_at: string;              // ISO date
  classified_by: "llm" | "human" | "rule";
  model_id?: string;                // set when classified_by === "llm"
  redacted: boolean; title: string;
}
export type Category = "ai_fluency" | "agentic_frameworks" | "harness_engineering" | "coding"
  | "safety_compliance" | "cybersecurity" | "database_integrations" | "deploy_devops";
export interface SkillNode { id: string; tree: "magic" | "weapon"; label: string;
  category: Category; tier: 1 | 2 | 3 | 4; prereqs: string[]; }
export interface CategoryScore { category: Category; rating: number; band: number; artifactCount: number; }
export interface Player { handle: string; name: string; title: string; ovr: number; level: number;
  xp: number; archetype: string; categories: CategoryScore[]; }
export interface FightStats { atk: number; mag: number; def: number; spd: number; int: number; vit: number; arm: number; }
```

**Scoring formula** (`src/engine/scoring.ts`, pure, no I/O)

`raw(category) = Σ weight × prov × decay`, summed over the evidence whose nodes map to that category.

| Term | Definition |
|---|---|
| `prov` | verified 1.0 · corroborated 0.6 · self_claimed 0 |
| `decay` | `0.5 ^ (months_since_observed / 18)` |
| `rating` | `40 + 59 × (1 − e^(−raw / 12))`, rounded, clamped to 40–99 |
| `band` | `round(8 / √(artifactCount + 1))` |
| `OVR` | `round(mean of the 8 category ratings)` (equal weights v1), an integer 40–99 |
| `level` | `floor(√(total_xp / 50)) + 1`, where `total_xp = Σ weight × prov × 100` |

**Fight stat map** (`src/features/fight/stats.ts`)

| Stat | Source category (`round(rating ÷ 10)`, an integer) |
|---|---|
| ATK | coding |
| MAG | ai_fluency |
| DEF | cybersecurity |
| SPD | harness_engineering |
| INT | agentic_frameworks |
| VIT | safety_compliance |
| ARM | database_integrations |
| (initiative tiebreak) | deploy_devops |

- Sim: seeded PRNG (mulberry32), 3 rounds, deterministic for the same seed and players.
- The LLM narrates the log. It never decides anything.

**Level Up runtime contract** (`POST /api/levelup`)

Request: `{ url?: string, claim?: { node_id: string } }`

| Step | Behavior |
|---|---|
| 1. URL guard | https only; block private/loopback IPs (SSRF); 5 s timeout; 200 KB cap |
| 2. Metadata | Fetch only public GitHub API repo metadata or page `<title>`/meta |
| 3. Sanitize + redact | Strip injection vectors; PII redaction before any model call |
| 4. Classification | `classify` alias (Claude Sonnet 5.5) with structured output `{ skill_nodes: string[], rationale: string }`. Fetched text is wrapped as data and never followed as instructions. |
| 5. Validation | Output validated by zod; out-of-taxonomy nodes are dropped |
| 6. Provenance | Rules decide: owner == `GITHUB_HANDLE` and URL resolves → verified; resolves only → corroborated; claim with no URL → self_claimed |
| 7. Weight | Rules: repo 3, deploy 3, cert 5, attestation 5, claim 1, rig_probe 2 |

Response: `{ evidence: Evidence, player: Player }`, with scores recomputed server-side.

---

## 8. Test & loop protocol

| Gate | Command | Where |
|---|---|---|
| Types | `pnpm typecheck` | CI + local |
| Lint | `pnpm lint` | CI + local |
| Unit | `pnpm test -- <path>` | CI + local |
| E2E | `pnpm e2e` (LLM mocked via `tests/fixtures/llm/`) | CI |
| Secrets | `gitleaks detect --no-banner` | CI + pre-commit |
| SAST | `semgrep --config .semgrep/ --error` | CI |
| Bundle | `pnpm build && node security/check-bundle.mjs` (fails if `ANTHROPIC_API_KEY` or `sk-ant-` key patterns appear in `dist/`) | CI |
| Preview | Playwright against the Vercel preview URL; screenshots attached to the PR | QA-03 |

Automated tests never call the real Claude API. Live calls are allowed only in INT-02's live smoke and in manual demos.

---

## 9. AGENTS.md: the master prompt

`AGENTS.md` at the repo root is committed verbatim by ENV-09.

---

## 10. Linear issue index (68 issues)

| P | Meaning |
|---|---|
| P0 (Urgent) | required for release (M4) |
| P1 (High) | ships with release if done; otherwise next milestone |
| P2 (Medium) | after release |

Refs are the bracketed tags in each Linear title. Blocked-by relations in Linear mirror this table.

| Ref | Title | Lane | Model | P | Blocked by |
|---|---|---|---|---|---|
| ENV-01 | Create repo, labels, branch protection, merge policy decision | env | human | P0 | — |
| ENV-02 | Install Claude Code + Finn-loop skills | env | human | P0 | — |
| ENV-03 | Connect Linear + GitHub in Claude Code; smoke-test reads | env | human | P0 | ENV-02 |
| ENV-04 | Scaffold Vite + React + TS + Tailwind + R3F + Vitest + ESLint | env | haiku | P0 | ENV-01 |
| ENV-05 | CI workflow `ci`: typecheck, lint, unit, build, gitleaks | env | haiku | P0 | ENV-04 |
| ENV-06 | Permissions, sandbox policy + subagent definitions | env | opus | P0 | ENV-03, ENV-04 |
| ENV-07 | Vercel link + server-only env vars + PR previews | env | human | P0 | ENV-01 |
| ENV-08 | LLM client `server/lib/llm.ts` (Anthropic SDK, registry, retries, cost meter) | env | opus | P0 | ENV-04 |
| ENV-09 | Commit AGENTS.md + MASTER_PLAN.md | env | haiku | P0 | ENV-03 |
| ENV-10 | Budget guard + kill switch (`BUDGET_USD_CAP`) | env | sonnet | P0 | ENV-08 |
| COR-01 | Contracts: types + zod schemas (freeze) | core | opus | P0 | ENV-04 |
| COR-02 | Skill taxonomy JSON (magic + weapon trees, prereqs) | core | sonnet | P0 | COR-01 |
| COR-03 | Scoring engine (provenance, decay, ratings, band, OVR, level) | core | sonnet | P0 | COR-01 |
| COR-04 | Engine golden tests (incl. self-claim = 0, K8s claim) | core | haiku | P0 | COR-01 |
| COR-05 | App shell, routing, design tokens, feature slots | integrator | sonnet | P0 | ENV-04, COR-01 |
| COR-06 | Seed evidence ledger (Mark supplies 15–20 artifact URLs) | data | human | P0 | COR-01 |
| CRD-01 | Player Card component | card | sonnet | P0 | COR-03, COR-05 |
| CRD-02 | Shared EvidenceDrawer + clickable stats | card | sonnet | P0 | CRD-01 |
| CRD-03 | Level/XP bar + level-up animation | card | haiku | P1 | CRD-01 |
| CRD-04 | Archetype namer (Haiku, cached) | card | sonnet | P1 | ENV-08, COR-03 |
| CRD-05 | Card PNG export | card | haiku | P2 | CRD-01 |
| CRD-06 | Accolades + portfolio strip | card | haiku | P1 | CRD-01 |
| MTR-01 | Tree engine + Magic Tree R3F constellation scene | magic | sonnet | P0 | COR-02, COR-05 |
| MTR-02 | Node states: locked / self-claimed / corroborated / verified + recency dim | magic | sonnet | P0 | MTR-01, COR-03 |
| MTR-03 | Node click → EvidenceDrawer | magic | haiku | P0 | MTR-01, CRD-02 |
| MTR-04 | Camera paths, tooltips, keyboard nav | magic | haiku | P1 | MTR-01 |
| MTR-05 | 2D graph fallback (mobile / low GPU) | magic | haiku | P1 | COR-02 |
| MTR-06 | Projected ghost nodes (excluded from OVR) | magic | sonnet | P2 | MTR-02 |
| WPN-01 | rig-probe CLI → rig.json (no serials/PII) | weapon | sonnet | P1 | COR-01 |
| WPN-02 | Weapon Tree scene (armory aesthetic) | weapon | sonnet | P1 | MTR-01, COR-02 |
| WPN-03 | Deploy-target nodes from deploy evidence | weapon | haiku | P1 | WPN-02 |
| WPN-04 | Loadout panel | weapon | haiku | P2 | WPN-01, WPN-02 |
| OVR-01 | Category ratings panel (± band, artifact count) | overall | sonnet | P0 | COR-03, COR-05 |
| OVR-02 | Radar/hex chart | overall | haiku | P1 | OVR-01 |
| OVR-03 | "How this was computed" explainer | overall | haiku | P1 | OVR-01 |
| LVL-01 | `/api/levelup` route + URL guard + metadata fetch | levelup | sonnet | P0 | ENV-08, COR-01 |
| LVL-02 | Claude classifier w/ structured output (no scores from LLM) | levelup | sonnet | P0 | LVL-01 |
| LVL-03 | Provenance + weight rules resolver | levelup | sonnet | P0 | LVL-01 |
| LVL-04 | Prompt-injection defense + output validation | levelup | opus | P0 | LVL-02 |
| LVL-05 | Level Up panel UI + node unlock animation | levelup | sonnet | P0 | LVL-02, MTR-02 |
| LVL-06 | Self-claim path (K8s stays gray, 0 pts) | levelup | haiku | P0 | LVL-05 |
| LVL-07 | Persist ledger (localStorage v1) | levelup | sonnet | P1 | LVL-01 |
| SCT-01 | Scout: GitHub public events → pending evidence | scout | sonnet | P1 | LVL-02 |
| SCT-02 | Pending-evidence inbox approve/reject | scout | haiku | P1 | SCT-01 |
| FGT-01 | Fight stat mapping | fight | haiku | P0 | COR-03 |
| FGT-02 | Deterministic battle sim + tests | fight | sonnet | P0 | FGT-01 |
| FGT-03 | Arena scene + hit animations | fight | sonnet | P1 | FGT-02, COR-05 |
| FGT-04 | Play-by-play narration of sim log (Haiku) | fight | sonnet | P1 | FGT-02, ENV-08 |
| FGT-05 | Rival player profile (fictional) | fight | haiku | P1 | FGT-01 |
| FGT-06 | Challenge link + 15 s vertical clip export | fight | sonnet | P2 | FGT-03 |
| FGT-07 | Procedural SVG avatar generator | fight | sonnet | P2 | ENV-08 |
| MNR-01 | Consent gate + on-device video (no upload) | mannerism | sonnet | P2 | COR-05 |
| MNR-02 | In-browser pose estimation (on-device) | mannerism | sonnet | P2 | MNR-01, ENV-08 |
| MNR-03 | Mannerism profile → avatar idle params | mannerism | sonnet | P2 | MNR-02 |
| SEC-01 | PII redaction middleware before every LLM call | security | opus | P0 | ENV-08 |
| SEC-02 | Secrets: gitleaks pre-commit + bundle key check | security | haiku | P0 | ENV-05 |
| SEC-03 | Semgrep SAST rules | security | haiku | P1 | ENV-05 |
| SEC-04 | API hardening: rate limit, zod input, SSRF block | security | opus | P0 | LVL-01 |
| SEC-05 | Threat model + data map | security | opus | P1 | — |
| SEC-06 | CSP + security headers on Vercel | security | haiku | P1 | ENV-07 |
| QA-01 | Playwright e2e golden path (mocked LLM) | qa | sonnet | P0 | LVL-06, CRD-02, MTR-03, OVR-01 |
| QA-02 | LLM record/replay fixtures | qa | haiku | P0 | ENV-08 |
| QA-03 | Preview verification + screenshots on PR | qa | sonnet | P1 | QA-01, ENV-07 |
| INT-01 | Integration pass: wire all features into shell | integrator | opus | P0 | CRD-02, MTR-03, OVR-01, LVL-05 |
| INT-02 | Release: prod deploy + live smoke | integrator | human | P0 | INT-01, QA-01 |
| DEMO-01 | 3-minute pitch script + roadmap (student audience) | demo | haiku | P0 | — |
| DEMO-02 | Record pitch video + one-pager | demo | human | P0 | INT-02, DEMO-01 |
| OPS-01 | Watchdog scheduled task (stuck, red CI, spend) | ops | haiku | P1 | ENV-03 |

**Critical path**

```
ENV-01 → ENV-04 → COR-01 → COR-03 → OVR-01 / CRD-01 → CRD-02 → MTR-03 → LVL-05 → LVL-06 → QA-01 → INT-01 → INT-02 → DEMO-02
```

---

## 11. Cost controls (no guessed prices)

| Control | Where |
|---|---|
| Runtime per-token rates live in `server/lib/llm-rates.ts`. ENV-08 fills them from the current Anthropic pricing page. Never guessed. | ENV-08 |
| Prompt caching on the classifier system prompt (the taxonomy is static) | ENV-08, LVL-02 |
| Response caching by input hash for archetype, narration, Scout drafts | CRD-04, FGT-04, SCT-01 |
| `BUDGET_USD_CAP` meter + `LLM_KILL=1` kill switch | ENV-10 |
| Anthropic Console monthly spend limit (the real hard stop) | ENV-07 |
| `LLM_MOCK=1` in every automated test | QA-02 |

Build-time cost is Claude Code usage. The usage-pressure override in §2 applies.

---

## 12. Pitch script (3:00, student audience)

| Time | Beat |
|---|---|
| 0:00–0:20 | Hook: "Resumes lie. This one can't." Card on screen. |
| 0:20–0:50 | Click OVR → evidence drawer: every point has a receipt. |
| 0:50–1:30 | Magic Tree flythrough. Glow = verified, gray = self-claimed. |
| 1:30–2:05 | Live Level Up: paste a real repo → Claude classifies → node unlocks → score recomputes. Then self-claim Kubernetes → stays gray, 0 pts. "The model classifies. Math scores." |
| 2:05–2:30 | Weapon Tree + Overall ratings with ± band. |
| 2:30–2:50 | Fight Mode: stats from real scores, seeded sim, AI only narrates. |
| 2:50–3:00 | "Build yours": what a student gets (see §14 student edition). |

---

## 13. Linear ID map (project P-MAB-12)

| Ref | Linear | Ref | Linear | Ref | Linear | Ref | Linear |
|---|---|---|---|---|---|---|---|
| ENV-01 | MAB-148 | COR-04 | MAB-169 | MTR-04 | MAB-191 | FGT-02 | MAB-197 |
| ENV-02 | MAB-149 | COR-05 | MAB-170 | MTR-05 | MAB-177 | FGT-03 | MAB-206 |
| ENV-03 | MAB-152 | COR-06 | MAB-171 | MTR-06 | MAB-202 | FGT-04 | MAB-207 |
| ENV-04 | MAB-153 | CRD-01 | MAB-175 | WPN-01 | MAB-173 | FGT-05 | MAB-198 |
| ENV-05 | MAB-155 | CRD-02 | MAB-186 | WPN-02 | MAB-192 | FGT-06 | MAB-210 |
| ENV-06 | MAB-156 | CRD-03 | MAB-187 | WPN-03 | MAB-203 | FGT-07 | MAB-174 |
| ENV-07 | MAB-154 | CRD-04 | MAB-183 | WPN-04 | MAB-204 | MNR-01 | MAB-185 |
| ENV-08 | MAB-157 | CRD-05 | MAB-188 | OVR-01 | MAB-178 | MNR-02 | MAB-199 |
| ENV-09 | MAB-158 | CRD-06 | MAB-189 | OVR-02 | MAB-193 | MNR-03 | MAB-208 |
| ENV-10 | MAB-161 | MTR-01 | MAB-176 | OVR-03 | MAB-194 | SEC-01 | MAB-162 |
| COR-01 | MAB-159 | MTR-02 | MAB-190 | LVL-01 | MAB-172 | SEC-02 | MAB-163 |
| COR-02 | MAB-167 | MTR-03 | MAB-200 | LVL-02 | MAB-179 | SEC-03 | MAB-164 |
| COR-03 | MAB-168 | SCT-01 | MAB-196 | LVL-03 | MAB-180 | SEC-04 | MAB-182 |
| QA-01 | MAB-212 | SCT-02 | MAB-205 | LVL-04 | MAB-195 | SEC-05 | MAB-151 |
| QA-02 | MAB-166 | INT-01 | MAB-211 | LVL-05 | MAB-201 | SEC-06 | MAB-165 |
| QA-03 | MAB-213 | INT-02 | MAB-214 | LVL-06 | MAB-209 | DEMO-01 | MAB-150 |
| OPS-01 | MAB-160 | DEMO-02 | MAB-215 | LVL-07 | MAB-181 | FGT-01 | MAB-184 |

---

## 14. Roadmap (after release)

- **Student edition (next milestone, M6):** sign-in, a database, and one evidence-linked card per student. Decided 2026-11-05: Mark's card ships first.
- **GitHub OAuth "verified" tier:** provenance from a signed-in account, not a handle match.
- **Mannerism capture v2:** richer on-device motion features driving avatar animation.
- **Scout always-on:** scheduled public-activity scan with a human approve inbox.
- **Challenge clips:** vertical fight clips for any short-video platform, shared manually.
