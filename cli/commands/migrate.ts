import { defineCommand } from 'citty'
import { applyMigration, MigrationError, pendingSummary, planMigration, schemaStatus, type PlanEntry } from '../../lib/core'
import { createContext, globalArgs } from '../context'
import { CliError, emit, ExitCode } from '../output'

export default defineCommand({
  meta: { name: 'migrate', description: 'Bring content to the current schema: links leave frontmatter (task/doc links and GitHub issue/PR numbers become a Links section, a project repo becomes `repo:`), and task notes move out of the body into tasks/notes/<slug>.md. Dry run unless --apply; reads and writes files, no server needed' },
  args: {
    ...globalArgs,
    apply: { type: 'boolean', description: 'Write the changes (default is a dry run that shows them)', default: false },
    file: { type: 'string', description: 'Only this file (a project index, task or doc .md)' },
    project: { type: 'string', description: 'Only this project' },
    // citty reads `--no-backup` as `backup: false`, so the flag is declared positively.
    backup: { type: 'boolean', description: 'Back up the content directory before --apply writes (--no-backup skips it)', default: true },
    check: { type: 'boolean', description: 'Exit 1 when a migration is pending (for scripts and CI); writes nothing', default: false },
  },
  run({ args }) {
    const ctx = createContext(args)
    const root = ctx.loadedConfig.config.contentPath
    const { style } = ctx

    let plan
    try {
      plan = planMigration(root, { file: args.file, project: args.project })
    }
    catch (err) {
      if (err instanceof MigrationError) throw new CliError(err.message, ExitCode.usage)
      throw err
    }
    const pending = plan.entries.filter(e => e.newText !== undefined || e.remove)

    if (args.check) {
      const status = schemaStatus(root)
      emit(ctx.json, { pending: status.pendingFiles > 0, ...status }, () => status.pendingFiles
        ? `${style.yellow('!')} ${pendingSummary(status.pendingBy)}; run \`mdpm migrate\``
        : `${style.green('✓')} content is up to date`)
      if (status.pendingFiles) process.exitCode = ExitCode.error
      return
    }

    const result = args.apply ? applyMigration(plan, { backup: args.backup !== false }) : undefined

    emit(ctx.json, {
      dryRun: !args.apply,
      contentRoot: root,
      scanned: plan.scanned,
      files: plan.entries.map(({ newText: _, sidecar, basis: __, ...e }) => ({ ...e, ...(sidecar && { notesFile: sidecar.file }) })),
      ...(result && { applied: result.applied, backupDir: result.backupDir ?? null, stamped: result.stamped }),
    }, () => {
      const lines: string[] = []
      const show = (e: PlanEntry) => {
        lines.push(`${e.error ? style.red('✗') : style.cyan('•')} ${e.file} ${style.dim(`(${e.kind})`)}`)
        for (const c of e.changes) lines.push(`    ${c}`)
        for (const u of e.unresolved) lines.push(`    ${style.yellow('!')} ${u}`)
        if (e.error) lines.push(`    ${style.red(e.error)}`)
      }
      plan.entries.forEach(show)
      if (!plan.entries.length) lines.push(`${style.green('✓')} nothing to migrate (${plan.scanned} files checked)`)
      else if (result) {
        lines.push('', `${style.green('✓')} migrated ${result.applied.length} file(s)${result.backupDir ? `; backup: ${result.backupDir}` : ''}${result.stamped ? '' : ' (marker not written: other files are still pending)'}`)
      }
      else if (pending.length) {
        lines.push('', `${pending.length} of ${plan.scanned} file(s) would change. Re-run with ${style.bold('--apply')} to write them (a backup is taken first).`)
      }
      return lines.join('\n')
    })
  },
})
