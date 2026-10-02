import { defineCommand } from 'citty'
import { applyMigration, MigrationError, planMigration, schemaStatus, type PlanEntry } from '../../lib/core'
import { createContext, globalArgs } from '../context'
import { CliError, emit, ExitCode } from '../output'

export default defineCommand({
  meta: { name: 'migrate', description: 'Convert legacy GitHub fields (githubRepo/githubIssues/githubPRs) to links. Dry run unless --apply; reads and writes files, no server needed' },
  args: {
    ...globalArgs,
    apply: { type: 'boolean', description: 'Write the changes (default is a dry run that shows them)', default: false },
    file: { type: 'string', description: 'Only this file (a project index or task .md)' },
    project: { type: 'string', description: 'Only this project' },
    'no-backup': { type: 'boolean', description: 'Skip the backup of the content directory that --apply takes first', default: false },
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
    const pending = plan.entries.filter(e => e.newText !== undefined)

    if (args.check) {
      const status = schemaStatus(root)
      emit(ctx.json, { pending: status.pendingFiles > 0, ...status }, () => status.pendingFiles
        ? `${style.yellow('!')} ${status.pendingFiles} file(s) use legacy GitHub fields; run \`mdpm migrate\``
        : `${style.green('✓')} content is up to date`)
      if (status.pendingFiles) process.exitCode = ExitCode.error
      return
    }

    const result = args.apply ? applyMigration(plan, { backup: !args['no-backup'] }) : undefined

    emit(ctx.json, {
      dryRun: !args.apply,
      contentRoot: root,
      scanned: plan.scanned,
      files: plan.entries.map(({ newText: _, ...e }) => e),
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
        lines.push('', `${style.green('✓')} migrated ${result.applied.length} file(s)${result.backupDir ? `; backup: ${result.backupDir}` : ''}${result.stamped ? '' : ' (marker not written: legacy fields remain elsewhere)'}`)
      }
      else if (pending.length) {
        lines.push('', `${pending.length} of ${plan.scanned} file(s) would change. Re-run with ${style.bold('--apply')} to write them (a backup is taken first).`)
      }
      return lines.join('\n')
    })
  },
})
