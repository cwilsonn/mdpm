/** The server's message from a failed `$fetch` (h3 errors carry it in `data.message`), or `fallback`. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const message = (e as { data?: { message?: unknown } } | null)?.data?.message
  return typeof message === 'string' && message ? message : fallback
}
