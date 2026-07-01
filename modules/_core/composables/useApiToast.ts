// Opt-in error feedback for mutations. Wrap a mutation call to surface a toast
// on failure (and re-throw so callers can still react). Errors-only by design:
// success is usually already communicated inline (autosave's saved indicator,
// a closing modal, a list refresh), so success toasts would be noise.
export function useApiToast() {
  const toast = useToast()

  async function withErrorToast<T>(fn: () => Promise<T>, message: string): Promise<T> {
    try {
      return await fn()
    }
    catch (err) {
      toast.add({ title: message, color: 'error' })
      throw err
    }
  }

  return { withErrorToast }
}
