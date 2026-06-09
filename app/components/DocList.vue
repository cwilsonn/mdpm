<script setup lang="ts">
import type { DocTreeItem } from './DocTreeList.vue'

export interface DocGroup {
  label: string
  icon?: string
  docs: DocTreeItem[]
  baseUrl: string
}

const props = defineProps<{
  // single-group mode
  docs?: DocTreeItem[]
  baseUrl?: string
  // multi-group mode
  groups?: DocGroup[]
}>()

const q = ref('')
const isSearching = computed(() => q.value.trim().length > 0)

// Flatten all docs across groups for search
const allDocs = computed((): Array<DocTreeItem & { _baseUrl: string; _groupLabel: string; _groupIcon?: string }> => {
  if (props.groups) {
    return props.groups.flatMap(g =>
      g.docs.map(d => ({ ...d, _baseUrl: g.baseUrl, _groupLabel: g.label, _groupIcon: g.icon })),
    )
  }
  return (props.docs ?? []).map(d => ({ ...d, _baseUrl: props.baseUrl!, _groupLabel: '' }))
})

const filtered = computed(() => {
  const query = q.value.trim().toLowerCase()
  if (!query) return allDocs.value
  return allDocs.value.filter(d =>
    d.title.toLowerCase().includes(query)
    || d.tags.some(t => t.toLowerCase().includes(query))
    || d.excerpt?.toLowerCase().includes(query),
  )
})

const singleDocs = computed(() => props.docs ?? [])
const singleBaseUrl = computed(() => props.baseUrl ?? '')
</script>

<template>
  <div class="flex flex-col gap-0 h-full">
    <div class="px-4 py-2 border-b border-default shrink-0">
      <UInput
        v-model="q"
        icon="i-lucide-search"
        placeholder="Search docs…"
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

    <!-- Search: flat results across all groups -->
    <div v-if="isSearching" class="overflow-y-auto flex-1 min-h-0">
      <div v-if="!filtered.length" class="flex flex-col items-center justify-center py-16 text-center gap-2">
        <UIcon name="i-lucide-search-x" class="size-8 text-muted" />
        <p class="text-sm text-muted">No docs match "{{ q }}"</p>
      </div>
      <NuxtLink
        v-for="doc in filtered"
        :key="`${doc._baseUrl}/${doc.slug}`"
        :to="`${doc._baseUrl}/${doc.slug}`"
        class="flex flex-col gap-0.5 px-4 py-2.5 hover:bg-muted/40 transition-colors border-b border-default last:border-b-0"
      >
        <div class="flex items-center gap-1.5">
          <span class="text-sm font-medium truncate flex-1">{{ doc.title }}</span>
          <span v-if="doc._groupLabel" class="text-xs text-muted shrink-0 flex items-center gap-1">
            <UIcon v-if="doc._groupIcon" :name="doc._groupIcon" class="size-3" />
            {{ doc._groupLabel }}
          </span>
        </div>
        <span v-if="doc.excerpt" class="text-xs text-muted line-clamp-2">{{ doc.excerpt }}</span>
        <div v-if="doc.tags.length" class="flex gap-1 flex-wrap mt-0.5">
          <UBadge
            v-for="tag in doc.tags.slice(0, 3)"
            :key="tag"
            :label="tag"
            color="neutral"
            variant="outline"
            size="xs"
          />
        </div>
      </NuxtLink>
    </div>

    <!-- Default: grouped tree sections or single tree -->
    <div v-else class="overflow-y-auto flex-1 min-h-0">
      <!-- Multi-group mode -->
      <template v-if="groups">
        <div
          v-for="group in groups"
          :key="group.label"
        >
          <div class="flex items-center gap-1.5 px-4 py-1.5 border-b border-default bg-muted/30 sticky top-0 z-10">
            <UIcon v-if="group.icon" :name="group.icon" class="size-3.5 text-muted shrink-0" />
            <span class="text-xs font-medium text-muted uppercase tracking-wide">{{ group.label }}</span>
            <span class="text-xs text-muted ml-auto">{{ group.docs.length }}</span>
          </div>
          <DocTreeList :docs="group.docs" :base-url="group.baseUrl" />
        </div>
      </template>

      <!-- Single-group mode -->
      <DocTreeList v-else :docs="singleDocs" :base-url="singleBaseUrl" />
    </div>
  </div>
</template>
