// Authors (assignees) are shared across tasks and projects. Single home for the
// /api/authors endpoints, previously inlined in TaskForm and ProjectForm.
export interface Author {
  name: string
}

export function useAuthors() {
  function listAuthors() {
    return $fetch<Author[]>('/api/authors')
  }

  function createAuthor(name: string) {
    return $fetch<Author>('/api/authors', { method: 'POST', body: { name } })
  }

  return { listAuthors, createAuthor }
}
