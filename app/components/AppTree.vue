<script setup lang="ts">
import type { TreeItem } from '@nuxt/ui'

export interface AppTreeItem {
  slug: string
  label: string
  parent?: string | null
  icon?: string
  isFolder?: boolean
}

type AppTreeNode = TreeItem & {
  slug: string
  _isFolder: boolean
}

const CREATE_SLUG = '__create__'

const props = withDefaults(defineProps<{
  items: AppTreeItem[]
  loading?: boolean
  search?: boolean
  allowDrag?: boolean
  allowFolderCreate?: boolean
}>(), {
  loading: false,
  search: false,
  allowDrag: true,
  allowFolderCreate: true,
})

const emit = defineEmits<{
  select: [slug: string]
  reparent: [payload: { slug: string; parent: string | null }]
  'create-folder': [payload: { parent: string | null; name: string }]
}>()

// ── Search ─────────────────────────────────────────────────────────────────
const q = ref('')
const isSearching = computed(() => props.search && q.value.trim().length > 0)
const filteredFlat = computed(() => {
  const query = q.value.trim().toLowerCase()
  return props.items.filter(i => i.label.toLowerCase().includes(query))
})

// ── Hierarchy builder ──────────────────────────────────────────────────────
function buildTree(items: AppTreeItem[]): AppTreeNode[] {
  const bySlug = new Map(items.map(i => [i.slug, i]))
  const childrenMap = new Map<string, AppTreeItem[]>()
  const roots: AppTreeItem[] = []

  for (const item of items) {
    const p = item.parent
    if (p && bySlug.has(p)) {
      const arr = childrenMap.get(p) ?? []
      arr.push(item)
      childrenMap.set(p, arr)
    }
    else {
      roots.push(item)
    }
  }

  // BFS — detect cycle orphans and promote them to root
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
  for (const item of items) {
    if (!visited.has(item.slug)) roots.push(item)
  }

  const seen = new Set<string>()
  function toNodes(nodes: AppTreeItem[]): AppTreeNode[] {
    const out: AppTreeNode[] = []
    for (const n of nodes) {
      if (seen.has(n.slug)) continue
      seen.add(n.slug)
      const children = childrenMap.get(n.slug) ?? []
      const isFolder = !!(n.isFolder || children.length)
      out.push({
        slug: n.slug,
        label: n.label,
        icon: n.icon,
        _isFolder: isFolder,
        defaultExpanded: true,
        children: toNodes(children),
      })
    }
    return out
  }

  return toNodes(roots)
}

// ── Inline folder creation ─────────────────────────────────────────────────
const inlineCreate = ref<{ parent: string | null } | null>(null)
const inlineCreateName = ref('')

const createPlaceholderNode: AppTreeNode = {
  slug: CREATE_SLUG,
  label: '',
  _isFolder: false,
  defaultExpanded: false,
}

function injectCreateNode(nodes: AppTreeNode[], parentSlug: string): AppTreeNode[] {
  return nodes.map((node) => {
    if (node.slug === parentSlug) {
      return { ...node, children: [...(node.children ?? []), createPlaceholderNode] }
    }
    if (node.children?.length) {
      return { ...node, children: injectCreateNode(node.children as AppTreeNode[], parentSlug) }
    }
    return node
  })
}

const treeItems = computed((): AppTreeNode[] => {
  const base = buildTree(props.items)
  if (inlineCreate.value === null) return base
  const { parent } = inlineCreate.value
  if (parent === null) return [...base, createPlaceholderNode]
  return injectCreateNode(base, parent)
})

function openInlineCreate(parent: string | null) {
  inlineCreate.value = { parent }
  inlineCreateName.value = ''
}

function confirmCreate() {
  const name = inlineCreateName.value.trim()
  if (!name) {
    cancelCreate()
    return
  }
  const parent = inlineCreate.value?.parent ?? null
  inlineCreate.value = null
  inlineCreateName.value = ''
  emit('create-folder', { parent, name })
}

function cancelCreate() {
  inlineCreate.value = null
  inlineCreateName.value = ''
}

