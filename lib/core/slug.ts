// One definition of slugs for the server (which assigns them) and the clients (which predict them), so a
// fire-and-forget create can report the id the server will choose.
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
