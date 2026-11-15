/** A doc as listed by `GET /api/docs` and `GET /api/docs/[project]`, rendered as a tree by `DocList`. */
export interface DocTreeItem {
  slug: string
  project: string | null
  title: string
  tags: string[]
  parent: string | null
  isFolder?: boolean
  order?: number
  createdAt: string
  updatedAt?: string
  archivedAt?: string
  excerpt?: string
}
