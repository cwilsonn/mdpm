import { defineCommand } from 'citty'

export default defineCommand({
  meta: { name: 'links', description: 'Resolve a URL or short ref, and check stored links for problems (reads files; no server needed)' },
  subCommands: {
    resolve: () => import('./resolve').then(m => m.default),
    check: () => import('./check').then(m => m.default),
  },
})
