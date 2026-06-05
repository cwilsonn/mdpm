<script setup lang="ts">
const route = useRoute()
const projectSlug = computed(() => route.params.slug as string)
const taskSlug = computed(() => route.params.task as string)

const { data: task, refresh } = await useAsyncData(
  () => `task-${projectSlug.value}-${taskSlug.value}`,
  () => queryCollection('tasks')
    .where('path', '=', `/projects/${projectSlug.value}/tasks/${taskSlug.value}`)
    .first(),
)

type ProjectTask = { slug: string, title: string, status: string }
const { data: depTasks } = await useAsyncData(
  () => `task-deps-${projectSlug.value}-${taskSlug.value}`,
  async () => {
    const deps = (task.value as any)?.dependencies as string[] | undefined
    if (!deps?.length) return []
    const all = await $fetch<ProjectTask[]>(`/api/tasks/${projectSlug.value}`)
    return all.filter(t => deps.includes(t.slug))
  },
)

if (!task.value) {
  throw createError({ statusCode: 404, message: 'Task not found' })
}

const { statusColor, statusIcon, priorityColor, priorityIcon } = useTaskMeta()

const showEdit = ref(false)
const showDeleteConfirm = ref(false)
const deleting = ref(false)

async function deleteTask() {
  deleting.value = true
  try {
    await $fetch(`/api/tasks/${projectSlug.value}/${taskSlug.value}`, { method: 'DELETE' })
    await navigateTo(`/projects/${projectSlug.value}`)
  }
  finally {
    deleting.value = false
  }
}

const breadcrumb = computed(() => [
  { label: 'Projects', to: '/projects', icon: 'i-lucide-folder' },
  { label: projectSlug.value, to: `/projects/${projectSlug.value}`, icon: 'i-lucide-folder-open' },
  { label: task.value?.title ?? taskSlug.value },
])
</script>

<template>
  <AppPageBase
    :breadcrumb="breadcrumb"
    :back-to="`/projects/${projectSlug}`"
  >
    <template #actions>
      <UButton
        label="Edit"
        icon="i-lucide-pencil"
        color="neutral"
        variant="outline"
        size="sm"
        @click="showEdit = true"
      />
      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="sm"
        @click="showDeleteConfirm = true"
      />
    </template>

    <div class="p-4 sm:p-6 max-w-3xl space-y-6">
      <div class="space-y-3">
        <h1 class="text-2xl font-bold leading-tight">
          {{ task!.title }}
        </h1>

        <div class="flex items-center gap-2 flex-wrap">
          <UBadge
            :label="task!.status"
            :color="statusColor(task!.status)"
            :icon="statusIcon(task!.status)"
            variant="subtle"
          />
          <UBadge
            :label="task!.priority"
            :color="priorityColor(task!.priority)"
            :icon="priorityIcon(task!.priority)"
            variant="subtle"
          />
          <UBadge
            v-for="tag in task!.tags"
            :key="tag"
            :label="tag"
            color="neutral"
            variant="outline"
            size="sm"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm border-t border-default pt-4">
        <div v-if="task!.due">
          <p class="text-xs text-muted font-medium uppercase tracking-wide mb-1">
            Due
          </p>
          <p
            :class="formatDueDate(task!.due)?.isOverdue
              ? 'text-error font-medium'
              : formatDueDate(task!.due)?.isDueSoon
                ? 'text-warning'
                : ''"
          >
            {{ formatDueDate(task!.due)?.label ?? task!.due }}
            <span class="text-muted font-normal text-xs ml-1">({{ task!.due }})</span>
          </p>
        </div>
        <div v-if="task!.assignees?.length">
          <p class="text-xs text-muted font-medium uppercase tracking-wide mb-1">
            Assignees
          </p>
          <div class="flex flex-col gap-1.5 mt-1">
            <div
              v-for="a in task!.assignees"
              :key="a"
              class="flex items-center gap-2"
            >
              <UAvatar
                :alt="a"
                size="xs"
              />
              <span class="text-sm">{{ a }}</span>
            </div>
          </div>
        </div>
        <div>
          <p class="text-xs text-muted font-medium uppercase tracking-wide mb-1">
            Created
          </p>
          <p>{{ task!.createdAt }}</p>
        </div>
        <div v-if="task!.updatedAt">
          <p class="text-xs text-muted font-medium uppercase tracking-wide mb-1">
            Updated
          </p>
          <p>{{ new Date(task!.updatedAt).toLocaleString() }}</p>
        </div>
      </div>

      <div
        v-if="depTasks?.length"
        class="space-y-2 border-t border-default pt-4"
      >
        <p class="text-xs text-muted font-medium uppercase tracking-wide">
          Dependencies
        </p>
        <div class="flex flex-col gap-1.5">
          <div
            v-for="dep in depTasks"
            :key="dep.slug"
            class="flex items-center gap-2"
          >
            <UIcon
              :name="STATUS_MAP[dep.status]?.icon ?? 'i-lucide-circle'"
              class="size-4 shrink-0"
              :class="`text-${STATUS_MAP[dep.status]?.color ?? 'neutral'}`"
            />
            <NuxtLink
              :to="`/projects/${projectSlug}/tasks/${dep.slug}`"
              class="text-sm hover:underline"
            >
              {{ dep.title }}
            </NuxtLink>
          </div>
        </div>
      </div>

      <div
        v-if="task!.body"
        class="prose prose-sm dark:prose-invert max-w-none border-t border-default pt-4"
      >
        <ContentRenderer :value="task!" />
      </div>
    </div>

    <template #overlays>
      <TaskForm
        v-if="showEdit"
        :project-slug="projectSlug"
        :task="task!"
        @close="() => { showEdit = false; refresh() }"
      />
      <UModal
        :open="showDeleteConfirm"
        title="Delete task?"
        description="This cannot be undone."
        @update:open="showDeleteConfirm = false"
      >
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              color="neutral"
              variant="outline"
              @click="showDeleteConfirm = false"
            />
            <UButton
              label="Delete"
              color="error"
              :loading="deleting"
              @click="deleteTask"
            />
          </div>
        </template>
      </UModal>
    </template>
  </AppPageBase>
</template>
