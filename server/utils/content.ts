import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import matter from 'gray-matter'

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

export function writeMarkdown(relPath: string, frontmatter: Record<string, unknown>, body = '') {
  const full = contentPath(relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, matter.stringify(body.trim(), frontmatter), 'utf-8')
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
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function uniqueSlug(base: string, existsFn: (s: string) => boolean) {
  let candidate = base
  let i = 2
  while (existsFn(candidate)) {
    candidate = `${base}-${i++}`
  }
  return candidate
}
