export default defineNitroPlugin(() => {
  if (!isDemo()) return
  resetContent()
})
