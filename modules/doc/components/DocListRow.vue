<script setup lang="ts">
// One doc in DocList: title, an excerpt and up to three tags; across groups (search) also the group it is in.
defineProps<{
  doc: DocItem
  to: string
  groupLabel?: string
  groupIcon?: string
}>()
</script>

<template>
  <NuxtLink
    :to="to"
    class="flex flex-col gap-0.5 px-4 py-2.5 hover:bg-muted/40 transition-colors border-b border-default last:border-b-0"
    :class="doc.archivedAt ? 'opacity-60' : ''"
  >
    <div class="flex items-center gap-1.5">
      <UIcon name="i-lucide-file-text" class="size-4 shrink-0 text-muted" />
      <span class="text-sm font-medium truncate flex-1">{{ doc.title }}</span>
      <UIcon v-if="doc.archivedAt" name="i-lucide-archive" class="size-3.5 shrink-0 text-muted" />
      <span v-if="groupLabel" class="text-xs text-muted shrink-0 flex items-center gap-1">
        <UIcon v-if="groupIcon" :name="groupIcon" class="size-3" />
        {{ groupLabel }}
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
</template>
