import type { CoreConfig } from './config'

export type ApiClient = ReturnType<typeof createApi>

export function createApi(config: CoreConfig) {
  async function request(method: string, path: string, body?: unknown) {
    const res = await fetch(`${config.baseUrl}${path}`, {
      method,
      ...(body !== undefined && {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error((err as any).message ?? res.statusText)
    }
    return res.json()
  }

  return {
    post: (path: string, body: unknown) => request('POST', path, body),
    patch: (path: string, body: unknown) => request('PATCH', path, body),
    delete: (path: string) => request('DELETE', path),
  }
}
