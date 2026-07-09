// Generic archive visibility, shared across projects, tasks, and docs. Archiving
// is a nullable `archivedAt` timestamp orthogonal to workflow status — presence
// means archived. Default views exclude archived items; a per-list `showArchived`
// toggle opts them back in. Lists filter client-side (server routes return
// everything), so this generalizes the existing `status !== 'done'` exclude style.

/** Anything carrying the universal archive flag. */
export interface Archivable {
  archivedAt?: string
}

export function isArchived(item: Archivable): boolean {
  return !!item.archivedAt
}

export function useArchiveFilter() {
  const showArchived = ref(false)

  /** Items to render: all when the toggle is on, else only the non-archived ones. */
  function visible<T extends Archivable>(items: T[]): T[] {
    return showArchived.value ? items : items.filter(i => !i.archivedAt)
  }

  const archivedCount = (items: Archivable[]) => items.filter(isArchived).length

  return { showArchived, visible, isArchived, archivedCount }
}
