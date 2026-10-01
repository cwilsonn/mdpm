import { defineCommand } from 'citty'
import { createContext, globalArgs, writeArgs } from '../../context'
import { confirm } from '../../io'
import { CliError, emit, ExitCode } from '../../output'

export default defineCommand({
  meta: { name: 'delete', description: 'Permanently delete a project and ALL its tasks and docs (asks for confirmation unless --yes; prefer archive)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    yes: { type: 'boolean', alias: 'y', description: 'Skip the confirmation prompt', default: false },
    ref: { type: 'positional', description: 'Project slug or unique fragment of slug/title', required: true },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const project = ctx.core.resolveProject(args.ref)
    const detail = `${project.taskCount} task${project.taskCount === 1 ? '' : 's'} and ${project.docCount} doc${project.docCount === 1 ? '' : 's'}`
    if (!args.yes && !await confirm(`Delete project ${project.slug} ("${project.title}") with ${detail}? This cannot be undone.`)) {
      throw new CliError('aborted', ExitCode.error)
    }
    await ctx.core.deleteProject(project.slug)
    emit(ctx.json, { slug: project.slug, deleted: true }, () => `${ctx.style.green('✓')} deleted project ${project.slug}`)
  },
})
