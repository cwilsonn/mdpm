export default defineNitroPlugin(() => {
  if (process.env.NODE_ENV !== 'production') return
  resetContent()
})
