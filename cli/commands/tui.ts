import { defineCommand } from 'citty'
import { createContext, globalArgs, writeArgs } from '../context'
import { runTui } from '../tui/run'

export default defineCommand({
  meta: { name: 'tui', description: 'Interactive kanban board in the terminal: move cards, add notes and tasks, with live updates (press ? for keys)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    project: { type: 'string', description: 'Project to open (default: the current repo\'s project; otherwise you pick one)' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const project = args.project ? ctx.core.getProject(args.project).slug : ctx.inferProject()?.slug
    await runTui(ctx, { project })
  },
})
