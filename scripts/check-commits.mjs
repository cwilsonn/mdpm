#!/usr/bin/env node
// Conventional Commits gate. No dependencies (node builtins only) so CI needs no install step.
//
//   node scripts/check-commits.mjs <base>..<head>   check every commit subject in a range
//   node scripts/check-commits.mjs --message "<s>"  check a single message (e.g. PR title)
//   node scripts/check-commits.mjs --file <path>    check a commit message file (commit-msg hook)
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert']
const SUBJECT = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9._/-]*\\))?!?: \\S.*$`)
const MAX_LENGTH = 100
// Git-generated subjects that are not authored by hand.
const EXEMPT = /^(Merge |Revert "|fixup! |squash! )/

export function check(subject) {
  if (EXEMPT.test(subject)) return null
  if (!SUBJECT.test(subject)) {
    return `not a conventional commit (expected "<type>(<scope>)?: <description>", type one of ${TYPES.join(', ')})`
  }
  if (subject.length > MAX_LENGTH) return `subject is ${subject.length} chars (max ${MAX_LENGTH})`
  return null
}

function subjects(args) {
  const [flag, value] = args
  if (flag === '--message') return [value.split('\n')[0]]
  if (flag === '--file') return [readFileSync(value, 'utf8').split('\n').find(l => l.trim() && !l.startsWith('#')) ?? '']
  if (!flag) throw new Error('usage: check-commits.mjs <base>..<head> | --message <text> | --file <path>')
  return execFileSync('git', ['log', '--format=%s', flag], { encoding: 'utf8' }).split('\n').filter(Boolean)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = subjects(process.argv.slice(2))
    .map(s => [s, check(s)])
    .filter(([, why]) => why)
  for (const [s, why] of failures) console.error(`✗ ${s}\n    ${why}`)
  if (failures.length) {
    console.error(`\n${failures.length} invalid commit message(s). See "Commit messages" in CLAUDE.md.`)
    process.exit(1)
  }
  console.log('✓ commit messages OK')
}
