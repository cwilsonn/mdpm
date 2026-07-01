<script setup lang="ts">
import type { TreeItem } from '@nuxt/ui'

export interface AppTreeItem {
  slug: string
  label: string
  parent?: string | null
  icon?: string
  isFolder?: boolean
  order?: number
}

type AppTreeNode = TreeItem & {
  slug: string
  _isFolder: boolean
}

type DropMode = 'before' | 'after' | 'into'

interface DropIndicator {
  slug: string
  mode: DropMode
  parent: string | null
  order: number
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
  reparent: [payload: { slug: string; parent: string | null; order: number }]
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
const dropIndicator = ref<DropIndicator | null>(null)
const rootDropOver = ref(false)
const isDraggingAny = computed(() => dragging.value !== null)

function getItemParent(slug: string): string | null {
  return props.items.find(i => i.slug === slug)?.parent ?? null
}

function getSiblings(parent: string | null, excludeSlug: string): AppTreeItem[] {
  return props.items
    .filter(i => (i.parent ?? null) === parent && i.slug !== excludeSlug)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

function computeOrder(parent: string | null, afterSlug: string | null): number {
  const siblings = getSiblings(parent, dragging.value!)
  if (afterSlug === null) {
    return siblings.length > 0 ? (siblings[0]!.order ?? 0) - 1 : 0
  }
  const idx = siblings.findIndex(s => s.slug === afterSlug)
  if (idx === -1) {
    return siblings.length > 0 ? (siblings[siblings.length - 1]!.order ?? 0) + 1 : 0
  }
  const after = siblings[idx]!
  const next = siblings[idx + 1]
  if (!next) return (after.order ?? 0) + 1
  return Math.floor(((after.order ?? 0) + (next.order ?? 0)) / 2)
}

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

function canDrop(draggedSlug: string, parent: string | null): boolean {
  if (parent === draggedSlug) return false
  if (parent !== null && isDescendant(parent, draggedSlug)) return false
  return true
}

function onDragStart(e: DragEvent, item: AppTreeNode) {
  dragging.value = item.slug
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', item.slug)
}

function onDragOver(e: DragEvent, item: AppTreeNode) {
  if (!dragging.value) return
  rootDropOver.value = false

  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const relY = (e.clientY - rect.top) / rect.height

  let mode: DropMode
  if (item._isFolder) {
    if (relY < 0.25) mode = 'before'
    else if (relY > 0.75) mode = 'after'
    else mode = 'into'
  }
  else {
    mode = relY < 0.5 ? 'before' : 'after'
  }

  let parent: string | null
  let afterSlug: string | null

  if (mode === 'into') {
    parent = item.slug
    const children = getSiblings(item.slug, dragging.value)
    afterSlug = children.length > 0 ? (children[children.length - 1]?.slug ?? null) : null
  }
  else if (mode === 'before') {
    parent = getItemParent(item.slug)
    const siblings = getSiblings(parent, dragging.value)
    const idx = siblings.findIndex(s => s.slug === item.slug)
    afterSlug = idx > 0 ? (siblings[idx - 1]?.slug ?? null) : null
  }
  else {
    parent = getItemParent(item.slug)
    afterSlug = item.slug
  }

  if (!canDrop(dragging.value, parent)) {
    e.dataTransfer!.dropEffect = 'none'
    dropIndicator.value = null
    return
  }

  e.dataTransfer!.dropEffect = 'move'
  dropIndicator.value = { slug: item.slug, mode, parent, order: computeOrder(parent, afterSlug) }
}

function onDrop(e: DragEvent) {
  const slug = dragging.value
  if (!slug || !dropIndicator.value) return
  const { parent, order } = dropIndicator.value
  if (!canDrop(slug, parent)) return
  emit('reparent', { slug, parent, order })
  dragging.value = null
  dropIndicator.value = null
}

function onDragOverRoot(e: DragEvent) {
  if (!dragging.value) return
  dropIndicator.value = null
  rootDropOver.value = canDrop(dragging.value, null)
  e.dataTransfer!.dropEffect = rootDropOver.value ? 'move' : 'none'
}

function onDropRoot(e: DragEvent) {
  const slug = dragging.value
  if (!slug || !canDrop(slug, null)) return
  const siblings = getSiblings(null, slug)
  const order = siblings.length > 0 ? (siblings[siblings.length - 1]!.order ?? 0) + 1 : 0
  emit('reparent', { slug, parent: null, order })
  dragging.value = null
  dropIndicator.value = null
  rootDropOver.value = false
}

function onDragEnd() {
  dragging.value = null
  dropIndicator.value = null
  rootDropOver.value = false
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
    class="flex flex-col select-none"
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
          <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" @click="() => { q = '' }" />
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

    <!-- Tree view — content-sized; parent is the scroll container -->
    <div v-else>
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
            class="relative group/item w-full flex items-center"
            :class="{
              'opacity-40': dragging === item.slug,
              'ring-2 ring-inset ring-primary rounded-md': dropIndicator?.slug === item.slug && dropIndicator.mode === 'into',
            }"
            @dragstart.stop="allowDrag && onDragStart($event, item)"
            @dragover.prevent.stop="allowDrag && onDragOver($event, item)"
            @drop.prevent.stop="allowDrag && onDrop($event)"
          >
            <!-- Insert-before line -->
            <div
              v-if="dropIndicator?.slug === item.slug && dropIndicator.mode === 'before'"
              class="absolute -top-px left-1 right-1 h-0.5 bg-primary rounded-full z-20 pointer-events-none"
            />
            <!-- Insert-after line -->
            <div
              v-if="dropIndicator?.slug === item.slug && dropIndicator.mode === 'after'"
              class="absolute -bottom-px left-1 right-1 h-0.5 bg-primary rounded-full z-20 pointer-events-none"
            />

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
        :class="rootDropOver ? 'border-primary text-primary bg-primary/5' : 'border-default text-muted'"
        @dragover.prevent="onDragOverRoot"
        @dragleave="rootDropOver = false"
        @drop.prevent="onDropRoot"
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
