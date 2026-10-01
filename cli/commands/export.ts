import { existsSync, writeFileSync } from 'node:fs'
import { defineCommand } from 'citty'
import { buildExport, toCsv, toMarkdown } from '../../lib/core'
import { createContext, globalArgs } from '../context'
import { CliError, ExitCode } from '../output'

const FORMATS = ['json', 'csv', 'markdown'] as const

export default defineCommand({
  meta: { name: 'export', description: 'Export projects, tasks, and docs as JSON (re-importable), CSV (tasks), or markdown. Reads files; no server needed' },
  args: {
    ...globalArgs,
    project: { type: 'string', description: 'Export just this project (default: the current repo\'s project, else everything)' },
    all: { type: 'boolean', description: 'Everything: every project plus standalone docs', default: false },
    format: { type: 'string', description: `${FORMATS.join(' | ')} (default: json)` },
    'include-archived': { type: 'boolean', description: 'Include archived projects, tasks, and docs', default: false },
    docs: { type: 'boolean', description: 'Include docs (--no-docs to leave them out; CSV never has docs)', default: true },
    out: { type: 'string', description: 'Write to this file instead of stdout' },
    force: { type: 'boolean', description: 'Overwrite --out if it exists', default: false },
  },
  run({ args }) {
    const ctx = createContext(args)
    const format = (args.format ?? 'json') as typeof FORMATS[number]
    if (!FORMATS.includes(format)) throw new CliError(`--format: '${args.format}' is not one of ${FORMATS.join(', ')}`, ExitCode.usage)
    const project = args.project ? ctx.core.getProject(args.project).slug : args.all ? undefined : ctx.inferProject()?.slug
    const doc = buildExport(ctx.core, { project, includeArchived: args['include-archived'], docs: args.docs })
    const text = format === 'json' ? `${JSON.stringify(doc, null, 2)}\n` : format === 'csv' ? toCsv(doc) : toMarkdown(doc)

    if (!args.out) {
      process.stdout.write(text)
      return
    }
    if (existsSync(args.out) && !args.force) throw new CliError(`${args.out} already exists; pass --force to overwrite it`, ExitCode.usage)
    writeFileSync(args.out, text)
    const tasks = doc.projects.reduce((n, p) => n + p.tasks.length, 0)
    const docs = doc.projects.reduce((n, p) => n + p.docs.length, 0) + doc.standaloneDocs.length
    console.error(`${ctx.style.green('✓')} wrote ${args.out}: ${doc.projects.length} project${doc.projects.length === 1 ? '' : 's'}, ${tasks} task${tasks === 1 ? '' : 's'}${format === 'csv' ? '' : `, ${docs} doc${docs === 1 ? '' : 's'}`}`)
  },
})
