<script setup lang="ts">
export interface DocGroup {
  label: string
  icon?: string
  docs: DocItem[]
  baseUrl: string
  projectSlug: string | null
}

const props = defineProps<{
  // single-group mode
  docs?: DocItem[]
  baseUrl?: string
  projectSlug?: string | null
  // multi-group mode
  groups?: DocGroup[]
}>()

// ── Search ─────────────────────────────────────────────────────────────────
const q = ref('')
const isSearching = computed(() => q.value.trim().length > 0)

const { showArchived } = useArchiveFilter()

const rawGroups = computed((): DocGroup[] => {
  if (props.groups) return props.groups
  return [{
    label: '',
    docs: props.docs ?? [],
    baseUrl: props.baseUrl ?? '',
    projectSlug: props.projectSlug ?? null,
  }]
})

// Docs are flat: archived ones are hidden unless asked for, the rest sorted by title.
function visibleDocs(docs: DocItem[]): DocItem[] {
  return docs
    .filter(d => showArchived.value || !d.archivedAt)
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
}

const effectiveGroups = computed((): DocGroup[] =>
  rawGroups.value.map(g => ({ ...g, docs: visibleDocs(g.docs) })),
)

const archivedCount = computed(() =>
  rawGroups.value.reduce((n, g) => n + g.docs.filter(d => d.archivedAt).length, 0),
)

const allDocs = computed(() =>
  effectiveGroups.value.flatMap(g =>
    g.docs.map(d => ({ ...d, _baseUrl: g.baseUrl, _groupLabel: g.label, _groupIcon: g.icon })),
  ),
)

const filtered = computed(() => {
  const query = q.value.trim().toLowerCase()
  if (!query) return allDocs.value
  return allDocs.value.filter(d =>
    d.title.toLowerCase().includes(query)
    || d.tags.some(t => t.toLowerCase().includes(query))
    || d.excerpt?.toLowerCase().includes(query),
  )
})

// ── Collapsible sections (multi-group only) ────────────────────────────────
function sectionKey(g: DocGroup) {
  return `mdpm:docs-section:${g.projectSlug ?? 'general'}`
}

const collapsed = ref<Record<string, boolean>>({})

onMounted(() => {
  if (!props.groups) return
  for (const g of props.groups) {
    const key = sectionKey(g)
    collapsed.value[key] = localStorage.getItem(key) === 'collapsed'
  }
})

function toggleSection(g: DocGroup) {
  const key = sectionKey(g)
  const next = !collapsed.value[key]
  collapsed.value[key] = next
  localStorage.setItem(key, next ? 'collapsed' : 'expanded')
}

</script>

<template>
  <div class="flex flex-col gap-0 h-full">
    <div class="px-4 py-2 border-b border-default shrink-0 flex items-center gap-2">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        placeholder="Search docs…"
        size="sm"
        class="flex-1"
      >
        <template v-if="q" #trailing>
          <UButton icon="i-lucide-x" color="neutral" variant="ghost" size="xs" @click="() => { q = '' }" />
        </template>
      </UInput>
      <UButton
        v-if="archivedCount"
        :icon="showArchived ? 'i-lucide-eye-off' : 'i-lucide-archive'"
        :label="showArchived ? 'Hide archived' : `Archived (${archivedCount})`"
        color="neutral"
        variant="ghost"
        size="sm"
        class="shrink-0"
        @click="() => { showArchived = !showArchived }"
      />
    </div>

    <!-- Search: results across all groups -->
    <div v-if="isSearching" class="overflow-y-auto flex-1 min-h-0">
      <div v-if="!filtered.length" class="flex flex-col items-center justify-center py-16 text-center gap-2">
        <UIcon name="i-lucide-search-x" class="size-8 text-muted" />
        <p class="text-sm text-muted">No docs match "{{ q }}"</p>
      </div>
      <DocListRow
        v-for="doc in filtered"
        :key="`${doc._baseUrl}/${doc.slug}`"
        :doc="doc"
        :to="`${doc._baseUrl}/${doc.slug}`"
        :group-label="doc._groupLabel"
        :group-icon="doc._groupIcon"
      />
    </div>

    <!-- List (multi-group or single group) -->
    <div v-else class="overflow-y-auto flex-1 min-h-0">
      <template v-for="group in effectiveGroups" :key="group.label || 'single'">
        <!-- Group header (multi-group mode only) — clickable to collapse -->
        <button
          v-if="groups"
          type="button"
          class="w-full flex items-center gap-1.5 px-4 py-1.5 border-b border-default bg-muted/30 sticky top-0 z-10 hover:bg-muted/50 transition-colors"
          @click="toggleSection(group)"
        >
          <UIcon v-if="group.icon" :name="group.icon" class="size-3.5 text-muted shrink-0" />
          <span class="text-xs font-medium text-muted uppercase tracking-wide flex-1 text-left">{{ group.label }}</span>
          <span class="text-xs text-muted">{{ group.docs.length }}</span>
          <UIcon
            name="i-lucide-chevron-down"
            class="size-3.5 text-muted transition-transform duration-150 ml-1"
            :class="collapsed[sectionKey(group)] ? '-rotate-90' : ''"
          />
        </button>

        <template v-if="!groups || !collapsed[sectionKey(group)]">
          <DocListRow
            v-for="doc in group.docs"
            :key="doc.slug"
            :doc="doc"
            :to="`${group.baseUrl}/${doc.slug}`"
          />
        </template>
      </template>
    </div>
  </div>
</template>
