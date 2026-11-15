/** A doc as listed by `GET /api/docs` and `GET /api/docs/[project]`, rendered as a flat list by `DocList`. */
export interface DocItem {
  slug: string
  project: string | null
  title: string
  tags: string[]
  createdAt: string
  updatedAt?: string
  archivedAt?: string
  excerpt?: string
}