// ── Drag state ─────────────────────────────────────────────────────────────
const dragging = ref<string | null>(null)
// '__none__' = no hover; '__root__' = root drop zone; slug = item hover
const dropTarget = ref<string>('__none__')
const dropValid = ref(false)
const isDraggingAny = computed(() => dragging.value !== null)

function isDescendant(potentialDesc: string, ofAncestor: string): boolean {
  let cur: string | null | undefined = potentialDesc
  const visited = new Set<string>()
  while (cur) {
    if (visited.has(cur)) return false
    visited.add(cur)
    const item = props.items.find(i => i.slug === cur)
    cur = item?.parent
    if (cur === ofAncestor) return true
  }
  return false
}

function canDrop(draggedSlug: string, targetSlug: string | null): boolean {
  if (targetSlug === draggedSlug) return false
  if (targetSlug !== null && isDescendant(targetSlug, draggedSlug)) return false
  if (targetSlug !== null) {
    const target = props.items.find(i => i.slug === targetSlug)
    if (!target) return false
    const hasChildren = props.items.some(i => i.parent === targetSlug)
    if (!target.isFolder && !hasChildren) return false
  }
  return true
}

function onDragStart(e: DragEvent, item: AppTreeNode) {
  dragging.value = item.slug
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', item.slug)
}

function onDragOver(e: DragEvent, target: string | null) {
  if (!dragging.value) return
  const valid = canDrop(dragging.value, target)
  dropTarget.value = target === null ? '__root__' : target
  dropValid.value = valid
  e.dataTransfer!.dropEffect = valid ? 'move' : 'none'
}

function onDragLeave() {
  dropTarget.value = '__none__'
  dropValid.value = false
}

function onDrop(e: DragEvent, target: string | null) {
  e.preventDefault()
  const slug = dragging.value
  if (!slug) return
  if (!canDrop(slug, target)) return
  const current = props.items.find(i => i.slug === slug)
  if (current?.parent === target) return
  emit('reparent', { slug, parent: target })
  dragging.value = null
  dropTarget.value = '__none__'
  dropValid.value = false
}

function onDragEnd() {
  dragging.value = null
  dropTarget.value = '__none__'
  dropValid.value = false
}

// ── Misc helpers ───────────────────────────────────────────────────────────
function getIcon(item: AppTreeNode, expanded: boolean) {
  if (item.icon) return item.icon
  if (item._isFolder) return expanded ? 'i-lucide-folder-open' : 'i-lucide-folder'
  return 'i-lucide-file-text'
}

function onSelect(item: AppTreeNode) {
  if (item.slug === CREATE_SLUG) return
  if (!item._isFolder) emit('select', item.slug)
}
</script>

