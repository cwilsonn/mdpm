<script setup lang="ts">
defineProps<{
  project: {
    status: string
    tags?: string[]
    description?: string
    githubRepo?: string
  }
}>()
</script>

<template>
  <div class="space-y-2 shrink-0">
    <div class="flex items-center gap-2 flex-wrap">
      <UBadge
        :label="project.status"
        :color="PROJECT_STATUS_MAP[project.status]?.color ?? 'neutral'"
        variant="subtle"
      />
      <UBadge
        v-for="tag in project.tags"
        :key="tag"
        :label="tag"
        color="neutral"
        variant="outline"
        size="sm"
      />
      <a
        v-if="project.githubRepo"
        :href="`https://github.com/${project.githubRepo}`"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-1 text-xs text-muted hover:text-primary transition-colors"
      >
        <UIcon name="i-lucide-github" class="size-3.5 shrink-0" />
        {{ project.githubRepo }}
      </a>
    </div>
    <p v-if="project.description" class="text-sm text-muted">
      {{ project.description }}
    </p>
  </div>
</template>
