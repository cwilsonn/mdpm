import { defineCommand } from 'citty'
import { applyCompaction, DEFAULT_KEEP, planCompaction } from '../../../lib/core'
import { createContext, globalArgs, writeArgs } from '../../context'
import { CliError, emit, ExitCode } from '../../output'
import { projectArgs, requireProject } from '../task/shared'

export default defineCommand({
  meta: { name: 'compact', description: 'Roll old session notes into one short digest doc and archive the originals (dry run unless --apply)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    ...projectArgs,
    keep: { type: 'string', description: `Newest session-notes docs to leave untouched (default ${DEFAULT_KEEP})` },
    apply: { type: 'boolean', description: 'Do it. Without this, only show what would happen', default: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const project = requireProject(ctx, args)
    const keep = args.keep === undefined ? undefined : Number(args.keep)
    if (keep !== undefined && (!Number.isInteger(keep) || keep < 1)) throw new CliError(`--keep: '${args.keep}' is not a positive integer`, ExitCode.usage)
    const plan = planCompaction(ctx.core, project, { keep })
    if (!args.apply) {
      emit(ctx.json, { dryRun: true, ...plan }, () => plan.compacted.length
        ? [`${plan.compacted.length} of ${plan.compacted.length + plan.kept.length} session-notes docs would be rolled into ${plan.rollup.slug} (${plan.rollup.chars} chars) and archived; the newest ${plan.kept.length} stay:`,
          ...plan.compacted.map(d => `  ${d.slug}`), ctx.style.dim('dry run: nothing changed; pass --apply')].join('\n')
        : ctx.style.dim(`nothing to compact: ${plan.kept.length} session-notes doc${plan.kept.length === 1 ? '' : 's'} (keeping ${plan.keep})`))
      return
    }
    const { archived } = await applyCompaction(ctx.core, plan)
    emit(ctx.json, { rollup: plan.rollup.slug, archived }, () => archived.length
      ? `${ctx.style.green('✓')} rolled ${archived.length} session-notes docs into ${plan.rollup.slug} and archived them (mdpm doc unarchive <slug> restores one)`
      : ctx.style.dim('nothing to compact'))
  },
})
