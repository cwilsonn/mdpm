<script setup lang="ts">
defineProps<{
  projectSlug: string
  taskCounts?: { total: number, done: number } | null
  overdueCount: number
  docCount: number
  createdAt: string
  githubRepo?: string
}>()
</script>

<template>
  <div class="flex items-center gap-3 text-xs text-muted flex-wrap">
    <span v-if="taskCounts" class="flex items-center gap-1">
      <UIcon name="i-lucide-circle-check" class="size-3.5 shrink-0" />
      {{ taskCounts.done }}/{{ taskCounts.total }}
    </span>
    <span v-if="docCount" class="flex items-center gap-1">
      <UIcon name="i-lucide-book-open" class="size-3.5 shrink-0" />
      {{ docCount }}
    </span>
    <span v-if="overdueCount" class="flex items-center gap-1 text-error">
      <UIcon name="i-lucide-clock-alert" class="size-3.5 shrink-0" />
      {{ overdueCount }}
    </span>
    <a
      v-if="githubRepo"
      :href="`https://github.com/${githubRepo}`"
      target="_blank"
      rel="noopener noreferrer"
      class="flex items-center gap-1 hover:text-primary transition-colors"
      @click.stop
    >
      <UIcon name="i-lucide-github" class="size-3.5 shrink-0" />
      {{ githubRepo }}
    </a>
    <p class="ml-auto">{{ createdAt }}</p>
  </div>
</template>
