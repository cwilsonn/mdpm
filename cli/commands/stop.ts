import { defineCommand } from 'citty'
import { createContext, globalArgs, parsePort, portArg } from '../context'
import { emit } from '../output'

export default defineCommand({
  meta: { name: 'stop', description: 'Stop the dev server started by `mdpm start` (no-op if not running)' },
  args: { ...globalArgs, ...portArg },
  async run({ args }) {
    const ctx = createContext(args)
    const result = await ctx.lifecycle.stop({ port: parsePort(args.port) })
    emit(ctx.json, result, () => result.action === 'not-running'
      ? `not running (port ${result.port})`
      : `${ctx.style.green('✓')} stopped (port ${result.port})`)
  },
})
