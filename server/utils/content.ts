import { readFileSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import matter from 'gray-matter'
import { slugify as coreSlugify, uniqueSlug as coreUniqueSlug } from '../../lib/core/slug'
import { atomicWrite, renderMarkdown } from '../../lib/core/write'

// Same variable the CLI and MCP server honor, so every writer and reader agrees on one root.
// Unset (the default, and always in production) keeps the checkout's own content/ directory.
export function contentRoot() {
  const override = process.env.MDPM_CONTENT_PATH
  return override ? resolve(override) : join(process.cwd(), 'content')
}

export function contentPath(...parts: string[]) {
  return join(contentRoot(), ...parts)
}

export function readMarkdown(relPath: string) {
  const full = contentPath(relPath)
  if (!existsSync(full)) return null
  return matter(readFileSync(full, 'utf-8'))
}

// Content writes go through lib/core/write.ts (see utils/writer.ts); this is left for the seed and authors.
export function writeMarkdown(relPath: string, frontmatter: Record<string, unknown>, body = '') {
  atomicWrite(contentPath(relPath), renderMarkdown(frontmatter, body))
}

export function deleteContent(relPath: string) {
  const full = contentPath(relPath)
  if (existsSync(full)) rmSync(full, { recursive: true, force: true })
}

export function assertSafeSlug(...slugs: string[]) {
  for (const s of slugs) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(s) && s !== '') {
      throw createError({ statusCode: 400, message: `Invalid slug: "${s}"` })
    }
  }
}

export function slugify(text: string) {
  return coreSlugify(text)
}

export function uniqueSlug(base: string, existsFn: (s: string) => boolean) {
  return coreUniqueSlug(base, existsFn)
}
