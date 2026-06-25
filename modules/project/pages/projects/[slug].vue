<script setup lang="ts">
const route = useRoute()
const slug = computed(() => route.params.slug as string)

interface ProjectDetail {
  slug: string; path: string; title: string; status: string
  icon?: string; description?: string; tags: string[]
  createdAt: string; updatedAt?: string
  availableStatuses: string[]
  defaultStatus?: string
  defaultPriority?: string
  defaultAssignee?: string
  githubRepo?: string
}

const { data: project, refresh: refreshProject } = await useAsyncData(
  () => `project-${slug.value}`,
  () => $fetch<ProjectDetail>(`/api/projects/${slug.value}`).catch(() => null),
)

if (!project.value) {
  throw createError({ statusCode: 404, message: 'Project not found' })
}

provide('project', project as Ref<ProjectDetail>)
provide('refreshProject', refreshProject)
</script>

<template>
  <NuxtPage />
</template>
