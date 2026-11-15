// One definition of slugs for the server (which assigns them) and the clients (which predict them), so a
// fire-and-forget create can report the id the server will choose.
// Slugs are repeated in every list, pickup and note, so long titles get a short slug: cut at the last word
// boundary within the cap (or hard at the cap when the first word alone is that long). Existing slugs keep
// their length; explicit slugs are used as given.
export const MAX_SLUG_LENGTH = 40

export function slugify(text: string) {
  const full = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (full.length <= MAX_SLUG_LENGTH) return full
  const cut = full.slice(0, MAX_SLUG_LENGTH + 1)
  const boundary = cut.lastIndexOf('-')
  return (boundary > 0 ? cut.slice(0, boundary) : cut.slice(0, MAX_SLUG_LENGTH)).replace(/-+$/, '')
}

export function uniqueSlug(base: string, existsFn: (s: string) => boolean) {
  let candidate = base
  let i = 2
  while (existsFn(candidate)) {
    candidate = `${base}-${i++}`
  }
  return candidate
}
