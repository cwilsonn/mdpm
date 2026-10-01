import { defineCommand } from 'citty'

export default defineCommand({
  meta: { name: 'task', description: 'List, show, create, and update tasks' },
  subCommands: {
    list: () => import('./list').then(m => m.default),
    search: () => import('./search').then(m => m.default),
    ready: () => import('./ready').then(m => m.default),
    graph: () => import('./graph').then(m => m.default),
    show: () => import('./show').then(m => m.default),
    add: () => import('./add').then(m => m.default),
    set: () => import('./set').then(m => m.default),
    done: () => import('./done').then(m => m.default),
    note: () => import('./note').then(m => m.default),
    archive: () => import('./archive').then(m => m.default),
    unarchive: () => import('./unarchive').then(m => m.default),
    delete: () => import('./delete').then(m => m.default),
  },
})
