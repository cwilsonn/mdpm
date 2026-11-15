import { resolve } from 'node:path'
import { defineCommand } from 'citty'
import { checkStaleness, createGitRepo, defaultBranch, gitToplevel, inferProject, STALE_KINDS, type StaleKind } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { CliError, emit, ExitCode, table } from '../../output'
import { projectArgs, requireProject } from './shared'

const HINT: Record<StaleKind, string> = {
  landed: 'open, but cites commits on the branch: done?',
  unverified: 'done, but none of its commits are on the branch',
  rewritten: 'cites a pre-rebase SHA; cite the branch one',
}

export default defineCommand({
  meta: { name: 'stale', description: 'Cross-check the commits tasks cite against git: open tasks whose work landed, done tasks whose commits never did, pre-rebase SHAs' },
  args: {
    ...globalArgs,
    ...projectArgs,
    repo: { type: 'string', description: 'Checkout to check against (default: the current repo, which must be the project\'s)' },
    branch: { type: 'string', description: 'Branch the work lands on (default: origin/main, origin/master, main or master)' },
    kind: { type: 'string', description: `Only these findings, comma-separated: ${STALE_KINDS.join(', ')}` },
    archived: { type: 'boolean', description: 'Include archived tasks', default: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const project = requireProject(ctx, args)

    const repo = gitToplevel(resolve(args.repo ?? process.cwd()))
    if (!repo) throw new CliError(`not a git repository: ${args.repo ?? process.cwd()} (pass --repo <checkout>)`, ExitCode.usage)
    // Checking one project's claims against another project's history would report nonsense.
    if (!args.repo) {
      const here = inferProject(repo, ctx.core.listProjects({ includeArchived: true }))
      if (here?.slug !== project) throw new CliError(`${repo} is ${here ? `project '${here.slug}'` : 'not a registered project'}, not '${project}': run inside its checkout or pass --repo`, ExitCode.usage)
    }
    const branch = args.branch ?? defaultBranch(repo)
    if (!branch) throw new CliError(`no default branch found in ${repo}: pass --branch`, ExitCode.usage)

    const kinds = args.kind ? args.kind.split(',').map(k => k.trim()).filter(Boolean) : [...STALE_KINDS]
    const unknown = kinds.filter(k => !STALE_KINDS.includes(k as StaleKind))
    if (unknown.length) throw new CliError(`unknown --kind: ${unknown.join(', ')} (one of ${STALE_KINDS.join(', ')})`, ExitCode.usage)

    const tasks = ctx.core.listTasks({ project, includeArchived: args.archived, notes: true })
    let findings
    try {
      findings = checkStaleness(tasks, createGitRepo(repo, branch))
    }
    catch {
      throw new CliError(`git failed in ${repo} (branch ${branch})`)
    }
    findings = findings.filter(f => kinds.includes(f.kind))

    emit(ctx.json, { branch, repo, findings }, () => findings.length
      ? `${table(findings.map(f => [f.kind, f.status, f.slug, f.cited.join(','), f.onBranch.join(','), HINT[f.kind]]), ['KIND', 'STATUS', 'TASK', 'CITED', `ON ${branch}`, 'MEANING'])}\n${ctx.style.dim(`${findings.length} finding${findings.length === 1 ? '' : 's'} against ${branch}`)}`
      : ctx.style.dim(`nothing stale against ${branch}`))
  },
})
