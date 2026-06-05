<script setup lang="ts">
const open = ref(false)

const { data: tasks } = await useAsyncData('search-tasks', () =>
  queryCollection('tasks').select('path', 'title', 'status', 'priority').all(),
)

const { data: projects } = await useAsyncData('search-projects', () =>
  queryCollection('projects').select('path', 'title', 'icon').all(),
)

function projectTitleOf(taskPath: string) {
  const pSlug = taskPath.split('/')[2]
  return projects.value?.find(p => slugFromPath(p.path) === pSlug)?.title ?? pSlug
}

function taskRoute(path: string) {
  const parts = path.split('/')
  return `/projects/${parts[2]}/tasks/${parts[4]}`
}

const groups = computed(() => [
  {
    id: 'projects',
    label: 'Projects',
    items: (projects.value ?? []).map(p => ({
      id: p.path,
      label: p.title,
      icon: p.icon || 'i-lucide-folder',
      to: `/projects/${slugFromPath(p.path)}`,
    })),
  },
  {
    id: 'tasks',
    label: 'Tasks',
    items: (tasks.value ?? []).map(t => ({
      id: t.path,
      label: t.title,
      suffix: projectTitleOf(t.path),
      icon: 'i-lucide-check-square',
      to: taskRoute(t.path),
    })),
  },
])
</script>

<template>
  <UDashboardSearch
    v-model:open="open"
    :groups="groups"
    placeholder="Search projects and tasks…"
    :color-mode="false"
  />
</template>
