# Permissions and sandbox policy (ENV-06)

The factory has three layers of protection, from inside out:

| Layer                              | File                    | What it stops                                                                                                     |
| ---------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1. Claude Code permission rules    | `.claude/settings.json` | Agent tool calls: forbidden Bash commands, reads of secrets, Verizon paths                                        |
| 2. Git hook (opt-in per clone)     | `.githooks/pre-push`    | Pushes to `main`/`master`, branch deletes, force pushes. Skipped by `--no-verify`, which layer 1 denies to agents |
| 3. GitHub ruleset "protections v1" | repo settings (Mark)    | Server side: no direct push, no force push, no deletion of the default branch; PR required                        |

Deny rules win over allow rules in Claude Code, and the hook and ruleset still apply if a rule misses an edge case.

## One-time setup per clone

```bash
# Git Bash or bash, from the repo root (e.g. ~/mab-hackathon-11.2026)
git config core.hooksPath .githooks
```

Claude Code honors `permissions.allow` from a project's `.claude/settings.json` only after the workspace has been trusted (open Claude Code there once and accept the trust dialog). Deny rules apply either way.

## Rules

### AC-1: Allowed

| Rule                                                                                                                                        | Why                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `defaultMode: "acceptEdits"` + `Edit(./**)`                                                                                                 | Builders edit freely inside the repo or worktree they run in                                                                                                       |
| `Bash(pnpm *)`, `Bash(node *)`                                                                                                              | Install, test, typecheck, lint, build                                                                                                                              |
| `Bash(npx vitest *)`, `Bash(npx playwright *)`                                                                                              | Direct test runners                                                                                                                                                |
| `Bash(git status*)`, `diff`, `log`, `show`, `branch`, `switch`, `checkout`, `add`, `commit`, `fetch`, `pull`, `rebase`, `merge`, `worktree` | Normal branch work                                                                                                                                                 |
| `Bash(git push [-u] origin feat/*)` (also `fix/`, `chore/`, `refactor/`)                                                                    | Push lane branches. The `*` also matches trailing arguments, so the deny list below blocks the dangerous ones (main/master refspecs, force, delete, `--no-verify`) |
| `Bash(gh pr *)`                                                                                                                             | Open PRs, comment, label. `gh pr merge` is denied (below)                                                                                                          |

Trade-off: `pnpm *` and `node *` can run arbitrary code. The issue asks for them, and the lane rules in `AGENTS.md`, the deny list and layers 2–3 bound the damage.

### AC-2: Denied

