import { readFileSync } from 'node:fs'
import { defineCommand } from 'citty'
import { ImportError, parseImport, runImport, type ImportStep, type OnExists } from '../../lib/core'
import { createContext, globalArgs, writeArgs } from '../context'
import { readStdin } from '../io'
import { CliError, emit, ExitCode, table } from '../output'

const ON_EXISTS = ['skip', 'update', 'duplicate'] as const

export default defineCommand({
  meta: { name: 'import', description: 'Import tasks and docs from an mdpm JSON export, a JSON array of tasks, or a CSV of tasks (writes via the server)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    file: { type: 'positional', description: 'Path to the file, or - for stdin', required: true },
    project: { type: 'string', description: 'Destination for tasks that name no project (default: the current repo\'s project)' },
    format: { type: 'string', description: 'json | csv (default: detected from the content)' },
    'create-projects': { type: 'boolean', description: 'Create projects that do not exist yet', default: false },
    'on-exists': { type: 'string', description: `What to do with a task or doc that already exists, matched by slug or title: ${ON_EXISTS.join(' | ')} (default: skip)` },
    docs: { type: 'boolean', description: 'Import docs too (--no-docs to skip them)', default: true },
    'dry-run': { type: 'boolean', description: 'Validate and show what would happen without writing anything', default: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const onExists = (args['on-exists'] ?? 'skip') as OnExists
    if (!ON_EXISTS.includes(onExists)) throw new CliError(`--on-exists: '${args['on-exists']}' is not one of ${ON_EXISTS.join(', ')}`, ExitCode.usage)
    if (args.format && !['json', 'csv'].includes(args.format)) throw new CliError(`--format: '${args.format}' is not json or csv`, ExitCode.usage)

    let text: string
    try { text = args.file === '-' ? await readStdin() : readFileSync(args.file, 'utf8') }
    catch (err) {
      if (err instanceof CliError) throw err
      throw new CliError(`cannot read ${args.file}: ${(err as NodeJS.ErrnoException).code === 'ENOENT' ? 'no such file' : (err as Error).message}`, ExitCode.usage)
    }

    const project = args.project ? ctx.core.getProject(args.project).slug : ctx.inferProject()?.slug
    const data = parseImport(text, { format: args.format, project })
    const steps = await runImport(ctx.core, data, { createProjects: args['create-projects'], onExists, docs: args.docs, dryRun: args['dry-run'] })

    const failed = steps.filter(s => s.action === 'failed')
    const count = (kind: ImportStep['kind'], action: ImportStep['action']) => steps.filter(s => s.kind === kind && s.action === action).length
    const dry = args['dry-run']
    emit(ctx.json, { dryRun: !!dry, steps, failed: failed.length }, () => {
      const rows = (['project', 'task', 'doc'] as const)
        .filter(kind => steps.some(s => s.kind === kind))
        .map(kind => [kind, String(count(kind, 'create')), String(count(kind, 'update')), String(count(kind, 'skip') + count(kind, 'exists')), String(count(kind, 'failed'))])
      return [
        dry ? ctx.style.yellow('dry run: nothing was written') : '',
        rows.length ? table(rows, ['', dry ? 'WOULD CREATE' : 'CREATED', dry ? 'WOULD UPDATE' : 'UPDATED', 'SKIPPED', 'FAILED']) : ctx.style.dim('nothing to import'),
        ...failed.map(f => `${ctx.style.red('✗')} ${f.kind} ${f.project ? `${f.project}/` : ''}${f.key}: ${f.error}`),
      ].filter(Boolean).join('\n')
    })
    if (failed.length) process.exitCode = ExitCode.error
  },
})
