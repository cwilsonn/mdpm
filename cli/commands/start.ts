import { defineCommand } from 'citty'
import { createContext, globalArgs, parsePort, portArg } from '../context'
import { emit } from '../output'

export default defineCommand({
  meta: { name: 'start', description: 'Start the dev server (no-op if already running)' },
  args: {
    ...globalArgs,
    ...portArg,
    foreground: { type: 'boolean', description: 'Run attached to this terminal instead of in the background', default: false },
    timeout: { type: 'string', description: 'Seconds to wait for readiness', default: '60' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const result = await ctx.lifecycle.start({
      port: parsePort(args.port),
      foreground: args.foreground,
      timeoutMs: Number(args.timeout) * 1000,
    })
    // A foreground run has already streamed the server's own output and ended with it.
    if (args.foreground && result.action === 'started') return
    emit(ctx.json, result, () => result.action === 'already-running'
      ? `${ctx.style.green('✓')} already running at ${result.url}`
      : `${ctx.style.green('✓')} started at ${result.url} (pid ${result.pid}, log: ${result.logFile})`)
  },
})
