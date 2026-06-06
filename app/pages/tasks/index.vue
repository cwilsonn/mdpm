<script setup lang="ts">
definePageMeta({ title: 'Tasks', icon: 'i-lucide-list-checks' })

const { projects, tasks, refreshAll } = await useProjectTasks({ projects: 'tasks-projects', tasks: 'tasks-all' })
</script>

<template>
  <AppPageBase
    title="Tasks"
    icon="i-lucide-list-checks"
    back-to="/"
  >
    <div class="">
      <AppTaskList
        :tasks="((tasks ?? []) as any[])"
        :projects="((projects ?? []) as any[])"
        @refresh="refreshAll"
      />
    </div>
  </AppPageBase>
</template>
