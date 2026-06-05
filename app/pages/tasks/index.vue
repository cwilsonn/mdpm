<script setup lang="ts">
definePageMeta({ title: 'Tasks', icon: 'i-lucide-list-checks' })

const { projects, tasks, refreshAll } = await useProjectTasks({ projects: 'tasks-projects', tasks: 'tasks-all' })
</script>

<template>
  <AppPageBase
    title="Tasks"
    icon="i-lucide-list-checks"
  >
    <div class="p-4 sm:p-6">
      <AppTaskList
        :tasks="((tasks ?? []) as any[])"
        :projects="((projects ?? []) as any[])"
        @refresh="refreshAll"
      />
    </div>
  </AppPageBase>
</template>
