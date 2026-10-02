import { defineCommand } from 'citty'

export default defineCommand({
  meta: { name: 'doc', description: 'List, read, search, create, edit, and archive docs' },
  subCommands: {
    list: () => import('./list').then(m => m.default),
    show: () => import('./show').then(m => m.default),
    link: () => import('./link').then(m => m.default),
    search: () => import('./search').then(m => m.default),
    create: () => import('./create').then(m => m.default),
    edit: () => import('./edit').then(m => m.default),
    archive: () => import('./archive').then(m => m.default),
    unarchive: () => import('./unarchive').then(m => m.default),
    delete: () => import('./delete').then(m => m.default),
  },
})
