# Permissions and sandbox policy (ENV-06)

The factory has three layers of protection, from inside out:

| Layer                              | File                    | What it stops                                                                              |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| 1. Claude Code permission rules    | `.claude/settings.json` | Agent tool calls: forbidden Bash commands, reads of secrets, Verizon paths                 |
| 2. Git hook                        | `.githooks/pre-push`    | Any push (agent or human) to `main`/`master`, branch deletes, force pushes                 |
| 3. GitHub ruleset "protections v1" | repo settings (Mark)    | Server side: no direct push, no force push, no deletion of the default branch; PR required |

Deny rules win over allow rules in Claude Code, and the hook and ruleset still apply if a rule misses an edge case.

## One-time setup per clone

```bash
# Git Bash or bash, from the repo root (e.g. ~/mab-hackathon-11.2026)
git config core.hooksPath .githooks
```

Claude Code honors `permissions.allow` from a project's `.claude/settings.json` only after the workspace has been trusted (open Claude Code there once and accept the trust dialog). Deny rules apply either way.

## Rules

### AC-1: Allowed

| Rule                                                                                                                                        | Why                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `defaultMode: "acceptEdits"` + `Edit(./**)`                                                                                                 | Builders edit freely inside the repo or worktree they run in            |
| `Bash(pnpm *)`, `Bash(node *)`                                                                                                              | Install, test, typecheck, lint, build                                   |
| `Bash(npx vitest *)`, `Bash(npx playwright *)`                                                                                              | Direct test runners                                                     |
| `Bash(git status*)`, `diff`, `log`, `show`, `branch`, `switch`, `checkout`, `add`, `commit`, `fetch`, `pull`, `rebase`, `merge`, `worktree` | Normal branch work                                                      |
| `Bash(git push [-u] origin feat/*)` (also `fix/`, `chore/`, `refactor/`)                                                                    | Push lane branches only. Every other push asks or, headless, is refused |
| `Bash(gh pr *)`                                                                                                                             | Open PRs, comment, label. `gh pr merge` is denied (below)               |

Trade-off: `pnpm *` and `node *` can run arbitrary code. The issue asks for them, and the lane rules in `AGENTS.md`, the deny list and layers 2–3 bound the damage.

### AC-2: Denied

| Rule(s)                                                                                                                                                | Covers                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `Bash(git push --force*)`, `-f*`, `* --force*` (incl. `--force-with-lease`), `* -f*`, `* +*` (refspec force), `--mirror`, `--delete`                   | Force pushes, mirror pushes and remote deletes                                                                           |
| `Bash(git push * main)`, `* main *`, `* *:main*`, and the same for `master`                                                                            | Pushes to the protected branch, including `HEAD:main`                                                                    |
| `Bash(gh pr merge*)`                                                                                                                                   | Builders and reviewers never merge (AGENTS.md rule 6). The orchestrator merges through the REST API under MASTER_PLAN §5 |
| `Bash(rm -rf /*)`, `~*`, `$HOME*`, `..*` and the `rm -fr` spellings                                                                                    | Recursive deletes that start outside the repo                                                                            |
| `Read(~/.ssh/**)`, `Edit(~/.ssh/**)`                                                                                                                   | SSH keys                                                                                                                 |
| `Read(**/.env)`, `.env.local`, `.env.*.local`, `.env.development*`, `.env.production*`, `.env.preview*`, `.env.staging*`, `.env.test*`, `.env.vercel*` | Secret env files. `.env.example` stays readable                                                                          |
| `Read`/`Edit` of `**/verizon*`, `**/verizon*/**`, `**/Verizon*`, `**/Verizon*/**`, plus the same with a `//` prefix (absolute paths)                   | Verizon firewall (AGENTS.md rule 7)                                                                                      |

### AC-3: Subagents (`.claude/agents/`)

