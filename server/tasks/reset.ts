export default defineTask({
  meta: {
    name: 'reset',
    description: 'Wipe all projects and authors, then re-seed demo content',
  },
  run() {
    resetContent()
    return { result: 'ok' }
  },
})
