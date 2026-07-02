<script setup lang="ts">
const route = useRoute()
const projectSlug = computed(() => route.params.slug as string)
const taskSlug = computed(() => route.params.task as string)

interface TaskDetail {
  slug: string; path: string; project: string; title: string
  status: string; priority: string; tags: string[]; assignees: string[]
  dependencies: string[]; due?: string; createdAt: string
  updatedAt?: string; order: number; body: string
  githubIssues?: number[]; githubPRs?: number[]; githubRepo?: string
}

interface ProjectHeader { slug: string; title: string; icon?: string; status: string }

const project = inject<Ref<ProjectHeader>>('project')!

const { data: task, refresh } = await useAsyncData(
  () => `task-${projectSlug.value}-${taskSlug.value}`,
  () => $fetch<TaskDetail>(`/api/tasks/${projectSlug.value}/${taskSlug.value}`).catch(() => null),
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
const { updateTask, removeTask } = useTasks()
const { tryWithToast } = useApiToast()

const showEdit = ref(false)
const showDeleteConfirm = ref(false)
const deleting = ref(false)
const toggling = ref(false)

async function setStatus(status: string) {
  toggling.value = true
  try {
    if (await tryWithToast(() => updateTask(projectSlug.value, taskSlug.value, { status }), 'Failed to update task')) {
      await refresh()
    }
  }
  finally {
    toggling.value = false
  }
}

async function deleteTask() {
  deleting.value = true
  try {
    if (await tryWithToast(() => removeTask(projectSlug.value, taskSlug.value), 'Failed to delete task')) {
      await navigateTo(`/projects/${projectSlug.value}/tasks`)
    }
  }
  finally {
    deleting.value = false
  }
}

useHead(() => ({ title: task.value?.title ?? taskSlug.value }))

const projectsMeta = resolveRouteMeta('/projects')
const breadcrumb = computed(() => [
  { label: projectsMeta.label ?? 'Projects', to: '/projects', icon: projectsMeta.icon },
  { label: project.value?.title ?? projectSlug.value, to: `/projects/${projectSlug.value}/tasks`, icon: project.value?.icon || undefined },
  { label: task.value?.title ?? taskSlug.value },
])

const mobileActions = computed(() => [
  task.value?.status !== 'done'
    ? { label: 'Complete', icon: 'i-lucide-check-circle', color: 'success' as const, onSelect: () => setStatus('done') }
    : { label: 'Re-open', icon: 'i-lucide-rotate-ccw', color: 'neutral' as const, onSelect: () => setStatus('todo') },
  { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => { showEdit.value = true } },
  { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { showDeleteConfirm.value = true } },
])
</script>

<template>
  <AppPageBase
    :breadcrumb="breadcrumb"
    :back-to="`/projects/${projectSlug}`"
    :mobile-actions="mobileActions"
  >
    <template #actions>
      <UButton
        v-if="task!.status !== 'done'"
        label="Complete"
        icon="i-lucide-check-circle"
        color="success"
        variant="outline"
        size="sm"
        :loading="toggling"
        @click="setStatus('done')"
      />
      <UButton
        v-else
        label="Re-open"
        icon="i-lucide-rotate-ccw"
        color="neutral"
        variant="outline"
        size="sm"
        :loading="toggling"
        @click="setStatus('todo')"
      />
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

    <div class="overflow-y-auto flex-1 min-h-0">
    <div class="max-w-5xl mx-auto space-y-6 p-4 sm:p-6">
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
                size="sm"
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
        v-if="task!.githubIssues?.length || task!.githubPRs?.length"
        class="space-y-2 border-t border-default pt-4"
      >
        <p class="text-xs text-muted font-medium uppercase tracking-wide">
          GitHub
        </p>
        <div class="flex flex-wrap gap-2">
          <a
            v-for="n in task!.githubIssues"
            :key="`i-${n}`"
            :href="task!.githubRepo ? `https://github.com/${task!.githubRepo}/issues/${n}` : undefined"
            :target="task!.githubRepo ? '_blank' : undefined"
            rel="noopener noreferrer"
            class="flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-md border border-default hover:border-primary hover:text-primary transition-colors"
            :class="task!.githubRepo ? 'cursor-pointer' : 'cursor-default text-muted'"
          >
            <UIcon name="i-lucide-circle-dot" class="size-4 shrink-0" />
            Issue #{{ n }}
          </a>
          <a
            v-for="n in task!.githubPRs"
            :key="`p-${n}`"
            :href="task!.githubRepo ? `https://github.com/${task!.githubRepo}/pull/${n}` : undefined"
            :target="task!.githubRepo ? '_blank' : undefined"
            rel="noopener noreferrer"
            class="flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-md border border-default hover:border-primary hover:text-primary transition-colors"
            :class="task!.githubRepo ? 'cursor-pointer' : 'cursor-default text-muted'"
          >
            <UIcon name="i-lucide-git-pull-request" class="size-4 shrink-0" />
            PR #{{ n }}
          </a>
        </div>
      </div>

      <div
        v-if="task!.body"
        class="prose prose-sm dark:prose-invert max-w-none border-t border-default pt-4"
      >
        <MDC :value="(task!.body as string)" />
      </div>
    </div>
    </div>

    <template #overlays>
      <TaskForm
        v-if="showEdit"
        :project-slug="projectSlug"
        :task="task!"
        @close="() => { showEdit = false; refresh() }"
      />
      <AppConfirmDialog
        :open="showDeleteConfirm"
        title="Delete task?"
        message="This cannot be undone."
        confirm-label="Delete"
        :loading="deleting"
        @update:open="showDeleteConfirm = false"
        @confirm="deleteTask"
        @cancel="showDeleteConfirm = false"
      />
    </template>
  </AppPageBase>
</template>
