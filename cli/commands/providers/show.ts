import { defineCommand } from 'citty'
import { builtinRegistry, NotFoundError } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { emit } from '../../output'

export default defineCommand({
  meta: { name: 'show', description: 'Show one provider: hosts, kinds, vocabulary, and the short refs it understands' },
  args: { ...globalArgs, id: { type: 'positional', description: 'Provider id (see `mdpm providers list`)', required: true } },
  run({ args }) {
    const ctx = createContext(args)
    const provider = builtinRegistry().get(args.id)
    if (!provider) throw new NotFoundError(`No provider '${args.id}' (see \`mdpm providers list\`)`)
    const detail = {
      id: provider.id,
      name: provider.name,
      icon: provider.icon,
      hosts: provider.hosts ?? [],
      schemes: provider.schemes,
      settings: provider.settings,
      kinds: provider.kinds,
    }
    emit(ctx.json, detail, () => {
      const s = ctx.style
      const lines = [`${s.bold(provider.name)} ${s.dim(`(${provider.id})`)}  ${provider.icon}`, `hosts: ${provider.hosts?.join(', ') ?? '(any)'}   schemes: ${provider.schemes.join(', ')}`]
      for (const [name, value] of Object.entries(provider.settings)) lines.push(`setting ${name}${value.required ? ' (required)' : ''}: ${value.description}`)
      for (const [kind, k] of Object.entries(provider.kinds)) {
        lines.push('', `${s.bold(kind)}: ${k!.noun}`, `  shown as ${k!.display}   ref ${k!.ref}   url ${k!.url}`, ...(k!.short ? [`  short ref: ${k!.short}`] : []))
      }
      return lines.join('\n')
    })
  },
})
