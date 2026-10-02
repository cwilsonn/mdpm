# .mdpm

A local-first, markdown-based project management tool. Tasks and docs live as plain `.md` files in a `content/` directory — portable, git-friendly, and readable without the app. Built on Nuxt 4 + `@nuxt/content` + `@nuxt/ui`.

## Demo / Sandbox

Live on Railway (resets hourly with fresh demo data):
**https://mdpm-production-2440.up.railway.app/**

Feel free to poke around — create projects, drag tasks between columns, write docs. It'll wipe itself clean every hour.

## What it does

- **Projects** — create and manage projects with status, tags, description, and a custom icon
- **Tasks** — kanban board per project (todo / in-progress / in-review / blocked / done), drag to reorder and move between columns, priority levels, assignees, dependencies, due dates, markdown descriptions
- **Docs** — reference docs per project with a rich text editor; also a global searchable/filterable docs page across all projects
- **CLI** — `mdpm` for the terminal: server lifecycle, projects, tasks, docs, and a session briefing, with `--json` output for scripts and agents
- **MCP server** — local stdio MCP server (`mcp/index.ts`) so Claude Code can read and write your projects, tasks, and docs directly

## Stack

- [Nuxt 4](https://nuxt.com) (`compatibilityVersion: 4`)
- [@nuxt/content v3](https://content.nuxt.com) — file-based markdown with SQLite cache
- [@nuxt/ui v4](https://ui.nuxt.com) — component library
- [Tiptap](https://tiptap.dev) — rich text editor
- [vue-draggable-plus](https://github.com/Alfred-Skyblue/vue-draggable-plus) — drag-and-drop kanban
- [gray-matter](https://github.com/jonschlinkert/gray-matter) — frontmatter parsing (used by MCP server)

## Installation

Works on macOS and Linux. **WSL2 is confirmed working** (Ubuntu on a Windows VM); native Windows is not supported because the lifecycle commands use POSIX process groups.

**Before you start**
- The repo is public, so cloning needs no credentials. On a machine holding private or work data, run `git remote set-url --push origin no_push` in the checkout: `content/projects/` is gitignored, but `content/docs/` (standalone docs) is tracked and would show up in `git status`.
- There is no authentication. The dev server listens on loopback only; don't tunnel or expose it.
- Installing third-party tooling may need approval on a managed machine.

### 1. Prerequisites

- **Node 24** (`.nvmrc`; `nvm install 24`)
- **pnpm 11.22.0**, pinned by `packageManager`: `corepack enable` (bundled with Node 24) or `npm i -g pnpm@11.22.0`
- **git**, and admin rights once to edit the hosts file
- Build tools (`build-essential`, `python3` on Debian/Ubuntu; Xcode CLT on macOS) only if `better-sqlite3` has no prebuilt binary for your platform
- Claude Code, optional, for the MCP server and skills

### 2. Clone and install

```bash
git clone https://github.com/cwilsonn/mdpm.git ~/mdpm
cd ~/mdpm
pnpm install
```

### 3. Hosts entries

The dev server binds the hostname of the base URL, `mdpm.local` by default. **No admin rights?** Skip this step and use `localhost` instead: set `MDPM_BASE_URL=http://localhost:3333` (or `"baseUrl"` in `~/.config/mdpm/config.json`) and `mdpm start` binds `localhost`, which needs no hosts entry. Otherwise add both lines (the `::1` one avoids a ~5s per-request delay on macOS, where `.local` names otherwise go through mDNS):

```bash
grep -q mdpm.local /etc/hosts || printf '127.0.0.1 mdpm.local\n::1 mdpm.local\n' | sudo tee -a /etc/hosts
```

On **WSL2**, the name also has to resolve on the Windows side if you want `mdpm.local` in a Windows browser: add `127.0.0.1 mdpm.local` (and `::1 mdpm.local`) to `C:\Windows\System32\drivers\etc\hosts` as Administrator. Without that, `http://localhost:3333` works from the Windows browser. The WSL-side `mdpm.local` entry is only needed while the base URL is `mdpm.local`; with `MDPM_BASE_URL=http://localhost:3333` neither side needs one. Keep the checkout in the Linux filesystem, not under `/mnt/c`.

### 4. Install the CLI

pnpm 11 refuses global installs until its global bin directory is on `PATH`:

```bash
pnpm setup                         # then open a new terminal
cd ~/mdpm && pnpm add --global "link:$(pwd)"
mdpm --version
```

The checkout is linked live, so `git pull` updates the CLI. If `mdpm` isn't found, `$PNPM_HOME/bin` (for example `~/Library/pnpm/bin`) must be on `PATH`; a symlink is an equivalent fallback: `ln -s ~/mdpm/bin/mdpm.mjs ~/.local/bin/mdpm`.

### 5. First run

```bash
mdpm ping        # config and content check; "server down" is expected
mdpm start       # background dev server; the first start can take ~30s
mdpm status
```

Open <http://mdpm.local:3333>. A fresh install has no projects (the app seeds demo data only in production). Create one:

```bash
mdpm project create "My Project" --description "What this is"
mdpm task add "First task" --project my-project --priority high
mdpm pickup my-project
```

Logs are in `~/.local/state/mdpm/server-3333.log`. Stop with `mdpm stop`.

> **Content directory:** the web app, API, CLI, and MCP server all use one content root, `<checkout>/content` by default. To keep it elsewhere set `MDPM_CONTENT_PATH` (or `contentPath` in the config file, or `--content-path`); `mdpm start` hands that path to the server it launches. If a server started some other way (for example plain `pnpm dev`) uses a different directory, writes are refused with an explanation and `mdpm ping` reports the mismatch; `mdpm restart` fixes it. For a manually started server, set the same `MDPM_CONTENT_PATH` in its environment.

### 6. Claude Code (optional)

MCP server, no environment variables needed:

```bash
claude mcp add mdpm --scope user -- ~/mdpm/node_modules/.bin/tsx ~/mdpm/mcp/index.ts
claude mcp list                    # mdpm ... Connected
```

Skills, symlinked into `~/.claude/commands/` (or `$CLAUDE_CONFIG_DIR/commands`) so they update with `git pull`:

```bash
mdpm skills install      # idempotent; `mdpm skills status` shows linked / missing / conflict
```

It never overwrites anything: a regular file or a symlink pointing elsewhere is reported and skipped, and `--force` replaces a foreign symlink or moves a real file aside as `<name>.bak`. `mdpm skills uninstall` removes only the links this checkout created; `--target <dir>` overrides the commands directory. Start a new Claude Code session and run `/pickup my-project`. The skills call the `mdpm` CLI, so it must be on `PATH` in the shell Claude Code uses.

#### Audit-trail hooks (optional, per repo)

Instructions alone are easy to forget, so two Claude Code hooks reinforce the work-logging convention. They are **warn-only** and only act in repos registered in mdpm:

- **SessionStart** injects the work-logging reminder plus the project's open tasks into Claude's context (reads files only, ~0.1s, no server needed).
- **Stop** checks, after a turn, whether the session changed files or made commits while no task file was created or edited since the session began. If so, it shows *you* a one-line reminder, at most once per 30 minutes per session. It never blocks: a Stop hook can't add context for Claude without blocking, so the Stop warning is for you, and the SessionStart text is what reaches Claude.

```bash
mdpm init --hooks         # or, in an already registered repo: mdpm hooks install
mdpm hooks status         # SessionStart / Stop: installed or missing
mdpm hooks uninstall
```

They are written to the repo's `.claude/settings.local.json` (kept out of git through `.git/info/exclude`), merged with any hooks and settings already there, and use absolute paths to `node` and this checkout's `bin/mdpm.mjs`, since hook shells don't reliably have your `PATH`. If you move the checkout, run `mdpm hooks install` again. Restart the Claude Code session for new hooks to take effect.

### Updating and removing

```bash
cd ~/mdpm && git pull --ff-only && pnpm install && mdpm restart
```

To remove: `mdpm stop`, `pnpm remove --global mdpm`, `claude mcp remove mdpm`, `mdpm skills uninstall`, remove the `mdpm.local` hosts lines, and delete the checkout and `~/.local/state/mdpm`.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `mdpm: command not found`, or pnpm says its global bin dir "is not in PATH" | `pnpm setup`, put `$PNPM_HOME/bin` on `PATH`, open a new terminal |
| Every request takes ~5s | Missing `::1 mdpm.local` hosts line |
| `mdpm start` times out | Read `~/.local/state/mdpm/server-3333.log` |
| `cannot resolve "mdpm.local"` | Add the hosts entries (step 3), or use `MDPM_BASE_URL=http://localhost:3333` |
| `Another Nuxt dev is already running` | One dev server per checkout: `mdpm status`, then `mdpm stop` |
| `stop` says the server wasn't started by `mdpm start` | Something else holds the port; stop it yourself |
| `better-sqlite3` build or binding error | Install build tools, then `pnpm rebuild better-sqlite3` (also after switching Node versions) |
| Exit code 3 on writes | The server is down: `mdpm start`, or `--auto-start` |
| Port 3333 busy | `mdpm start --port 3344` and set `MDPM_BASE_URL=http://mdpm.local:3344` |

Not verified: a corporate proxy or private registry (set `pnpm config set registry <url>` as needed), fully offline use, and uninstall.

## CLI

`mdpm --help` and `mdpm <command> --help` list everything. Reads work without the server; writes go through it.

| Command | What it does |
|---|---|
| `mdpm start \| stop \| restart \| status` | Dev server lifecycle (`--port`, `--foreground`); `status` exits 3 when down |
| `mdpm project list \| show \| create \| set \| archive \| unarchive \| delete` | Projects (`set` updates fields, `none` clears optional ones; `delete` is permanent, prefer `archive`) |
| `mdpm task list \| search \| show \| add \| set \| done \| note \| archive \| unarchive \| delete` | Tasks; refs can be a slug, unique prefix, substring, or title fragment |
| `mdpm task ready \| graph` | Dependencies: `ready` lists todo tasks whose dependencies are all done (`--blocked` shows what each waiting task waits on); `graph` prints the whole graph (`--format text\|mermaid\|dot`) or, for one task, what it waits on and what it unblocks |
| `mdpm doc list \| show \| search` | Read docs; `doc show` prints only the body, so it pipes cleanly |
| `mdpm doc create \| edit \| archive \| unarchive \| delete` | Write docs. `create` takes `--body` (`-` for stdin), `--tags`, `--parent`, or `--edit` to compose in `$EDITOR`; `edit <ref>` opens the body in `$VISUAL`/`$EDITOR` and only sends a change if you saved one (or set fields with `--title`, `--tags`, `--parent`, `--body`); scope is `--project`, `--standalone`, or the current repo's project |
| `mdpm skills install \| uninstall \| status` | Link the Claude Code skills from this checkout into `~/.claude/commands` |
| `mdpm hooks install \| uninstall \| status` | Warn-only audit-trail hooks for Claude Code, installed per repo (see below) |
| `mdpm init` | Register the current repo: link or create its project, pin it with a `.mdpm` marker when needed, install the work-logging block into `CLAUDE.md` |
| `mdpm tui` | Interactive kanban board in the terminal (press `?` for keys): move cards between columns, change priority, mark done, add notes and tasks, filter, switch project. Updates live as files change |
| `mdpm watch` | Follow changes live as they happen, whoever makes them (the web app, the CLI, an agent, an editor, git): created, updated (with before → after), deleted, archived, new notes with their author. `--json` prints one event per line (NDJSON) for scripts and agents. Ctrl-C to stop |
| `mdpm log` | Recent activity, newest first: task notes (with author) plus tasks created or updated. Filters: `--project`/`--all`, `--since 2d` (or a date), `--author`, `--limit` |
| `mdpm export \| import` | Move data in and out: JSON (full fidelity, re-importable), CSV (tasks), markdown (readable). See below |
| `mdpm pickup [project]` | Session briefing: open tasks, docs, latest session notes, suggested focus |
| `mdpm config show` | Resolved settings and where each came from |
| `mdpm completions zsh \| bash \| fish` | Print a shell completion script (see below) |
| `mdpm ping` | Config, content, and server check |

- **Project scope:** inside a repo, commands default to that repo's project: an explicit `.mdpm` marker file (`project: <slug>`, nearest one up to the repo root) wins, otherwise matched by the `origin` remote against the project's repo links (any host: GitHub, GitHub Enterprise, GitLab, Azure DevOps, Bitbucket; compared as `owner/repo`), then by directory name equal to the project slug. `--project <slug>` always works; `--all` spans projects.
- **`mdpm init`:** run it in a repo to register it. It links the existing project (found by marker, remote, or directory name; or `--project <slug>`) or creates one (`--title`), recording the remote as a repo link for any host (through the GitHub or GitLab provider, or the generic `git` one for everything else). When nothing else would find the project (no remote, directory name differs) it writes a `.mdpm` marker and adds it to `.git/info/exclude`, so it never shows up in the repo. It then installs or refreshes the work-logging block from `templates/work-logging.md` between `<!-- mdpm:work-logging:start/end -->` markers in `CLAUDE.md` (everything outside the markers is preserved; `--local` writes `CLAUDE.local.md`, also excluded from git; `--no-claude-md`, `--no-marker`, and `--dry-run` are available). Safe to re-run.
- **Authors:** every note is stamped with who wrote it: `--author`, else `$MDPM_AUTHOR`, else `claude` when running under Claude Code, else `git config user.name`, else the OS user (MCP's `append_task_note` takes an optional `author`, default `claude`). `mdpm log` shows them; notes written before this have none. Status changes aren't recorded anywhere, so `log` shows an updated task's current status, not the transition.
- **Shell completions:** `mdpm completions <shell>` prints a script that asks the CLI itself what to offer, so subcommands and flags always match the installed version, and it completes your real data: project slugs after `--project`, task and doc refs for `task`/`doc` commands (scoped to `--project` or the current repo's project), and enum values such as `--status`. Install: zsh `mdpm completions zsh > "${fpath[1]}/_mdpm"` (or `source <(mdpm completions zsh)` after `compinit`); bash `mdpm completions bash > ~/.local/share/bash-completion/completions/mdpm`; fish `mdpm completions fish > ~/.config/fish/completions/mdpm.fish`. Open a new shell afterwards. Tested on bash (including macOS's bash 3.2) and zsh; the fish script has not been run.
- **Terminal board:** `mdpm tui [--project X]` shows the project as columns (todo, in progress, in review, done, plus blocked and on hold when used) with the selected card's details underneath. Keys: `← →`/`h l` column, `↑ ↓`/`j k` card, `H L` (or `< >`) move the card to the previous/next status, `+ -` priority, `d` done, `n` add a note (credited to you like any other note), `a` add a task in the current column, `/` filter, `p` switch project, `enter` open the card, `r` reload, `?` help, `q` quit. Writes go through the server; if it is down the status bar says so (`mdpm tui --auto-start` starts it). The board reloads whenever the files change, so edits from the web app, an agent, or `mdpm` itself appear immediately, and your cursor stays on the same card. Needs a real terminal; no extra dependencies.
- **Watching:** `mdpm watch [--project X | --all]` reads the content directory and prints an event for each change, e.g. `priority: low → medium` or `note by sam: …`. It watches the files, so it sees changes from every writer, not just the CLI. Each change is diffed against the previous state of its project (debounced ~150ms), so a note append is reported as a note, not as a rewritten description. `--json` emits NDJSON events (`kind`, `action`, `project`, `slug`, `title`, `changes`, `note`). Uses Node's recursive `fs.watch` (macOS, Linux, Windows on Node 20+).
- **Bulk operations:** `task set`, `done`, `archive`, `unarchive`, and `delete` take `--where` instead of a task, and act on every match: `mdpm task set --where "status=todo,tag=core" --priority low`. A selector is comma-joined clauses that must all hold: `field=value`, `field!=value`, or `field~text` (contains), over `status`, `priority`, `tag`, `assignee`, `title`, `slug`, `project`; `|` separates alternatives (`status=todo|blocked`). It always shows what matched and asks first (`--yes` skips the prompt and is required without a terminal; `--dry-run` only lists). Scope is `--project`, `--all`, or the repo's project, and archived tasks are skipped unless `--include-archived`. A failure on one task doesn't stop the rest: the summary lists failures and the exit code is 1. `--title` and `--description` are refused in bulk, and `task list --where` uses the same selectors.
- **Export / import:** `mdpm export [--project X | --all] [--format json|csv|markdown] [--include-archived] [--no-docs] [--out FILE]` reads the files (no server needed) and prints to stdout, so it pipes. JSON is self-describing (`format: mdpm-export`, format version 2) and carries projects, tasks, docs, and their links; CSV is tasks only (list columns use `;`, descriptions are quoted, and the `links` column holds each link's URL, or `provider:kind:ref` for one without a URL; titles are not in CSV); markdown is a readable summary. `mdpm import FILE|-` accepts an mdpm JSON export, a JSON array of tasks, or a CSV with a `title` column (plus optional `project`, `slug`, `status`, `priority`, `tags`, `assignees`, `due`, `dependencies`, `links`, `archived_at`, `description`; the old `github_issues`/`github_prs` columns and format-1 JSON files still import); the format is detected, or pass `--format`. The whole file is validated first and every problem is listed, so a bad row writes nothing. Tasks and docs that already exist (matched by slug or title) are skipped by default; `--on-exists update` overwrites them, `duplicate` creates them again. Unknown projects need `--create-projects`; `--project` is the destination for rows that name none. Slugs are kept when free, and dependencies and doc parents are re-linked afterwards, so a round trip reproduces the content. `--dry-run` shows what would happen. Creation and archive dates become the import time (the API sets them), and a failure on one item doesn't stop the rest (exit 1, listed in the summary).
- **Links:** tasks, projects, and docs carry any number of links: a URL, or a short ref the project's repo can expand (`#42`, `ABC-123`). `mdpm task link add <task> <url-or-ref> [--kind change]`, `remove` (by `@N`, URL, ref, label, or title), `list`; the same under `project` and `doc`; `task add|set --link`; `task list --linked github:change`. Providers (GitHub, GitLab, and a generic `git` one for any other host) give a link its vocabulary ("Pull request #42" vs "Merge request !9"), icon, and canonical URL; anything else is a plain link. `mdpm links resolve <input>` shows how something would be read, `mdpm links check` reports unsafe or unresolved links, and `mdpm providers list|show|validate <file>` inspects providers. The old `--github-*` flags still work and print a deprecation note; `mdpm migrate` converts older content (dry run by default).
- **Dependencies:** `task add|set --dependencies a,b` takes refs (slug, fragment, or `project/slug`; `none` clears) and stores bare slugs within a project and `project/slug` across projects. A dependency is resolved when that task is `done` or archived; one naming a task that no longer exists is reported and keeps its dependent blocked. Self-dependencies and anything that would create a cycle are refused with the cycle's path; cycles that already exist in the files are reported by `graph`.
- **Output:** add `--json` for machine-readable output; text flags accept `-` to read stdin (`mdpm task note <ref> -`).
- **Exit codes:** `0` ok, `1` error, `2` usage or ambiguous ref, `3` server unreachable, `4` not found.
- **Auto-start:** write commands accept `--auto-start`: if the server is down it is started, the write runs, and it is stopped again only if that command started it (`--keep-running` to leave it up). Make it the default with `MDPM_AUTO_START=1` or `"autoStart": true` in the config file. The MCP server honors the same setting but never stops the server.
- **Config:** precedence is flag, then environment (`MDPM_CONTENT_PATH`, `MDPM_BASE_URL`, `MDPM_AUTO_START`), then `~/.config/mdpm/config.json` (`XDG_CONFIG_HOME` and `MDPM_CONFIG` honored), then defaults derived from the checkout.

## MCP server

Lets Claude Code read and write mdpm data from any project you're working on. Registered in step 6 above.

Read tools query the markdown files directly and work without the dev server. Write tools go through the server, which must be running unless auto-start is on.

**Tools (27):** `ping` · `list_projects` · `get_project` · `create_project` · `update_project` · `archive_project` · `unarchive_project` · `delete_project` · `list_tasks` · `get_task` · `search_tasks` · `create_task` · `update_task` · `append_task_note` · `archive_task` · `unarchive_task` · `delete_task` · `list_docs` · `get_doc` · `search_docs` · `upsert_doc` · `archive_doc` · `unarchive_doc` · `delete_doc` · `add_link` · `remove_link` · `resolve_link`

CLI vs MCP: the CLI is the first-class interface and works the same for you and for agents (`--json`); the MCP server is the native tool surface inside Claude Code. Both go through the same core library.

## Claude Code skills

Global skills in `skills/`, symlinked into `~/.claude/commands/`. They run through the `mdpm` CLI.

| Skill | When |
|---|---|
| `/pickup [project]` | Start of session: briefing with open tasks, docs, last session notes |
| `/sync [project]` | Mid-session: update task statuses and write a notes snapshot |
| `/handoff [project]` | End of session: update task statuses and write a dated `session-notes` doc |
| `/start-mdpm` | Start the dev server (`mdpm start`) |
| `/stop-mdpm` | Stop the dev server (`mdpm stop`) |

Each `/handoff` writes a new doc named `YYYY-MM-DD-HHmm-session-notes`; `/pickup` loads the newest by the date in the slug.

## Development

```bash
pnpm dev             # dev server at http://mdpm.local:3333
pnpm typecheck:cli   # strict type-check of cli/, lib/, mcp/, tests/
pnpm test            # node:test smoke tests (core, CLI, lifecycle, MCP); no real server needed
```

CI runs the type-check and tests on every push and pull request. Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (checked in CI); releases are cut by release-please.

## Content structure

Everything lives in `content/`:

```
content/
  projects/
    <slug>/
      index.md        # project metadata (title, status, icon, tags, description)
      tasks/
        <slug>.md     # task (status, priority, assignees, deps, order + markdown body)
      docs/
        <slug>.md     # reference doc (title, tags + markdown body)
```

You can edit these files directly in any editor — the app picks up changes automatically.

## Deployment

Deployed via Railway. Requires a persistent volume mounted at `/app/content` so data survives deploys.

```toml
# railway.toml
[deploy]
startCommand = "node .output/server/index.mjs"
healthcheckPath = "/"
restartPolicyType = "on_failure"
```

Required env vars on Railway:
- `NODE_ENV=production` — enables hourly demo reset + auto-seed on empty volume
