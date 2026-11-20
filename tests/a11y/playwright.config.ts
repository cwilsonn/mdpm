// Accessibility gate: axe-core scans of the production build, served on a throwaway copy of the test fixtures.
// Run with `pnpm test:a11y` (builds first). Never points at real content and never sets MDPM_DEMO.
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const root = resolve(import.meta.dirname, '../..')
const port = Number(process.env.A11Y_PORT ?? 3399)
const baseURL = `http://127.0.0.1:${port}`
const content = join(root, 'node_modules/.cache/mdpm-a11y/content')

// Fresh copy per run, made once by the runner process (workers load this file too, but don't need the copy).
if (process.env.TEST_WORKER_INDEX === undefined) {
  rmSync(content, { recursive: true, force: true })
  cpSync(join(root, 'tests/fixtures/content'), content, { recursive: true })
  // The fixtures are hand-written with bare YAML dates, which parse as Date objects; mdpm itself writes quoted
  // strings. The doc list routes sort with localeCompare and fail on a Date (a separate bug), so quote them here
  // to give the scans real doc lists to look at.
  for (const entry of readdirSync(content, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const file = join(entry.parentPath, entry.name)
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^(\w+At|due): (\d{4}-\d{2}-\d{2})$/gm, "$1: '$2'"))
  }
}

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  outputDir: join(root, 'node_modules/.cache/mdpm-a11y/results'),
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
    // Page scans at phone width: the mobile breadcrumb, back button and three-dots menu only render there.
    { name: 'mobile', use: { ...devices['Pixel 7'], colorScheme: 'light' } },
  ],
  webServer: {
    command: 'node .output/server/index.mjs',
    cwd: root,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(port),
      HOST: '127.0.0.1',
      MDPM_CONTENT_PATH: content,
      MDPM_BASE_URL: baseURL,
    },
  },
})
