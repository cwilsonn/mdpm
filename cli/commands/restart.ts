import { defineCommand } from 'citty'
import { createContext, globalArgs, parsePort, portArg } from '../context'
import { emit } from '../output'

export default defineCommand({
  meta: { name: 'restart', description: 'Stop the dev server, then start it again' },
  args: {
    ...globalArgs,
    ...portArg,
    timeout: { type: 'string', description: 'Seconds to wait for readiness', default: '60' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const port = parsePort(args.port)
    await ctx.lifecycle.stop({ port })
    const result = await ctx.lifecycle.start({ port, timeoutMs: Number(args.timeout) * 1000 })
    emit(ctx.json, result, () => `${ctx.style.green('✓')} restarted at ${result.url} (pid ${result.pid}, log: ${result.logFile})`)
  },
})
