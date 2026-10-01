import { defineCommand } from 'citty'
import { completionScript, SHELLS, type Shell } from '../completion'
import { CliError, ExitCode } from '../output'

export default defineCommand({
  meta: { name: 'completions', description: `Print a shell completion script (${SHELLS.join(', ')})` },
  args: {
    shell: { type: 'positional', description: `One of: ${SHELLS.join(', ')}`, required: true },
  },
  run({ args }) {
    if (!SHELLS.includes(args.shell as Shell)) throw new CliError(`unknown shell '${args.shell}'; choose one of: ${SHELLS.join(', ')}`, ExitCode.usage)
    process.stdout.write(completionScript(args.shell as Shell))
  },
})
