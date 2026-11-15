<script setup lang="ts">
definePageMeta({ title: 'Inbox', icon: 'i-lucide-inbox' })

const { projects, tasks, refreshAll } = await useProjectTasks(
  { projects: 'inbox-projects', tasks: 'inbox-tasks' },
  // The inbox's status filter never offers done, so done tasks are not fetched at all.
  { statuses: ['todo', 'in-progress', 'in-review', 'blocked', 'on-hold'] },
)

const inboxStatuses: FilterItem[] = STATUS_SELECT_ITEMS
  .filter(s => ['todo', 'in-progress', 'blocked'].includes(s.value))
</script>

<template>
  <AppPageBase
    title="Inbox"
    icon="i-lucide-inbox"
  >
    <InboxTaskList
      :tasks="(tasks ?? []) as Task[]"
      :projects="projects ?? []"
      :preset-statuses="inboxStatuses"
      @refresh="refreshAll"
    />
  </AppPageBase>
</template>