| Rule(s)                                                                                                                                                                                                                                                                                                                                                                     | Covers                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Bash(git push --force*)`, `-f*`, `* --force*` (incl. `--force-with-lease`), `* -f*`, `* +*` (refspec force), `--mirror`, `--delete`                                                                                                                                                                                                                                        | Force pushes, mirror pushes and remote deletes                                                                                                                                                                                 |
| `Bash(git push * main)`, `* main *`, `* *:main*`, `*refs/heads/main*`, and the same for `master`                                                                                                                                                                                                                                                                            | Pushes to the protected branch, including `HEAD:main` and `feat/x:refs/heads/main`                                                                                                                                             |
| `Bash(git push *--no-ver*)`                                                                                                                                                                                                                                                                                                                                                 | Skipping the pre-push hook (git accepts abbreviations such as `--no-veri`)                                                                                                                                                     |
| `Bash(git push -d*)`, `Bash(git push * -d*)`                                                                                                                                                                                                                                                                                                                                | Short-form remote deletes                                                                                                                                                                                                      |
| `Bash(gh pr merge*)`, `Bash(gh pr -R*)`, `Bash(gh pr --repo*)`                                                                                                                                                                                                                                                                                                              | Builders and reviewers never merge (AGENTS.md rule 6). The orchestrator merges through the REST API under MASTER_PLAN §5                                                                                                       |
| `Bash(rm -rf /*)`, `~*`, `$HOME*`, `..*` and the `rm -fr` spellings                                                                                                                                                                                                                                                                                                         | Recursive deletes that start outside the repo                                                                                                                                                                                  |
| `Read(~/.ssh/**)`, `Edit(~/.ssh/**)`                                                                                                                                                                                                                                                                                                                                        | SSH keys                                                                                                                                                                                                                       |
| `Read(**/.env)`, `.envrc`, `.env~`, `.env.local`, `.env.*.local`, `.env.dev*`, `.env.development*`, `.env.prod*`, `.env.production*`, `.env.preview*`, `.env.stag*`, `.env.test*`, `.env.e2e*`, `.env.ci*`, `.env.vercel*`, `.env.bak*`, `.env.backup*`, `.env.old*`, `.env.orig*`, `.env.save*`, `.env.copy*`, `.env.secret*`, `.env.*.bak`, `.env.*.old`, `.env.examples` | Secret env files. Only `.env.example` stays readable. The list is explicit because the CLI's path matcher did not honor `[!x]` bracket negation in testing: `.env.[!e]*`-style rules denied `.env.example` and missed `.envrc` |
| `Read`/`Edit` of `**/verizon*`, `**/verizon*/**`, `**/Verizon*`, `**/Verizon*/**`, plus the same with a `//` prefix (absolute paths)                                                                                                                                                                                                                                        | Verizon firewall (AGENTS.md rule 7)                                                                                                                                                                                            |

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
- the push is not a fast-forward of the remote tip
- the remote tip is unknown locally (fails closed: run `git fetch` and retry)

## Known gaps

- `Read` deny rules govern Claude's file tools. A Bash command such as `cat .env` is not matched by them. The OS sandbox would close this gap, but it is not enabled: Mark's machine is Windows (Git Bash), where the Claude Code sandbox is not available. Revisit if builds move to Linux/macOS or WSL.
- Bash prefix rules match the command as written. Exotic spellings (`git -C . push origin main`, aliases) can slip past layer 1. Layer 2 still refuses them unless the hook is not enabled in that clone. Layer 3 (the GitHub ruleset) always refuses pushes to `main`.
- `.env` coverage is an explicit list. A secret file with an unlisted suffix (e.g. `.env.mine`) would be readable. Keep secrets in Vercel env and the files above.
- `gh pr *` lets reviewers run `gh pr close`, `gh pr review --approve` or `gh pr edit`. Reviewer read-only is enforced by their prompt and `disallowedTools`. Filed as a follow-up to add GitHub/Linear MCP write tools to the reviewers' `disallowedTools`.
- `Edit(./**)` is relative to where the session starts. Start a manual builder session inside its worktree (`cd ../wt-<ref>`), or add it with `--add-dir`.
- `rm -Rf`, `rm -r -f` and `rm --recursive --force` spellings are not denied. They are not auto-allowed either, so they prompt (or are refused headless).
- `.gitignore` does not yet ignore `.claude/worktrees/` (where `isolation: worktree` puts worktrees) or `.claude/settings.local.json`. That file is outside this lane, so the change is filed as a follow-up on MAB-156.

## Verification (2026-11-06)

Run in a disposable clone (`/tmp/claude-0/ac7/work`) whose `origin` is a local bare repo, so nothing real could be pushed. Headless sessions: `claude -p --model haiku --settings .claude/settings.json`.

| Check                                                                                                                                                                     | Result                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Positive control: agent runs `git push origin feat/ac7-probe`                                                                                                             | Allowed. `* [new branch] feat/ac7-probe -> feat/ac7-probe`                                                       |
| **AC-7:** agent runs `git push origin main`                                                                                                                               | **Refused:** `Permission to use Bash with command git push origin main has been denied.` Remote `main` unchanged |
| Agent runs `git push --force origin feat/ac7-probe`                                                                                                                       | Refused: `Permission to use Bash with command git push --force origin feat/ac7-probe has been denied.`           |
| Agent reads `.env`                                                                                                                                                        | Refused: `File is in a directory that is denied by your permission settings.`                                    |
| Agent reads `.env.example`                                                                                                                                                | Allowed (contents returned)                                                                                      |
| Agent reads `notes/Verizon-q3/x.txt`                                                                                                                                      | Refused: `File is in a directory that is denied by your permission settings.`                                    |
| Plain shell `git push origin main` (hook layer)                                                                                                                           | Refused: `pre-push: refusing to push to protected branch 'main' (AGENTS.md rule 6). Open a PR instead.`          |
| Hook unit cases (synthetic stdin): main, new master, delete, non-fast-forward, unknown remote tip                                                                         | All exit 1. Fast-forward, new `feat/` branch and empty stdin exit 0                                              |
| Fix round 1: agent runs `git push origin feat/ac7-probe:refs/heads/main --no-verify`, `git push origin feat/ac7-probe -uf --no-veri`, `gh pr -R example-org/none merge 1` | All three refused: `Permission to use Bash with command … has been denied.` Remote `main` unchanged              |
| Fix round 1: agent reads `.env`, `.envrc`, `.env.prod`, `.env.bak`, `.env.local`, `.env.secret`, `.env.staging.local`, `.env.examples`                                    | All eight refused. `.env.example` read succeeded                                                                 |
| Fix round 1: positive control `git push origin feat/ac7-probe` (fast-forward)                                                                                             | Allowed                                                                                                          |

With `AGENTS.md` present, the agent also refused the force push and the Verizon read on its own before reaching the permission layer. The two rows above were re-run with `AGENTS.md` moved out of the disposable clone, so the rules themselves were exercised.

Rule syntax (`Tool(specifier)`, `*` wildcards, `~/` and `//` path prefixes, `defaultMode`) and subagent frontmatter (`model`, `isolation: worktree`, `disallowedTools`) were checked against the installed Claude Code 2.1.318.
