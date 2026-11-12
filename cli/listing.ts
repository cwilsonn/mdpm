import { DEFAULT_LIMIT, pageFooter, paginate, parseFields, pickFields, toTsv, type Page } from '../lib/core'
import type { Context } from './context'
import { CliError, ExitCode } from './output'

// Flags every list command shares. Lists are small by default: a page of rows, a handful of fields.
export const listArgs = {
  limit: { type: 'string', description: `Maximum rows (default ${DEFAULT_LIMIT}; 0 = all)` },
  offset: { type: 'string', description: 'Skip this many rows (for the next page)' },
  fields: { type: 'string', description: 'Comma-separated columns to include (* = all), e.g. slug,title,status' },
  tsv: { type: 'boolean', description: 'Tab-separated rows with one header line instead of a table or JSON objects', default: false },
} as const

interface ListFlags { limit?: string; offset?: string; fields?: string; tsv?: boolean }

function nonNegative(value: string | undefined, flag: string) {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new CliError(`${flag}: '${value}' is not a non-negative integer`, ExitCode.usage)
  return n
}

export function readPaging(flags: ListFlags) {
  return { limit: nonNegative(flags.limit, '--limit'), offset: nonNegative(flags.offset, '--offset') }
}

export function readFields(flags: ListFlags, allowed: readonly string[], fallback: readonly string[]) {
  try {
    return parseFields(flags.fields, allowed, fallback)
  }
  catch (err) {
    throw new CliError(`--fields: ${(err as Error).message}`, ExitCode.usage)
  }
}

// Print one page. `--tsv` and `--json` print only the chosen fields; the "N of M shown" footer goes to stderr
// there so stdout stays parseable. Human mode renders its own table and ends with the footer.
export function printPage<T extends Record<string, unknown>>(
  ctx: Context,
  flags: ListFlags,
  all: T[],
  opts: { noun: string; allowed: readonly string[]; fallback: readonly string[]; empty: string; human: (page: Page<T>) => string; footerFlags?: { offset: string; all: string } },
) {
  const fields = readFields(flags, opts.allowed, opts.fallback)
  const page = paginate(all, readPaging(flags))
  const footer = pageFooter(page, opts.noun, opts.footerFlags)
  const truncated = page.nextOffset !== null || page.offset > 0
  if (flags.tsv || ctx.json) {
    console.log(flags.tsv ? toTsv(page.items, fields) : JSON.stringify(page.items.map(i => pickFields(i, fields)), null, 2))
    if (truncated) console.error(ctx.style.dim(footer))
    return
  }
  console.log(page.items.length ? `${opts.human(page)}\n${ctx.style.dim(footer)}` : ctx.style.dim(opts.empty))
}
