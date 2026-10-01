// Stand-in for $EDITOR in tests. Edits the file it is given (argv[2]):
//   FAKE_EDITOR_APPEND  text appended to the file
//   FAKE_EDITOR_REPLACE replaces the whole file
//   FAKE_EDITOR_EXIT    exit code (default 0)
// It also records the original contents in FAKE_EDITOR_LOG when set.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (process.env.FAKE_EDITOR_LOG) writeFileSync(process.env.FAKE_EDITOR_LOG, readFileSync(file, 'utf8'))
if (process.env.FAKE_EDITOR_REPLACE !== undefined) writeFileSync(file, process.env.FAKE_EDITOR_REPLACE)
if (process.env.FAKE_EDITOR_APPEND !== undefined) appendFileSync(file, process.env.FAKE_EDITOR_APPEND)
process.exit(Number(process.env.FAKE_EDITOR_EXIT ?? 0))
