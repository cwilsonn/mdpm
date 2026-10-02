import { defineCommand } from 'citty'
import { builtinRegistry } from '../../../lib/core'
import { globalArgs, createContext } from '../../context'
import { emit, table } from '../../output'

export default defineCommand({
  meta: { name: 'list', description: 'List the installed link providers' },
  args: { ...globalArgs },
  run({ args }) {
    const ctx = createContext(args)
    const providers = builtinRegistry().providers.map(p => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      hosts: p.hosts ?? [],
      kinds: Object.keys(p.kinds),
    }))
    emit(ctx.json, providers, () => table(providers.map(p => [p.id, p.name, p.kinds.join(', '), p.hosts.join(', ') || '(any)']), ['ID', 'NAME', 'KINDS', 'HOSTS']))
  },
})
