// Who may talk to this server. There is no authentication: the server is meant for one person on
// loopback. Two browser attacks still reach a loopback server, and this check stops both:
//
// - DNS rebinding: a page on attacker.example re-points its own name at 127.0.0.1 and then reads
//   our responses as same-origin. The browser still sends `Host: attacker.example`, so every request
//   must name a host we serve under.
// - Cross-site writes: a page can fire a "simple" POST (no preflight) with a form or body-less
//   content type, which h3's readBody would still parse as JSON. Mutations must come from an allowed
//   Origin (when the browser sends one) and POSTs must declare application/json, which a cross-site
//   page can only do after a CORS preflight that this server never approves.
//
// Requests without a Host header are internal (Nitro's in-process fetch during SSR) and pass.

const LOOPBACK = ['localhost', '127.0.0.1', '::1']
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface GuardRequest {
  method: string
  path: string
  headers: Record<string, string | undefined>
}

export interface GuardRejection {
  statusCode: 403 | 415
  message: string
}

function hostnameOf(value: string, withScheme: boolean): string | undefined {
  try {
    return new URL(withScheme ? value : `http://${value}`).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  }
  catch {
    return undefined
  }
}

// Loopback names, the default `mdpm.local`, the hostnames of MDPM_BASE_URL and MDPM_HOST (what
// `mdpm start` binds), and MDPM_ALLOWED_HOSTS (comma-separated, for a deployment's public name).
export function allowedHosts(env: Record<string, string | undefined> = process.env): Set<string> {
  const hosts = new Set([...LOOPBACK, 'mdpm.local'])
  const base = env['MDPM_BASE_URL'] && hostnameOf(env['MDPM_BASE_URL'], true)
  if (base) hosts.add(base)
  if (env['MDPM_HOST']) hosts.add(env['MDPM_HOST'].toLowerCase())
  for (const h of (env['MDPM_ALLOWED_HOSTS'] ?? '').split(',')) {
    if (h.trim()) hosts.add(h.trim().toLowerCase())
  }
  return hosts
}

export function checkRequest(req: GuardRequest, hosts: Set<string> = allowedHosts()): GuardRejection | undefined {
  const host = req.headers['host']
  if (host !== undefined) {
    const name = hostnameOf(host, false)
    if (!name || !hosts.has(name)) {
      return { statusCode: 403, message: `Host "${host}" is not served here. Set MDPM_ALLOWED_HOSTS to serve it.` }
    }
  }

  const method = req.method.toUpperCase()
  if (SAFE_METHODS.has(method)) return undefined

  const origin = req.headers['origin']
  if (origin !== undefined) {
    const name = origin === 'null' ? undefined : hostnameOf(origin, true)
    if (!name || !hosts.has(name)) {
      return { statusCode: 403, message: `Cross-origin request from "${origin}" refused.` }
    }
  }

  if (method === 'POST' && req.path.startsWith('/api/')) {
    const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    if (type !== 'application/json') {
      return { statusCode: 415, message: 'POST bodies must be sent as application/json.' }
    }
  }
  return undefined
}
