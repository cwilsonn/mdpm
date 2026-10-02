// Regenerates schemas/provider.schema.json from the zod schema (pnpm schema:provider).
// A test fails when the committed file is stale.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { providerJsonSchema } from '../lib/core/providers/schema'

writeFileSync(fileURLToPath(new URL('../schemas/provider.schema.json', import.meta.url)), `${JSON.stringify(providerJsonSchema(), null, 2)}\n`)
