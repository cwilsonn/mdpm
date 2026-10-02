import { defineCommand } from 'citty'
import { loadProviderFile } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { emit, ExitCode } from '../../output'

export default defineCommand({
  meta: { name: 'validate', description: 'Check a provider file against the schema; prints what is wrong, field by field (exit 1 if invalid)' },
  args: { ...globalArgs, file: { type: 'positional', description: 'Path to a provider .json file', required: true } },
  run({ args }) {
    const ctx = createContext(args)
    const result = loadProviderFile(args.file)
    const valid = 'provider' in result
    emit(ctx.json, valid ? { valid, id: result.provider.id } : { valid, problems: result.problems }, () => valid
      ? `${ctx.style.green('✓')} ${args.file} is a valid provider (${result.provider.id})`
      : `${ctx.style.red('✗')} ${args.file}\n${result.problems.map(p => `  ${p}`).join('\n')}`)
    if (!valid) process.exitCode = ExitCode.error
  },
})
