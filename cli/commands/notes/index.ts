import { defineCommand } from 'citty'

export default defineCommand({
  meta: { name: 'notes', description: 'Session notes housekeeping' },
  subCommands: {
    compact: () => import('./compact').then(m => m.default),
  },
})
