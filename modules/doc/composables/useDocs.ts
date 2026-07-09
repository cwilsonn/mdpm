// Doc mutation endpoints. Encapsulates the standalone-vs-project URL split that
// was branched inline across DocForm, DocList, and the doc index pages: pass a
// project slug for project docs, or omit it for standalone docs.
//
// (DocEditor stays URL-driven — it's a generic editor handed an explicit
// saveUrl/deleteUrl by its parent page — so it deliberately does not use this.)

export interface DocPayload {
  title?: string
  tags?: string[]
  parent?: string | null
  order?: number
  body?: string
  isFolder?: boolean
  archivedAt?: string | null
}

export function useDocs() {
  function base(project?: string | null) {
    return project ? `/api/docs/${project}` : '/api/standalone-docs'
  }

  /** URL for a single doc — the builder the doc pages use for GET / DocEditor's save+delete. */
  function docUrl(project: string | null | undefined, slug: string) {
    return `${base(project)}/${slug}`
  }

  function createDoc(project: string | null | undefined, body: DocPayload) {
    return $fetch<{ slug: string }>(base(project), { method: 'POST', body })
  }

  function updateDoc(project: string | null | undefined, slug: string, body: DocPayload) {
    return $fetch(`${base(project)}/${slug}`, { method: 'PATCH', body })
  }

  function removeDoc(project: string | null | undefined, slug: string) {
    return $fetch(`${base(project)}/${slug}`, { method: 'DELETE' })
  }

  function archiveDoc(project: string | null | undefined, slug: string) {
    return updateDoc(project, slug, { archivedAt: new Date().toISOString() })
  }

  function unarchiveDoc(project: string | null | undefined, slug: string) {
    return updateDoc(project, slug, { archivedAt: null })
  }

  return { docUrl, createDoc, updateDoc, removeDoc, archiveDoc, unarchiveDoc }
}