<template>
  <div
    class="flex flex-col h-full select-none"
    @dragend="onDragEnd"
  >
    <!-- Search bar (opt-in) -->
    <div v-if="search" class="px-4 py-2 border-b border-default shrink-0">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        placeholder="Search…"
        size="sm"
        variant="none"
        class="w-full"
        :ui="{ base: 'bg-transparent' }"
      >
        <template v-if="q" #trailing>
          <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" @click="q = ''" />
        </template>
      </UInput>
    </div>

    <!-- Flat search results -->
    <div v-if="isSearching" class="overflow-y-auto flex-1 min-h-0">
      <div v-if="!filteredFlat.length" class="flex flex-col items-center justify-center py-12 gap-2">
        <UIcon name="i-lucide-search-x" class="size-7 text-muted" />
        <p class="text-xs text-muted">No results for "{{ q }}"</p>
      </div>
      <button
        v-for="item in filteredFlat"
        :key="item.slug"
        type="button"
        class="group w-full flex items-center gap-1.5 px-2.5 py-1.5 text-sm hover:bg-elevated/50 hover:text-highlighted transition-colors"
        @click="emit('select', item.slug)"
      >
        <UIcon :name="item.icon || (item.isFolder ? 'i-lucide-folder' : 'i-lucide-file-text')" class="size-5 shrink-0 text-muted" />
        <span class="truncate flex-1 text-left">{{ item.label }}</span>
      </button>
    </div>

    <!-- Tree view -->
    <div v-else class="overflow-y-auto flex-1 min-h-0 relative">
      <UTree
        :items="treeItems"
        :get-key="(item: AppTreeNode) => item.slug"
        :on-select="(_e: any, item: AppTreeNode) => onSelect(item)"
        :class="loading ? 'opacity-50 pointer-events-none' : ''"
      >
        <template #item-wrapper="{ item, expanded, selected, ui }: { item: AppTreeNode; expanded: boolean; selected: boolean; ui: any }">
          <!-- Inline folder-name input (replaces normal item row) -->
          <div
            v-if="item.slug === CREATE_SLUG"
            class="w-full px-1 py-0.5"
            @click.stop
          >
            <div class="flex items-center gap-1.5 px-2 py-1 rounded-md ring-1 ring-primary bg-elevated">
              <UIcon name="i-lucide-folder" class="size-4 shrink-0 text-muted" />
              <input
                :ref="(el) => el && (el as HTMLInputElement).focus()"
                v-model="inlineCreateName"
                type="text"
                placeholder="Folder name…"
                class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted min-w-0"
                @keydown.enter.prevent="confirmCreate"
                @keydown.escape.prevent="cancelCreate"
                @blur="confirmCreate"
              >
            </div>
          </div>

          <!-- Normal tree item -->
          <div
            v-else
            :draggable="allowDrag ? 'true' : 'false'"
            class="group/item w-full flex items-center"
            :class="{
              'opacity-40': dragging === item.slug,
              'ring-2 ring-inset ring-primary rounded-md': dropTarget === item.slug && dropValid,
              'ring-2 ring-inset ring-error rounded-md': dropTarget === item.slug && !dropValid && dragging,
            }"
            @dragstart.stop="allowDrag && onDragStart($event, item)"
            @dragover.prevent.stop="allowDrag && onDragOver($event, item.slug)"
            @dragleave.stop="allowDrag && onDragLeave()"
            @drop.stop="allowDrag && onDrop($event, item.slug)"
          >
            <!-- Main link area — pointer-events-none so reka-ui handles clicks -->
            <span :class="[ui.link({ selected }), 'flex-1 pointer-events-none']">
              <UIcon :name="getIcon(item, expanded)" class="size-5 shrink-0" />
              <span class="truncate flex-1">{{ item.label }}</span>
              <UIcon
                v-if="item._isFolder"
                name="i-lucide-chevron-down"
                class="size-4 ms-auto shrink-0 transform transition-transform duration-200"
                :class="expanded ? 'rotate-180' : ''"
              />
            </span>

            <!-- Per-folder create button — always visible, subtle -->
            <button
              v-if="allowFolderCreate && item._isFolder && !isDraggingAny && inlineCreate === null"
              type="button"
              class="opacity-40 hover:opacity-100 px-1.5 py-1.5 shrink-0 text-muted hover:text-highlighted transition-opacity"
              title="New subfolder"
              @click.stop="openInlineCreate(item.slug)"
            >
              <UIcon name="i-lucide-folder-plus" class="size-3.5" />
            </button>
          </div>
        </template>
      </UTree>

      <!-- Root drop zone — appears when dragging -->
      <div
        v-if="isDraggingAny"
        class="mx-2 mt-1 mb-2 rounded-md border-2 border-dashed flex items-center justify-center py-2 text-xs transition-colors"
        :class="dropTarget === '__root__' && dropValid
          ? 'border-primary text-primary bg-primary/5'
          : 'border-default text-muted'"
        @dragover.prevent="onDragOver($event, null)"
        @dragleave="onDragLeave()"
        @drop.prevent="onDrop($event, null)"
      >
        <UIcon name="i-lucide-corner-left-up" class="size-3.5 me-1" />
        Move to root
      </div>
    </div>

    <!-- Root-level folder create -->
    <div v-if="allowFolderCreate && !isSearching && !isDraggingAny && inlineCreate === null" class="px-2 py-1.5 shrink-0 border-t border-default">
      <button
        type="button"
        class="flex items-center gap-1.5 px-2 py-1 text-xs text-muted hover:text-highlighted hover:bg-elevated/50 rounded-md w-full transition-colors"
        @click="openInlineCreate(null)"
      >
        <UIcon name="i-lucide-folder-plus" class="size-3.5" />
        New folder
      </button>
    </div>
  </div>
</template>
