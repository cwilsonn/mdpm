import { defineCommand } from 'citty'
import { createContext, globalArgs, parsePort, portArg } from '../context'
import { emit, ExitCode } from '../output'

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h && `${h}h`, (h || m) && `${m}m`, `${s}s`].filter(Boolean).join(' ')
}

export default defineCommand({
  meta: { name: 'status', description: 'Report whether the server is running (exit 3 when it is not)' },
  args: { ...globalArgs, ...portArg },
  async run({ args }) {
    const ctx = createContext(args)
    const s = await ctx.lifecycle.status(parsePort(args.port))
    emit(ctx.json, s, () => {
      const mark = s.running ? ctx.style.green('✓') : ctx.style.yellow('!')
      const lines = [`${mark} ${s.state}: ${s.url}`]
      if (s.pid) lines.push(`  pid ${s.pid}, up ${formatUptime(s.uptimeSeconds ?? 0)}${s.managed ? `, log: ${s.logFile}` : ' (started outside mdpm; pid from nuxt.lock)'}`)
      else if (s.running) lines.push('  pid unknown (not started by mdpm, no Nuxt lock); stop it manually')
      return lines.join('\n')
    })
    // Scripts can gate on `mdpm status`; a down server maps to the "unreachable" exit code.
    if (!s.running) process.exitCode = ExitCode.unreachable
  },
})
