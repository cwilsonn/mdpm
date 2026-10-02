import { defineCommand } from 'citty'

export default defineCommand({
  meta: { name: 'providers', description: 'List and inspect link providers (GitHub, GitLab, ...), and validate a provider file' },
  subCommands: {
    list: () => import('./list').then(m => m.default),
    show: () => import('./show').then(m => m.default),
    validate: () => import('./validate').then(m => m.default),
  },
})
