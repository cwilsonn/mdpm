<script setup lang="ts">
import type { DocTreeItem } from './DocTreeList.vue'

const props = defineProps<{
  docs: DocTreeItem[]
  baseUrl: string
}>()

const q = ref('')

const filtered = computed(() => {
  const query = q.value.trim().toLowerCase()
  if (!query) return props.docs
  return props.docs.filter(d =>
    d.title.toLowerCase().includes(query)
    || d.tags.some(t => t.toLowerCase().includes(query))
    || d.excerpt?.toLowerCase().includes(query),
  )
})

const isSearching = computed(() => q.value.trim().length > 0)
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

    <!-- Search results: flat list -->
    <div v-if="isSearching" class="overflow-y-auto flex-1 min-h-0">
      <div v-if="!filtered.length" class="flex flex-col items-center justify-center py-16 text-center gap-2">
        <UIcon name="i-lucide-search-x" class="size-8 text-muted" />
        <p class="text-sm text-muted">No docs match "{{ q }}"</p>
      </div>
      <NuxtLink
        v-for="doc in filtered"
        :key="doc.slug"
        :to="`${baseUrl}/${doc.slug}`"
        class="flex flex-col gap-0.5 px-4 py-2.5 hover:bg-muted/40 transition-colors border-b border-default last:border-b-0"
      >
        <span class="text-sm font-medium truncate">{{ doc.title }}</span>
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

    <!-- Default: tree view -->
    <div v-else class="overflow-y-auto flex-1 min-h-0">
      <DocTreeList :docs="docs" :base-url="baseUrl" />
    </div>
  </div>
</template>
