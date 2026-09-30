// Stand-in for the Nuxt dev server in tests: listens on --port and answers every request with
// JSON, so lifecycle and auto-start can be exercised without starting Nuxt. `STARTUP_DELAY_MS`
// delays listening to simulate a slow start; `FAKE_SERVER_STATUS` forces an HTTP status (e.g. 400).
import { createServer } from 'node:http'

const port = Number(process.argv[process.argv.indexOf('--port') + 1])
const server = createServer((req, res) => {
  const status = Number(process.env.FAKE_SERVER_STATUS ?? 200)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(status >= 400 ? { message: 'forced failure' } : req.method === 'POST' ? { slug: 'fake-slug' } : { ok: true }))
})
setTimeout(() => server.listen(port, '127.0.0.1'), Number(process.env.STARTUP_DELAY_MS ?? 0))
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0))
