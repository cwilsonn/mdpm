// Stop the shared content watcher with the server (and on a dev reload), so none is left behind.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', () => stopContentWatcher())
})
