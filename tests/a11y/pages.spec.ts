// axe-core scans of every page and of the overlays a page can open (axe only sees what is rendered). Overlay scans
// are limited to the overlay: the page under it is scanned on its own, and while a modal is open Reka marks the
// rest of the page aria-hidden, which page-level rules would report again.
// A violation fails the run unless its rule is in ALLOWED below, which holds only rules with an open decision.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

// Known violations, tolerated until decided. Each entry names one rule and a substring of the offending nodes'
// HTML, so a new instance of the same rule elsewhere still fails. Every entry is an open decision in the mdpm task
// "Accessibility audit and CI enforcement": delete it once the decision lands.
const ALLOWED: { rule: string, html?: string, theme?: 'light' | 'dark', why: string }[] = [
  {
    rule: 'aria-allowed-attr',
    html: 'data-slot="linkTrailing"',
    why: 'Nuxt UI bug: a vertical UNavigationMenu with children puts aria-expanded on a non-focusable <span> (the '
      + 'chevron, a Reka AccordionTrigger). Upstream; the sidebar Projects group is affected.',
  },
  {
    rule: 'color-contrast',
    theme: 'light',
    why: 'Light theme only: Nuxt UI renders primary and semantic colors at shade 500 (emerald-500 on white is 2.5:1), '
      + 'and text-muted on the sidebar is 4.43:1. Fixing it means choosing darker light-mode shades: a design decision.',
  },
]

function isAllowed(rule: string, html: string) {
  const theme = test.info().project.use.colorScheme
  return ALLOWED.some(a => a.rule === rule && (!a.html || html.includes(a.html)) && (!a.theme || a.theme === theme))
}

// Load a page and wait until Vue has mounted (clicks before that do nothing) and no list is still loading.
// Not 'networkidle': the live-update stream (/api/events) stays open, so the network is never idle.
async function visit(page: Page, path: string) {
  await page.goto(path)
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__)
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
}

async function scan(page: Page, name: string, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(TAGS)
  if (include) builder = builder.include(include)
  const { violations } = await builder.analyze()

  const report = violations.map(v => ({
    rule: v.id,
    impact: v.impact,
    allowed: v.nodes.every(n => isAllowed(v.id, n.html)),
    help: v.help,
    targets: v.nodes.map(n => n.target.join(' ')),
    html: v.nodes.map(n => n.html.slice(0, 300)),
    summary: v.nodes.map(n => n.failureSummary ?? ''),
  }))
  const body = JSON.stringify(report, null, 2)
  await test.info().attach(`axe-${name}.json`, { body, contentType: 'application/json' })
  if (process.env.A11Y_DUMP) writeFileSync(join(process.env.A11Y_DUMP, `${test.info().project.name}-${name}.json`), body)
  for (const r of report.filter(r => r.allowed)) console.warn(`[a11y] allowed ${r.rule} on ${name}: ${r.targets.length} node(s)`)

  const failing = report.filter(r => !r.allowed)
  expect(failing, `${name}:\n${failing.map(r => `- ${r.rule} (${r.impact}) ${r.help}\n    ${r.targets.join('\n    ')}`).join('\n')}`).toEqual([])
}

const pages: [string, string][] = [
  ['projects', '/projects'],
  ['inbox', '/inbox'],
  ['docs', '/docs'],
  ['standalone-doc', '/docs/standalone-guide'],
  ['project-tasks', '/projects/alpha/tasks'],
  ['project-docs', '/projects/alpha/docs'],
  ['project-doc', '/projects/alpha/docs/architecture'],
  ['task', '/projects/alpha/tasks/fix-login-bug'],
]

// The rest drives desktop-only controls (the mobile layout hides them behind the three-dots menu).
const desktopOnly = () => test.skip(test.info().project.name === 'mobile', 'desktop layout only')

for (const [name, path] of pages) {
  test(`page: ${name}`, async ({ page }) => {
    await visit(page, path)
    await scan(page, name)
  })
}

test('page: project tasks, list view', async ({ page }) => {
  desktopOnly()
  await visit(page, '/projects/alpha/tasks')
  await page.getByRole('button', { name: 'List view' }).click()
  await scan(page, 'project-tasks-list')
})

test('page: collapsed sidebar', async ({ page }) => {
  desktopOnly()
  await visit(page, '/projects')
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await page.getByRole('button', { name: 'Expand sidebar' }).waitFor()
  await scan(page, 'collapsed-sidebar')
})

test('overlay: task form', async ({ page }) => {
  desktopOnly()
  await visit(page, '/projects/alpha/tasks')
  await page.getByRole('button', { name: 'New Task' }).click()
  await page.getByRole('dialog').waitFor()
  await scan(page, 'task-form', '[role="dialog"]')
})

test('overlay: edit task form', async ({ page }) => {
  desktopOnly()
  await visit(page, '/projects/alpha/tasks')
  await page.getByText('Fix login bug').first().click()
  await page.getByRole('dialog').waitFor()
  await scan(page, 'edit-task-form', '[role="dialog"]')
})

test('overlay: project form', async ({ page }) => {
  desktopOnly()
  await visit(page, '/projects')
  await page.getByRole('button', { name: 'Actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New Project' }).click()
  await page.getByRole('dialog').waitFor()
  await scan(page, 'project-form', '[role="dialog"]')
})

test('overlay: confirm dialog', async ({ page }) => {
  desktopOnly()
  await visit(page, '/projects/alpha/tasks/fix-login-bug')
  await page.getByRole('button', { name: 'Delete task' }).click()
  await page.getByRole('dialog', { name: 'Delete task?' }).waitFor()
  await scan(page, 'confirm-dialog', '[role="dialog"]')
})

test('overlay: command palette', async ({ page }) => {
  desktopOnly()
  await visit(page, '/projects')
  await page.getByRole('button', { name: /^Search/ }).first().click()
  await page.getByRole('dialog').waitFor()
  await scan(page, 'command-palette', '[role="dialog"]')
})

test('overlay: filter menu', async ({ page }) => {
  desktopOnly()
  await visit(page, '/inbox')
  await page.getByRole('button', { name: /^Priority/ }).click()
  await page.getByRole('menu').waitFor()
  await scan(page, 'filter-menu', '[role="menu"]')
})
