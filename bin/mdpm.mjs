#!/usr/bin/env node
// Entry shim. Runs the TypeScript CLI through tsx (no build step, same as the MCP server).
// Node resolves symlinks for the entry module, so `tsx` and `../cli` resolve from the real
// checkout even when this file is invoked through a globally linked `mdpm`.
import { register } from 'tsx/esm/api'

register()
const { main } = await import('../cli/index.ts')
await main()
