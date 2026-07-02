// Error feedback for mutations. Errors-only by design: success is usually
// already communicated inline (autosave's saved indicator, a closing modal, a
// list refresh), so success toasts would be noise.
//
// Two shapes:
//  - tryWithToast: the common "notify and stop" case — toasts on failure and
//    returns a success boolean, so callers gate their follow-up (`if (await …)`)
//    without a load-bearing try/catch.
//  - withErrorToast: toasts then RE-THROWS — for callers that run their own
//    finally/cleanup and need the error to propagate.
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

  async function withErrorToast<T>(fn: () => Promise<T>, message: string): Promise<T> {
    try {
      return await fn()
    }
    catch (err) {
      toast.add({ title: message, color: 'error' })
      throw err
    }
  }

  return { tryWithToast, withErrorToast }
}
