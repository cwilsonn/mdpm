<script setup lang="ts">
import type { TreeItem } from '@nuxt/ui'

export interface DocTreeItem {
  slug: string
  project: string | null
  title: string
  tags: string[]
  parent: string | null
  createdAt: string
  updatedAt?: string
  excerpt?: string
}

const props = defineProps<{
  docs: DocTreeItem[]
  baseUrl: string
}>()

const router = useRouter()

// Extend TreeItem with slug for navigation (TreeItem allows [key]: any)
type DocTreeNode = TreeItem & { slug: string }

const treeItems = computed((): DocTreeNode[] => {
  const bySlug = new Map(props.docs.map(d => [d.slug, d]))
  const childrenMap = new Map<string, DocTreeItem[]>()
  const roots: DocTreeItem[] = []

  for (const doc of props.docs) {
    const p = doc.parent
    if (p && bySlug.has(p)) {
      const arr = childrenMap.get(p) ?? []
      arr.push(doc)
      childrenMap.set(p, arr)
    }
    else {
      roots.push(doc)
    }
  }

  // BFS from roots — detect cycle orphans and promote them
  const visited = new Set<string>(roots.map(r => r.slug))
  const queue = [...roots]
  while (queue.length) {
    const node = queue.shift()!
    for (const child of childrenMap.get(node.slug) ?? []) {
      if (!visited.has(child.slug)) {
        visited.add(child.slug)
        queue.push(child)
      }
    }
  }
  for (const doc of props.docs) {
    if (!visited.has(doc.slug)) roots.push(doc)
  }

  // Build nested TreeItem[] — seen guard prevents double-emit on promoted cycle nodes
  const seen = new Set<string>()
  function toItems(nodes: DocTreeItem[]): DocTreeNode[] {
    const out: DocTreeNode[] = []
    for (const n of nodes) {
      if (seen.has(n.slug)) continue
      seen.add(n.slug)
      out.push({
        slug: n.slug,
        label: n.title,
        icon: childrenMap.has(n.slug) ? 'i-lucide-folder' : 'i-lucide-file-text',
        defaultExpanded: true,
        children: toItems(childrenMap.get(n.slug) ?? []),
      })
    }
    return out
  }

  return toItems(roots)
})

function onSelect(_e: any, item: DocTreeNode) {
  if (!item.children?.length) {
    router.push(`${props.baseUrl}/${item.slug}`)
  }
}
</script>

<template>
  <UTree
    :items="treeItems"
    :get-key="(item: DocTreeNode) => item.slug"
    @select="onSelect"
  />
</template>