| File                 | `model:` | Notes                                        |
| -------------------- | -------- | -------------------------------------------- |
| `builder-opus.md`    | opus     | `isolation: worktree`                        |
| `builder-sonnet.md`  | sonnet   | `isolation: worktree`                        |
| `builder-haiku.md`   | haiku    | `isolation: worktree`                        |
| `reviewer-opus.md`   | opus     | `disallowedTools: Edit, Write, NotebookEdit` |
| `reviewer-sonnet.md` | sonnet   | `disallowedTools: Edit, Write, NotebookEdit` |

Every file tells the agent to read `AGENTS.md` first. Reviewers keep Bash and the GitHub/Linear tools so they can run tests and post PR comments and labels. Their prompt limits writes to those two things.

### AC-4: Worktrees

Builders declare `isolation: worktree`, so Claude Code runs each one in its own temporary git worktree. Builders started by hand follow AGENTS.md step 4 (`git worktree add ../wt-<ref> -b feat/<ref-lower>-<kebab>`).

### AC-5: Pre-push hook

`.githooks/pre-push` reads git's `<local ref> <local sha> <remote ref> <remote sha>` lines. It exits 1 when:

- the remote ref is `refs/heads/main` or `refs/heads/master`
- the push deletes a remote branch
- the push is not a fast-forward of a remote tip that exists locally

## Known gaps

- `Read` deny rules govern Claude's file tools. A Bash command such as `cat .env` is not matched by them. The OS sandbox would close this gap, but it is not enabled: Mark's machine is Windows (Git Bash), where the Claude Code sandbox is not available. Revisit if builds move to Linux/macOS or WSL.
- Bash prefix rules match the command as written. Exotic spellings (`git -C . push origin main`, aliases) can slip past layer 1. Layers 2 and 3 still refuse them.
- `.gitignore` does not yet ignore `.claude/worktrees/` (where `isolation: worktree` puts worktrees) or `.claude/settings.local.json`. That file is outside this lane, so the change is filed as a follow-up on MAB-156.

## Verification (2026-11-06)

Run in a disposable clone (`/tmp/claude-0/ac7/work`) whose `origin` is a local bare repo, so nothing real could be pushed. Headless sessions: `claude -p --model haiku --settings .claude/settings.json`.

| Check                                                                         | Result                                                                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Positive control: agent runs `git push origin feat/ac7-probe`                 | Allowed. `* [new branch] feat/ac7-probe -> feat/ac7-probe`                                                       |
| **AC-7:** agent runs `git push origin main`                                   | **Refused:** `Permission to use Bash with command git push origin main has been denied.` Remote `main` unchanged |
| Agent runs `git push --force origin feat/ac7-probe`                           | Refused: `Permission to use Bash with command git push --force origin feat/ac7-probe has been denied.`           |
| Agent reads `.env`                                                            | Refused: `File is in a directory that is denied by your permission settings.`                                    |
| Agent reads `.env.example`                                                    | Allowed (contents returned)                                                                                      |
| Agent reads `notes/Verizon-q3/x.txt`                                          | Refused: `File is in a directory that is denied by your permission settings.`                                    |
| Plain shell `git push origin main` (hook layer)                               | Refused: `pre-push: refusing to push to protected branch 'main' (AGENTS.md rule 6). Open a PR instead.`          |
| Hook unit cases (synthetic stdin): main, new master, delete, non-fast-forward | All exit 1. Fast-forward and new `feat/` branch exit 0                                                           |

With `AGENTS.md` present, the agent also refused the force push and the Verizon read on its own before reaching the permission layer. The two rows above were re-run with `AGENTS.md` moved out of the disposable clone, so the rules themselves were exercised.

Rule syntax (`Tool(specifier)`, `*` wildcards, `~/` and `//` path prefixes, `defaultMode`) and subagent frontmatter (`model`, `isolation: worktree`, `disallowedTools`) were checked against the installed Claude Code 2.1.318.
