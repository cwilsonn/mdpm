# mdpm

Markdown-based project management tool. Nuxt 4 app that stores projects, tasks, and docs as markdown files in `content/`. Exposes an MCP server for Claude Code integration.

## Setup

**Node 24 required** (`.nvmrc` pins it). `better-sqlite3` is a native module — if you switch Node versions, run `pnpm rebuild better-sqlite3`.

```sh
nvm use
pnpm install
pnpm dev       # http://mdpm.local:3333
```

Server lifecycle goes through the CLI: `mdpm start | stop | restart | status` (background, pid record in `~/.local/state/mdpm/`; `--foreground` to attach). A server started by plain `pnpm dev` is still found and stoppable: `status`/`stop` fall back to Nuxt's own `.nuxt/nuxt.lock`. Install the CLI once with `pnpm add --global "link:$(pwd)"`. Type-check CLI/core/MCP with `pnpm typecheck:cli`.

Add to `/etc/hosts` if not present (or set `MDPM_BASE_URL=http://localhost:3333`, which needs no hosts entry: `mdpm start` binds the base URL's hostname via `MDPM_HOST`) (the `::1` line avoids a ~5s per-request mDNS delay on macOS; README has the WSL notes):
```
127.0.0.1 mdpm.local
::1 mdpm.local
```

## Stack

- **Nuxt 4** (`compatibilityVersion: 4`, `app/` dir layout — `app.config.ts` lives at `app/app.config.ts`)
- **@nuxt/content v3** — file-based markdown, SQLite cache, `queryCollection()`
- **@nuxt/ui v4** — `UNavigationMenu`, `UModal`, `UInputTags`, etc.
- **Nitro server routes** — server-side utils auto-imported: `writeMarkdown`, `contentPath`, `slugify`, `uniqueSlug`, `readMarkdown`, `deleteContent`

## Content Structure

```
content/
  projects/
    <slug>/
      index.md          # project metadata (frontmatter only)
      tasks/
        <slug>.md       # task: frontmatter + markdown body
      docs/
        <slug>.md       # reference doc: frontmatter + markdown body
```

Collections defined in `content.config.ts`: `projects`, `tasks`, `docs`.

## API Routes

### Tasks
- `GET /api/tasks` — all tasks (filter: `?project=`, `?status=`, `?priority=`, `?tags=`)
- `POST /api/tasks` — create task
- `PATCH /api/tasks/[project]/[slug]` — update task
- `DELETE /api/tasks/[project]/[slug]` — delete task

### Docs
- `GET /api/docs` — all docs (filter: `?project=`)
- `POST /api/docs/[project]` — create doc
- `GET /api/docs/[project]/[slug]` — get doc with body
- `PATCH /api/docs/[project]/[slug]` — update doc
- `DELETE /api/docs/[project]/[slug]` — delete doc

## MCP Server

Location: `mcp/index.ts` (runs via `tsx`, no build step).

**Read tools** query markdown files directly — no dev server needed.  
**Write tools** call the Nuxt HTTP API — dev server must be running.

Registered globally: `~/.claude.json` under `mcpServers.mdpm`.

Required env vars (set in shell profile or `.env`):
- `MDPM_CONTENT_PATH` — absolute path to `content/` dir (e.g. `/Users/cody/dev/projects/mdpm/content`). Honored by the web app/API too (`server/utils/content.ts`); `mdpm start` passes the CLI's resolved value to the server, and writes are refused when the server reports a different root (`GET /api/health`)
- `MDPM_BASE_URL` — base URL of running Nuxt app (default: `http://mdpm.local:3333`)

Tools: `ping`, `list_projects`, `get_project`, `list_tasks`, `get_task`, `create_task`, `update_task`, `list_docs`, `get_doc`, `search_docs`, `upsert_doc`

## Claude Code Skills

Global skills. Source of truth is `skills/` in this repo; `~/.claude/commands/<name>.md` are symlinks into it, managed by `mdpm skills install|uninstall|status` (edit in the repo, never the symlink target dir). They stay global because `/pickup <project>` runs in every registered project:

| Skill | When to use |
|-------|-------------|
| `/start-mdpm` | Start dev server via `mdpm start` (idempotent — safe to call if already running) |
| `/stop-mdpm` | Stop dev server via `mdpm stop` |
| `/pickup <project>` | Start of session — loads open tasks, docs, last session notes |
| `/sync` | Mid-session — sync task statuses + update stale docs |
| `/handoff` | End of session — writes `session-notes` doc, marks tasks done |

<!-- mdpm:work-logging:start -->
## Work logging (mdpm)

This repo is tracked in mdpm as project `mdpm`. Log work there as you go, so there is an audit trail of what was done and why. Use the `mdpm` CLI (add `--project mdpm` if it isn't detected from the repo; writes need the server, so add `--auto-start` if it may be down).

1. **Before starting a unit of work, find or create its task.** `mdpm task search "<keywords>"` or `mdpm task list`; if none fits, `mdpm task add "<title>" --priority <low|medium|high|urgent> --description "<scope and why>"`. Mark it started: `mdpm task set <ref> --status in-progress`.
2. **While working, append notes** at meaningful points (decisions and their reasons, surprises, blockers, what you verified): `mdpm task note <ref> "<note>"`.
3. **Reference commits and PRs** in a note, and link PRs with `mdpm task set <ref> --github-prs <n>`.
4. **When finished, set the status:** `in-review` if it still needs verification, otherwise `mdpm task done <ref>`.

Keep it proportionate: one task per unit of work worth reviewing later, not one per typo or formatting tweak. Don't delete tasks to tidy up; archive them (`mdpm task archive <ref>`).
<!-- mdpm:work-logging:end -->

The block above is generated from `templates/work-logging.md` (`{{project}}` filled in); edit the template and keep this copy in sync (a test checks it). The same text is stored as the mdpm doc `work-logging-snippet` for reuse in other repos.

## Commit Messages

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>)?: <description>`, subject ≤ 100 chars, imperative mood, lowercase type.

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Append `!` for breaking changes (`feat(api)!: ...`).
- Scope is the area touched, matching existing history: `mcp`, `cli`, `core`, `skills`, `archive`, `pnpm`, `task`, `doc`, `project`, ...
- Body explains *why* and lists notable side effects (e.g. bugs fixed along the way). Keep commits scoped: one concern per commit; don't mix tooling fixes with features.
- Never commit unless asked. Propose the split, then commit.

**Gate:** `scripts/check-commits.mjs` (no dependencies) validates subjects. CI (`.github/workflows/commits.yml`) runs it on every PR (all commits plus the PR title, since squash merges use the title) and on pushes to `main`. Only new commit ranges are checked; a handful of pre-convention commits in early history don't conform and are exempt by design.

Check locally before pushing:

```sh
node scripts/check-commits.mjs origin/main..HEAD
node scripts/check-commits.mjs --message "feat(cli): add thing"
```

Optional local hook (rejects bad messages at commit time):

```sh
printf '#!/bin/sh\nnode scripts/check-commits.mjs --file "$1"\n' > .git/hooks/commit-msg && chmod +x .git/hooks/commit-msg
```

## Branch Protection

`main` is protected by the "Protect main" ruleset:

- Changes land through a **pull request**, merged by **rebase only** (squash and merge-commit are disabled), and history on `main` stays **linear** (merge commits are rejected).
- The `test` (CI) and `check` (commit gate) checks must pass, and the PR branch must be **up to date with `main`** before it can merge.
- Force-push to and deletion of `main` are blocked. Required approvals are 0 (solo repo; you can't approve your own PR).
- Repo admins can bypass **only through a PR**, never by direct push.

Workflow:

- **Never push to `main` directly.** Work on a branch (`<type>/<short-description>`), push it, and open a PR; CI runs on the PR.
- Keep the branch current with `git fetch && git rebase origin/main`, then `git push --force-with-lease` (force-push is only blocked on `main`). If a merge is blocked as "out of date", that is why.
- A rebase merge lands every commit on the branch individually: each must be a valid Conventional Commit (the gate checks them all) and each shows up in the changelog, so tidy the branch (squash fixups locally) before opening the PR. The PR title is still checked.
- Rebase merging rewrites commit SHAs. After merge, refer to the commits as they appear on `main`, not to the branch's old SHAs.
- Release-please PRs: unless the `RELEASE_PLEASE_TOKEN` secret is configured (see Releases), they are opened with `GITHUB_TOKEN`, the required checks don't run on them, and they stay blocked for non-admins. Merge them as admin (the bypass applies to the PR merge), using rebase.
- Don't merge a PR without being asked; open it and report the link.

## Releases

Versioning is automated from commit types by [release-please](https://github.com/googleapis/release-please) (`.github/workflows/release.yml`, config in `release-please-config.json`, current version in `.release-please-manifest.json`). **Never edit `version` in `package.json` or `CHANGELOG.md` by hand.**

- Every push to `main` opens/updates a release PR (`chore(main): release x.y.z`). Merging it bumps `package.json`, writes `CHANGELOG.md`, tags `mdpm-vx.y.z` (release-please includes the component name because `package-name` is set), and creates a GitHub Release. Railway deploys from `main` as before; releases don't gate deploys.
- Bump rules (pre-1.0, so breaking → minor): `feat` → minor, `fix` → patch, `!` or a `BREAKING CHANGE:` footer → minor now, major after 1.0. `perf`/`refactor`/`revert` appear in the changelog; `docs`/`build`/`ci`/`chore`/`style`/`test` are hidden from it. Only `feat`, `fix`, and breaking changes are relied on to drive a release.
- So commit types are load-bearing: pick `feat` vs `fix` deliberately; use `chore`/`ci`/`build`/`docs` for changes that shouldn't show up in release notes.
- GitHub setting required: Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests".
- Release PRs: by default they are opened with `GITHUB_TOKEN`, so other workflows (incl. CI and the commit gate) don't run on them and they need an admin merge. To make them run the required checks, add a `RELEASE_PLEASE_TOKEN` repo secret: a fine-grained PAT for this repo with **Contents: read/write** and **Pull requests: read/write**. `release.yml` uses it when present and falls back to `GITHUB_TOKEN` otherwise. Their titles already conform.
- Dependabot (`.github/dependabot.yml`) bumps the SHA-pinned actions weekly with `ci(deps): …` titles (hidden from the changelog, no release). The npm ecosystem is deliberately not enabled yet.

### Versioning

mdpm is **pre-1.0 and stays 0.x**. 1.0.0 is a deliberate milestone, not a roadmap bucket: it means the project is ready to be **published publicly on npm**. That is a goal, but not the primary one. Features, quality, and a stable CLI/MCP surface come first, and 1.0.0 is not triggered by the feature list "feeling complete". Until then breaking changes bump the minor (`bump-minor-pre-major`); cutting 1.0.0 is a conscious act (a `Release-As: 1.0.0` footer or config change), never an accident of commit types.

Internal task tracking uses milestone tags `core` (the first CLI milestone, shipped across 0.2 to 0.5), `next`, and `later`. They are roadmap buckets, not release numbers: don't introduce version-shaped labels (`v1`, `v1.1`, `v2`) for roadmap items. The MCP server and the CLI both report the `package.json` version.

## UI Conventions

Project pages use route-linked tabs via `AppPageBase`:
- `/projects/[slug]` — Tasks tab (`exact: true`)
- `/projects/[slug]/docs` — Docs tab
- `/projects/[slug]/docs/[doc]` — Inline doc editor

`AppPageBase` accepts `tabs: PageTab[]`; renders `UNavigationMenu` with `highlight` + `pill`. Do not use `UTabs` + `?tab=` query params for project-level navigation.

## Seed / Reset Safety

Seed plugin (`server/plugins/seed.ts`) and hourly reset task (`server/tasks/reset.ts`) are **production-only** — both guard on `process.env.NODE_ENV === 'production'`. Running `pnpm dev` locally will never seed or reset data.

## Deployment

Railway. Persistent volume at `/app/content`. Start command: `node .output/server/index.mjs`. Required env: `NODE_ENV=production`.
