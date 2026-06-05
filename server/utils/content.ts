import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import matter from 'gray-matter'

export function contentRoot() {
  return join(process.cwd(), 'content')
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
