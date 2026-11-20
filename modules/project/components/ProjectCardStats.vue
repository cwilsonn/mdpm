<script setup lang="ts">
defineProps<{
  projectSlug: string
  taskCounts?: { total: number, done: number } | null
  overdueCount: number
  docCount: number
  createdAt: string
  repo?: string
}>()
</script>

<template>
  <div class="flex items-center gap-3 text-xs text-muted flex-wrap">
    <span v-if="taskCounts" class="flex items-center gap-1">
      <UIcon name="i-lucide-circle-check" class="size-3.5 shrink-0" />
      {{ taskCounts.done }}/{{ taskCounts.total }}<span class="sr-only"> tasks done</span>
    </span>
    <span v-if="docCount" class="flex items-center gap-1">
      <UIcon name="i-lucide-book-open" class="size-3.5 shrink-0" />
      {{ docCount }}<span class="sr-only"> {{ docCount === 1 ? 'doc' : 'docs' }}</span>
    </span>
    <span v-if="overdueCount" class="flex items-center gap-1 text-error">
      <UIcon name="i-lucide-clock-alert" class="size-3.5 shrink-0" />
      {{ overdueCount }}<span class="sr-only"> overdue</span>
    </span>
    <a
      v-if="repo"
      :href="repoHref(repo)"
      target="_blank"
      rel="noopener noreferrer"
      class="relative z-10 inline-flex items-center gap-1 min-h-6 hover:text-primary transition-colors"
    >
      <UIcon name="i-lucide-folder-git-2" class="size-3.5 shrink-0" />
      {{ repoLabel(repo) }}<span class="sr-only"> (opens in a new tab)</span>
    </a>
    <p class="ml-auto">{{ createdAt }}</p>
  </div>
</template>
