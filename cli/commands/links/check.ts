import { defineCommand } from 'citty'
import { builtinRegistry, validateLinks, viewLink, type Link } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { emit, ExitCode } from '../../output'

interface Problem {
  where: string
  problem: string
}

export default defineCommand({
  meta: { name: 'check', description: 'Report stored links with problems: no URL, unsafe or invalid, or from a provider that is not installed (exit 1 if any)' },
  args: {
    ...globalArgs,
    project: { type: 'string', description: 'Only this project (default: everything)' },
    'include-archived': { type: 'boolean', description: 'Include archived projects, tasks, and docs', default: false },
  },
  run({ args }) {
    const ctx = createContext(args)
    const registry = builtinRegistry()
    const includeArchived = !!args['include-archived']
    const slug = args.project ? ctx.core.resolveProject(args.project).slug : undefined
    const problems: Problem[] = []
    let checked = 0

    const check = (where: string, links: unknown) => {
      if (!Array.isArray(links) || !links.length) return
      checked += links.length
      const invalid = validateLinks(links, registry.schemes())
      for (const issue of invalid) problems.push({ where, problem: issue })
      const flagged = new Set(invalid.map(i => /^links\[(\d+)\]/.exec(i)?.[1]))
      ;(links as Link[]).forEach((link, i) => {
        if (link.provider && !registry.get(link.provider)) problems.push({ where, problem: `links[${i}]: provider "${link.provider}" is not installed (shown as a plain link)` })
        if (!flagged.has(String(i)) && !viewLink(registry, link).href) problems.push({ where, problem: `links[${i}]: ${link.ref ? `"${link.ref}" ` : ''}has no usable URL` })
      })
    }

    for (const p of ctx.core.listProjects({ includeArchived })) {
      if (slug && p.slug !== slug) continue
      check(p.slug, p.links)
      for (const t of ctx.core.listTasks({ project: p.slug, includeArchived })) check(`${p.slug}/${t.slug}`, t.links)
      for (const d of ctx.core.listDocs({ project: p.slug, includeArchived })) check(`${p.slug}/docs/${d.slug}`, d.links)
    }
    if (!slug) for (const d of ctx.core.listDocs({ standalone: true, includeArchived })) check(`docs/${d.slug}`, d.links)

    emit(ctx.json, { checked, problems }, () => problems.length
      ? `${problems.map(p => `${ctx.style.yellow('!')} ${p.where}: ${p.problem}`).join('\n')}\n${ctx.style.dim(`${problems.length} problem${problems.length === 1 ? '' : 's'} in ${checked} links`)}`
      : `${ctx.style.green('✓')} ${checked} links, no problems`)
    if (problems.length) process.exitCode = ExitCode.error
  },
})
