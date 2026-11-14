<script setup lang="ts">
definePageMeta({ title: 'Inbox', icon: 'i-lucide-inbox' })

const { projects, tasks, refreshAll } = await useProjectTasks(
  { projects: 'inbox-projects', tasks: 'inbox-tasks' },
  // The inbox's status filter never offers done, so done tasks are not fetched at all.
  { statuses: ['todo', 'in-progress', 'in-review', 'blocked', 'on-hold'] },
)

const inboxStatuses = (STATUS_SELECT_ITEMS as Array<{ label: string; value: string; icon?: string; color?: string }>)
  .filter(s => ['todo', 'in-progress', 'blocked'].includes(s.value))
</script>

<template>
  <AppPageBase
    title="Inbox"
    icon="i-lucide-inbox"
  >
    <InboxTaskList
      :tasks="((tasks ?? []) as any[])"
      :projects="((projects ?? []) as any[])"
      :preset-statuses="(inboxStatuses as any[])"
      @refresh="refreshAll"
    />
  </AppPageBase>
</template>
