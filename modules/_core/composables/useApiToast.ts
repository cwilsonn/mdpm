// Error feedback for mutations. Errors-only by design: success is usually
// already communicated inline (autosave's saved indicator, a closing modal, a
// list refresh), so success toasts would be noise.
//
// tryWithToast handles the "notify and stop" case: toast on failure and return
// a success boolean, so callers gate their follow-up (`if (await …)`) without a
// load-bearing try/catch.
export function useApiToast() {
  const toast = useToast()

  async function tryWithToast(fn: () => Promise<unknown>, message: string): Promise<boolean> {
    try {
      await fn()
      return true
    }
    catch {
      toast.add({ title: message, color: 'error' })
      return false
    }
  }

  return { tryWithToast }
}
