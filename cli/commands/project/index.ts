import { defineCommand } from 'citty'

export default defineCommand({
  meta: { name: 'project', description: 'List, show, create, and archive projects' },
  subCommands: {
    list: () => import('./list').then(m => m.default),
    show: () => import('./show').then(m => m.default),
    create: () => import('./create').then(m => m.default),
    archive: () => import('./archive').then(m => m.default),
    unarchive: () => import('./unarchive').then(m => m.default),
  },
})
