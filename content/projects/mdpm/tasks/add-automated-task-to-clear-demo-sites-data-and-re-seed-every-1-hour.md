---
title: Deploy to Railway with demo reset + hard limits
status: done
priority: high
tags: []
assignees:
  - Cody Wilson
due: '2026-06-05'
dependencies:
  - mvp-functionality
createdAt: '2026-06-05'
order: 5
updatedAt: '2026-06-06T04:59:12.725Z'
---
## Goal

Deploy mdpm to Railway as a persistent Node server with an hourly data reset and hard limits to prevent abuse on the public demo.

---

## 1. Railway setup

- Create Railway project, connect GitHub repo
- Add a persistent volume mounted at `/app/content` — this is what survives redeploys; without it, `content/` resets to git state on every deploy (acceptable for seed state but not for in-flight demo data)
- Set `NODE_ENV=production` and any other required env vars in Railway dashboard
- Confirm build command: `pnpm build`, start command: `node .output/server/index.mjs`

### `railway.toml`

```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "node .output/server/index.mjs"
healthcheckPath = "/"
restartPolicyType = "on_failure"
```

---

## 2. Seed script

Create `server/utils/seed.ts` — populates `content/` with a baseline set of demo projects and tasks if the directory is empty or after a reset.

- 2–3 demo projects with varied statuses and icons
- 4–6 tasks per project spread across statuses
- One demo author entry

Seed should be idempotent — safe to call multiple times.

---

## 3. Nitro scheduled task (hourly reset)

- See: [https://nitro.build/docs/tasks](https://nitro.build/docs/tasks)
- Create `server/tasks/reset.ts`
- Schedule: `0 * * * *` (every hour on the hour)
- Steps:
  1. Delete all content under `content/projects/` and `content/authors/`
  2. Run seed
- Enable scheduled tasks in `nuxt.config.ts`:

```ts
nitro: {
  experimental: {
    tasks: true
  },
  scheduledTasks: {
    '0 * * * *': ['reset']
  }
}
```

---

## 4. API hard limits

Enforce in the relevant `server/api/` POST handlers before writing:

Return `429` with a clear message when limit is hit. Display the error in the UI via the existing `UAlert` pattern in forms.

---

## 5. Pre-deploy checklist

- \`better-sqlite3\` Node version mismatch resolved (currently fails on build — needs \`pnpm rebuild\` or Node version pin in Railway)
- Seed script tested locally via \`npx nitro task run reset\`
- Hard limits tested in all create endpoints
- Volume mount confirmed — deploy, create a project, redeploy, verify project persists
- Hourly reset confirmed firing in Railway logs
