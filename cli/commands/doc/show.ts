import { defineCommand } from 'citty'
import { DEFAULT_MAX_CHARS, shapeDoc } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { CliError, emit, ExitCode } from '../../output'
import { docScope, scopeArgs } from './shared'

export default defineCommand({
  meta: { name: 'show', description: 'Print a doc\'s markdown body (pipe-friendly); --json for full metadata' },
  args: {
    ...globalArgs,
    ...scopeArgs,
    full: { type: 'boolean', description: 'The whole body, however long', default: false },
    'max-chars': { type: 'string', description: `Cap on the body (default ${DEFAULT_MAX_CHARS}; 0 = all)` },
    offset: { type: 'string', description: 'Start the body at this character, to read the next part' },
    ref: { type: 'positional', description: 'Doc slug or unique fragment of slug/title', required: true },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const found = ctx.core.resolveDoc(args.ref, docScope(ctx, args))
    const num = (v: string | undefined, flag: string) => {
      if (v === undefined) return undefined
      const n = Number(v)
      if (!Number.isInteger(n) || n < 0) throw new CliError(`${flag}: '${v}' is not a non-negative integer`, ExitCode.usage)
      return n
    }
    const doc = shapeDoc(found, { maxChars: args.full ? 0 : num(args['max-chars'], '--max-chars'), offset: num(args.offset, '--offset') })
    // Human mode is the raw body only, so `mdpm doc show x | less` or `> file.md` just works. A cut body
    // says so on stderr, so the pipe stays clean but the reader knows there is more.
    if (doc.truncated && 'nextOffset' in doc && !ctx.json) console.error(ctx.style.yellow('note:') + ` body cut at ${doc.nextOffset} of ${(doc as any).totalChars} chars; use --offset ${doc.nextOffset} for the next part, or --full`)
    emit(ctx.json, doc, () => doc.body)
  },
})
