import { defineCommand } from 'citty'

export default defineCommand({
  meta: { name: 'doc', description: 'List, read, and search docs' },
  subCommands: {
    list: () => import('./list').then(m => m.default),
    show: () => import('./show').then(m => m.default),
    search: () => import('./search').then(m => m.default),
  },
})
