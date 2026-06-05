<script setup lang="ts">
definePageMeta({ title: 'Tasks', icon: 'i-lucide-list-checks' })

const [{ data: tasks, refresh: refreshTasks }, { data: projects, refresh: refreshProjects }] = await Promise.all([
  useAsyncData('tasks-all', () => queryCollection('tasks').order('createdAt', 'DESC').all()),
  useAsyncData('tasks-projects', () => queryCollection('projects').select('path', 'title').all()),
])

async function refreshAll() {
  await Promise.all([refreshTasks(), refreshProjects()])
}
</script>

<template>
  <AppPageBase
    title="Tasks"
    icon="i-lucide-list-checks"
  >
    <div class="p-4 sm:p-6">
      <AppTaskList
        :tasks="(tasks ?? []) as any[]"
        :projects="(projects ?? []) as any[]"
        @refresh="refreshAll"
      />
    </div>
  </AppPageBase>
</template>
