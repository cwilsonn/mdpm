# Installing mdpm on a new machine

mdpm is a local-first project manager. Projects, tasks, and docs are plain markdown files on disk, a Nuxt web app shows them at `http://mdpm.local:3333`, a CLI (`mdpm`) and an MCP server let you and Claude Code work with them from the terminal.

Everything here was tested from a fresh clone of `main` (v0.3.0) on macOS: clone, install, cold start, create project/task, MCP connection, `--auto-start`, and the 83-test suite. Linux is expected to behave the same but was only exercised through CI (Ubuntu: install, type-check, tests). See [Not tested](#not-tested).

## 0. Read this first (work machines)

- **The repo is public** (`github.com/cwilsonn/mdpm`), so cloning needs no credentials. Your work data must never go into it.
- **Project data is safe by default:** `content/projects/*/` and `content/authors/*.md` are gitignored. But **`content/docs/` is tracked**: standalone docs created in the app land there and would show up as changes in `git status`. Keep work notes in *project* docs, and disable pushing from the work checkout (step 2) so nothing can leak by accident.
- **No authentication.** The dev server listens on loopback only (`mdpm.local` → `127.0.0.1`/`::1`). Never expose it (no tunnels, no `--host 0.0.0.0`, no port forwarding).
- **Check policy first:** installing third-party tooling and running a local web app may need approval on a managed VM.
- **Platform:** macOS or Linux (WSL2 counts as Linux). Native Windows is not supported: the lifecycle commands use POSIX process groups.

## 1. Prerequisites

| Need | Notes |
|------|-------|
| Node **24** | `.nvmrc` pins it. Use `nvm install 24` (or fnm / your approved distribution). |
| pnpm **11.22.0** | pinned by `packageManager` in `package.json`. |
| git | |
| sudo / admin | once, to edit `/etc/hosts`. |
| Claude Code | optional, only for the MCP server and `/pickup`, `/handoff` skills. |
| Build tools | only if `better-sqlite3` has no prebuilt binary for your OS: `build-essential` + `python3` on Debian/Ubuntu, Xcode CLT on macOS. |

```sh
node --version        # v24.x
corepack enable       # Node 24 ships corepack; pnpm is then fetched per packageManager
pnpm --version        # 11.22.0
```

No corepack? `npm install -g pnpm@11.22.0` works too.

## 2. Clone and install

```sh
git clone https://github.com/cwilsonn/mdpm.git ~/mdpm
cd ~/mdpm
git remote set-url --push origin no_push     # work checkout: make pushing impossible
pnpm install
```

`pnpm install` runs `nuxt prepare` and builds `better-sqlite3`; about 10 seconds on a warm cache.

Optional on a work machine: Nuxt can send anonymous telemetry. Nuxt documents `NUXT_TELEMETRY_DISABLED=1` to turn it off; put it in your shell profile so `mdpm start` inherits it (not verified here).

```sh
echo 'export NUXT_TELEMETRY_DISABLED=1' >> ~/.zshrc     # or ~/.bashrc
```

## 3. Hosts entries (needs sudo)

The dev server is hard-wired to the hostname `mdpm.local`. Add **both** lines (the `::1` one removes a roughly 5-second delay per request on macOS, where `.local` names otherwise go through mDNS):

```sh
grep -q 'mdpm.local' /etc/hosts || printf '127.0.0.1 mdpm.local\n::1 mdpm.local\n' | sudo tee -a /etc/hosts
```

Check: `ping -c1 mdpm.local` should answer from `127.0.0.1` or `::1`.

WSL2: if your browser runs on Windows, also add `127.0.0.1 mdpm.local` to `C:\Windows\System32\drivers\etc\hosts` (edit as Administrator), so the name resolves there too. Keep the repo in the Linux filesystem (`~/mdpm`), not under `/mnt/c`. Untested.

No admin rights? Then the server can't be reached by that name today. See [Not tested](#not-tested).

## 4. Install the CLI

pnpm 11 refuses to install global binaries until its global bin directory is on `PATH`, so set that up first:

```sh
pnpm setup             # adds PNPM_HOME to your shell profile
```

Open a **new terminal** (or `source` your profile), then:

```sh
cd ~/mdpm
pnpm add --global "link:$(pwd)"
hash -r; which mdpm && mdpm --version      # 0.3.0
```

This links the checkout live: a later `git pull` updates the CLI with no reinstall. (pnpm 11 removed bare `pnpm link --global`.)

If `mdpm: command not found` persists, pnpm 11 puts the binary in `$PNPM_HOME/bin` (for example `~/Library/pnpm/bin` on macOS); make sure that directory, not just `$PNPM_HOME`, is on `PATH`. A plain symlink is an equivalent fallback (the entry file is executable and resolves its own location):

```sh
mkdir -p ~/.local/bin && ln -s ~/mdpm/bin/mdpm.mjs ~/.local/bin/mdpm    # ensure ~/.local/bin is on PATH
```

## 5. First run

```sh
mdpm ping        # content path, project count, "server down" is expected
mdpm start       # background dev server; first start takes up to about 30s
mdpm status      # running, pid, uptime, log path
```

Open <http://mdpm.local:3333>. A fresh install has **no projects** (your personal projects don't travel; content is per machine).

Create your work project and a first task:

```sh
mdpm project create "My Work Project" --description "What this is" --tags work
mdpm task add "First task" --project my-work-project --priority high
mdpm task list --project my-work-project
mdpm pickup my-work-project
```

Stop it any time with `mdpm stop`. Logs live in `~/.local/state/mdpm/server-3333.log`.

### Do not change the content path

The web app and API always read and write `<checkout>/content`. They ignore `MDPM_CONTENT_PATH` and the `contentPath` config key, which only affect the CLI and MCP. If you point those elsewhere, writes go to one place and reads come from another (verified: a project created via the server was invisible to a CLI pointed at another directory). Leave the defaults alone.

## 6. Claude Code integration (optional)

**MCP server** (so Claude can read/write projects, tasks, docs). No environment variables are needed; defaults resolve from the checkout:

```sh
cd ~/mdpm
claude mcp add mdpm --scope user -- "$PWD/node_modules/.bin/tsx" "$PWD/mcp/index.ts"
claude mcp list          # mdpm: ... ✔ Connected
```

Writes through MCP need the server running. To have it start on demand, set `MDPM_AUTO_START=1` for the MCP server (`-e MDPM_AUTO_START=1` on `claude mcp add`) or `"autoStart": true` in the config file below. The MCP server never stops it again.

**Skills** (`/pickup`, `/sync`, `/handoff`, `/start-mdpm`, `/stop-mdpm`), symlinked so they update with `git pull`:

```sh
mkdir -p ~/.claude/commands
for f in ~/mdpm/skills/*.md; do ln -s "$f" ~/.claude/commands/"$(basename "$f")"; done
```

`ln` refuses to overwrite an existing file of the same name; resolve any conflict by hand. Start a new Claude Code session, then `/pickup my-work-project`. The skills call the `mdpm` CLI, so it must be on `PATH` in the shell Claude Code uses.

## 7. Optional configuration

`~/.config/mdpm/config.json` (or `$XDG_CONFIG_HOME`; `MDPM_CONFIG` overrides the path):

```json
{ "autoStart": true }
```

With `autoStart`, any CLI write that finds the server down starts it, runs, and stops it again (`--keep-running` to leave it up). Precedence for every setting is flag, then environment (`MDPM_*`), then this file, then defaults. `mdpm config show` prints every resolved value and where it came from.

### Projects and repo detection

Inside a repo, commands default to that repo's project. Detection matches the `origin` remote against the project's `githubRepo`, then falls back to the directory name equal to the project slug. **Only `github.com` remotes are recognised.** For GitLab, Azure DevOps, or GitHub Enterprise, either name the project so its slug equals the repo's directory name, or pass `--project <slug>` (always works). `mdpm config show` inside the repo tells you what it detected.

## 8. Day to day

```sh
mdpm start                       # or rely on autoStart
mdpm task list                   # current repo's project
mdpm task add "Title" --priority high --tags infra
mdpm task set <fragment> --status in-progress
mdpm task note <fragment> "what changed and why"
mdpm task done <fragment>
mdpm doc list / show / search
mdpm pickup                      # session briefing
mdpm --help                      # and `mdpm <command> --help`
```

Exit codes scripts can rely on: `0` ok, `1` error, `2` usage/ambiguous ref, `3` server unreachable, `4` not found.

**Backups:** your data is the files under `~/mdpm/content/projects/`. Back them up however your organisation allows. If an internal git host is permitted, a nested repo works cleanly because that path is ignored by the mdpm repo: `cd ~/mdpm/content/projects/my-work-project && git init` and add your internal remote there.

## 9. Updating and removing

```sh
cd ~/mdpm && git pull --ff-only && pnpm install && mdpm restart
```

Remove: `mdpm stop`; `pnpm remove --global mdpm` (or delete the `mdpm` link in the global bin directory); `claude mcp remove mdpm`; delete the symlinks in `~/.claude/commands/`; remove the `mdpm.local` lines from `/etc/hosts`; delete `~/mdpm` and `~/.local/state/mdpm`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `mdpm: command not found`, or pnpm says the global bin directory "is not in PATH" | Run `pnpm setup`, add `$PNPM_HOME/bin` to `PATH` (step 4), open a new terminal. |
| Every request takes about 5s | Missing `::1 mdpm.local` line (step 3). |
| `start` times out | Read `~/.local/state/mdpm/server-3333.log`. |
| `Another Nuxt dev is already running` | One dev server per checkout. `mdpm status`, then `mdpm stop`. |
| `server ... wasn't started by mdpm start` on `stop` | Something else holds the port; stop it yourself (`lsof -nP -iTCP:3333 -sTCP:LISTEN`). |
| `better-sqlite3` build/binding error | Install build tools, then `pnpm rebuild better-sqlite3`. After switching Node versions run it too. |
| Exit 3 on writes | Server is down: `mdpm start`, or use `--auto-start`. |
| Port 3333 busy | `mdpm start --port 3344` (and set `MDPM_BASE_URL=http://mdpm.local:3344`). |

## Not tested

- Linux beyond CI (install, type-check, tests on Ubuntu). The hosts file and the native module build were only exercised on macOS. `pnpm setup` was not verified: it refused to run on the author's machine because of a custom pnpm block in the shell profile.
- Behind a corporate proxy or with a private npm registry: set `pnpm config set registry <url>` and proxy variables as your network requires. A blocked `better-sqlite3` prebuilt download falls back to compiling (build tools above).
- Uninstall steps and the telemetry variable (documented by Nuxt, not exercised here).
- Fully offline use after install. The first dev run may try to fetch assets such as fonts; not verified either way.
- No-admin setups: the hostname is fixed in `nuxt.config.ts` (`devServer.host`), so without the hosts entry the server can't bind. A configurable host would be a small change; ask before relying on this.
- WSL2 specifically (treated as Linux); native Windows is unsupported.
