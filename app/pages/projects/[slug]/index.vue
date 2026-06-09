<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'

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
}

interface TaskItem {
  slug: string; path: string; project: string; title: string
  status: string; priority: string; tags: string[]; assignees: string[]
  dependencies: string[]; due?: string; createdAt: string
  updatedAt?: string; order: number
}

const { data: project, refresh: refreshProject } = await useAsyncData(
  () => `project-${slug.value}`,
  () => $fetch<ProjectDetail>(`/api/projects/${slug.value}`).catch(() => null),
)

if (!project.value) {
  throw createError({ statusCode: 404, message: 'Project not found' })
}

const { data: tasks, refresh: refreshTasks, pending: tasksPending } = await useAsyncData(
  () => `tasks-${slug.value}`,
  () => $fetch<TaskItem[]>(`/api/tasks/${slug.value}`),
)

type ColId = StatusId
type Task = NonNullable<typeof tasks.value>[0]

interface SelectItem { label: string; value: string; icon?: string; color?: string; avatar?: { alt: string } }

const searchQuery = ref('')
const filterStatuses = ref<SelectItem[]>([])   // empty = all columns visible
const filterPriorities = ref<SelectItem[]>([]) // empty = all priorities
const filterAssignees = ref<SelectItem[]>([])  // empty = all assignees

const allAssignees = computed(() => getAssigneeNames((tasks.value ?? []) as Array<{ assignees?: string[] }>))

const assigneeFilterItems = computed<SelectItem[]>(() =>
  allAssignees.value.map(name => ({ label: name, value: name, avatar: { alt: name } })),
)

const projectAvailableStatuses = computed(() => project.value?.availableStatuses ?? STATUS_CONFIG.map(s => s.id))

const statusesWithTasks = computed(() => STATUS_CONFIG.filter(s => columns[s.id]?.length > 0).map(s => s.id))

const visibleColumns = computed(() => {
  if (filterStatuses.value.length > 0) {
    return STATUS_CONFIG.filter(s => filterStatuses.value.some(f => f.value === s.id))
  }
  const baseIds = new Set([...projectAvailableStatuses.value, ...statusesWithTasks.value])
  return STATUS_CONFIG.filter(s => baseIds.has(s.id))
})

const statusFilterItems = computed(() =>
  STATUS_SELECT_ITEMS.filter(s => projectAvailableStatuses.value.includes(s.value)),
)

// Per-column arrays — VueDraggable v-model targets
const columns = reactive<Record<ColId, Task[]>>({
  'todo': [],
  'in-progress': [],
  'in-review': [],
  'blocked': [],
  'done': [],
})

function syncColumns(v: typeof tasks.value) {
  const q = searchQuery.value.trim().toLowerCase()
  const all = (v ?? []).map(t => ({ ...t }))
  for (const col of STATUS_CONFIG) {
    const filtered = all.filter(
      t => t.status === col.id
        && (filterPriorities.value.length === 0 || filterPriorities.value.some(p => p.value === t.priority))
        && (filterAssignees.value.length === 0 || filterAssignees.value.some(a => (t as any).assignees?.includes(a.value)))
        && (!q || t.title.toLowerCase().includes(q)),
    )
    if (col.id === 'done') {
      filtered.sort((a, b) => ((b.updatedAt ?? '') as string).localeCompare((a.updatedAt ?? '') as string))
    }
    columns[col.id] = filtered
  }
}

watch(tasks, syncColumns, { immediate: true })
watch(filterPriorities, () => syncColumns(tasks.value), { deep: true })
watch(filterAssignees, () => syncColumns(tasks.value), { deep: true })
watch(searchQuery, () => syncColumns(tasks.value))

// Mark done
const { markingDone, markDone: _markDone } = useMarkDone()

async function markTaskDone(tSlug: string) {
  await _markDone(slug.value, `/projects/${slug.value}/tasks/${tSlug}`, refreshTasks)
}

async function reopenTask(tSlug: string) {
  updating.value = `/projects/${slug.value}/tasks/${tSlug}`
  try {
    await $fetch(`/api/tasks/${slug.value}/${tSlug}`, { method: 'PATCH', body: { status: 'todo' } })
    await refreshTasks()
  }
  finally {
    updating.value = null
  }
}

const totalVisible = computed(() => {
  let n = 0
  for (const c of visibleColumns.value) n += columns[c.id].length
  return n
})

const tasksBySlug = computed(() => {
  const map: Record<string, Task> = {}
  for (const col of STATUS_CONFIG) {
    for (const t of columns[col.id]) map[slugFromPath(t.path)] = t
  }
  return map
})

function hasBlockingDeps(task: Task) {
  return (task as any).dependencies?.some(
    (dep: string) => tasksBySlug.value[dep]?.status !== 'done',
  ) ?? false
}

const updating = ref<string | null>(null)

async function persistOrder() {
  const order: Record<string, string[]> = {}
  for (const col of STATUS_CONFIG) {
    order[col.id] = columns[col.id].map(t => slugFromPath(t.path))
  }
  await $fetch('/api/tasks/reorder', {
    method: 'POST',
    body: { project: slug.value, order },
  })
}

async function onColumnAdd(colId: ColId, evt: { newIndex?: number }) {
  const task = columns[colId][evt.newIndex ?? 0]
  if (!task) return
  const tSlug = slugFromPath(task.path)
  task.status = colId
  updating.value = task.path
  try {
    await $fetch(`/api/tasks/${slug.value}/${tSlug}`, {
      method: 'PATCH',
      body: { status: colId },
    })
    await persistOrder()
    await refreshTasks()
  }
  catch {
    await refreshTasks()
  }
  finally {
    updating.value = null
  }
}

async function onColumnUpdate() {
  try {
    await persistOrder()
    await refreshTasks()
  }
  catch {
    await refreshTasks()
  }
}

const showCreateTask = ref(false)
const createTaskStatus = ref<ColId>('todo')
const showEditProject = ref(false)
const editTask = ref<Task | null>(null)

const taskView = ref<'kanban' | 'list'>('kanban')
const mounted = ref(false)
const isDragging = ref(false)

function taskViewKey(s: string) { return `mdpm:task-view:${s}` }

onMounted(() => {
  const stored = localStorage.getItem(taskViewKey(slug.value))
  if (stored === 'kanban' || stored === 'list') taskView.value = stored
  mounted.value = true
})

watch(slug, (s) => {
  const stored = localStorage.getItem(taskViewKey(s))
  taskView.value = (stored === 'kanban' || stored === 'list') ? stored : 'kanban'
})

watch(taskView, v => localStorage.setItem(taskViewKey(slug.value), v))

const openListStatuses = ref<string[]>([])
watch(visibleColumns, (cols) => {
  for (const col of cols)
    if (!openListStatuses.value.includes(col.id)) openListStatuses.value.push(col.id)
}, { immediate: true })
function toggleListStatus(id: string) {
  const idx = openListStatuses.value.indexOf(id)
  if (idx >= 0) openListStatuses.value.splice(idx, 1)
  else openListStatuses.value.push(id)
}
function openCreateTask(status?: ColId) {
  createTaskStatus.value = status ?? (project.value?.defaultStatus as ColId | undefined) ?? 'todo'
  showCreateTask.value = true
}

const taskToDelete = ref<string | null>(null)
const deleting = ref(false)
const toast = useToast()

function confirmDeleteTask(tSlug: string) {
  taskToDelete.value = tSlug
}

async function deleteTask() {
  if (!taskToDelete.value) return
  deleting.value = true
  try {
    await $fetch(`/api/tasks/${slug.value}/${taskToDelete.value}`, { method: 'DELETE' })
    await refreshTasks()
    taskToDelete.value = null
  }
  catch {
    toast.add({ title: 'Failed to delete task', color: 'error' })
  }
  finally {
    deleting.value = false
  }
}


useHead(() => ({ title: project.value?.title ?? slug.value }))

const projectsMeta = resolveRouteMeta('/projects')
const breadcrumb = computed(() => [
  { label: projectsMeta.label ?? 'Projects', to: '/projects', icon: projectsMeta.icon },
  { label: project.value?.title ?? slug.value, icon: (project.value as any)?.icon || undefined },
])

const tabs = computed(() => [
  { label: 'Tasks', icon: 'i-lucide-list-checks', to: `/projects/${slug.value}`, exact: true },
  { label: 'Docs', icon: 'i-lucide-book-open', to: `/projects/${slug.value}/docs` },
])

const mobileActions = computed(() => [
  taskView.value !== 'kanban'
    ? { label: 'Kanban view', icon: 'i-lucide-kanban', onSelect: () => { taskView.value = 'kanban' } }
    : { label: 'List view', icon: 'i-lucide-list', onSelect: () => { taskView.value = 'list' } },
  { label: 'New Task', icon: 'i-lucide-plus', onSelect: () => openCreateTask() },
  { label: 'Edit Project', icon: 'i-lucide-pencil', onSelect: () => { showEditProject.value = true } },
])
</script>

<template>
  <AppPageBase :breadcrumb="breadcrumb" :tabs="tabs" :mobile-actions="mobileActions" full-height>
    <template #actions>
      <USkeleton v-if="!mounted" class="h-8 w-[5.5rem] rounded-md shrink-0" />
      <div v-else class="flex rounded-md border border-default overflow-hidden shrink-0">
        <UButton
          icon="i-lucide-kanban"
          color="neutral"
          :variant="taskView === 'kanban' ? 'soft' : 'ghost'"
          size="sm"
          :ui="{ base: 'rounded-none' }"
          title="Kanban"
          aria-label="Switch to kanban view"
          @click="taskView = 'kanban'"
        />
        <UButton
          icon="i-lucide-list"
          color="neutral"
          :variant="taskView === 'list' ? 'soft' : 'ghost'"
          size="sm"
          :ui="{ base: 'rounded-none' }"
          title="List"
          aria-label="Switch to list view"
          @click="taskView = 'list'"
        />
      </div>
      <UButton
        label="Edit Project"
        icon="i-lucide-pencil"
        color="neutral"
        variant="outline"
        size="sm"
        @click="showEditProject = true"
      />
      <UButton
        label="New Task"
        icon="i-lucide-plus"
        size="sm"
        @click="openCreateTask()"
      />
    </template>

    <div class="flex flex-col h-full space-y-3">
      <!-- Project meta + filters -->
      <div class="space-y-3 shrink-0">
        <div class="flex items-center gap-2 flex-wrap">
          <UBadge
            :label="project!.status"
            :color="PROJECT_STATUS_MAP[project!.status]?.color ?? 'neutral'"
            variant="subtle"
          />
          <UBadge
            v-for="tag in project!.tags"
            :key="tag"
            :label="tag"
            color="neutral"
            variant="outline"
            size="sm"
          />
        </div>

        <p
          v-if="project!.description"
          class="text-sm text-muted"
        >
          {{ project!.description }}
        </p>

        <div class="flex items-center gap-2 flex-wrap">
          <UInput
            v-model="searchQuery"
            placeholder="Search…"
            icon="i-lucide-search"
            size="sm"
            class="w-36"
          />
          <AppFilterMenu
            v-model="filterStatuses"
            :items="(statusFilterItems as SelectItem[])"
            placeholder="Status"
          />
          <AppFilterMenu
            v-model="filterPriorities"
            :items="(PRIORITY_SELECT_ITEMS as SelectItem[])"
            placeholder="Priority"
          />
          <AppFilterMenu
            v-if="allAssignees.length"
            v-model="filterAssignees"
            :items="assigneeFilterItems"
            placeholder="Assignees"
          />
          <span class="text-xs text-muted ml-auto">
            {{ totalVisible }} task{{ totalVisible !== 1 ? 's' : '' }}
          </span>
        </div>
      </div>

      <!-- Skeleton (pre-mount) -->
      <div v-if="!mounted" class="flex gap-3 overflow-x-auto flex-1 min-h-0">
        <div v-for="i in 4" :key="i" class="flex flex-col flex-none w-72 min-h-0">
          <div class="flex items-center gap-2 mb-2 px-1">
            <USkeleton class="size-4 rounded shrink-0" />
            <USkeleton class="h-4 w-20 rounded" />
            <USkeleton class="h-5 w-6 rounded-full" />
          </div>
          <div class="flex flex-col gap-2 rounded-xl p-2 bg-muted min-h-24">
            <USkeleton v-for="j in (i <= 2 ? 3 : 2)" :key="j" class="h-14 rounded-lg" />
          </div>
        </div>
      </div>

      <!-- Kanban board -->
      <div v-else-if="taskView === 'kanban'" class="flex gap-3 overflow-x-auto flex-1 min-h-0" :class="tasksPending ? 'opacity-50 pointer-events-none' : 'transition-opacity'">
        <div
          v-for="col in visibleColumns"
          :key="col.id"
          class="flex flex-col flex-none w-64 sm:w-72 min-h-0"
        >
          <!-- Column header -->
          <div class="flex items-center gap-2 mb-2 px-1">
            <UIcon
              :name="col.icon"
              class="size-4 shrink-0"
              :class="`text-${col.color}`"
            />
            <span class="text-sm font-medium">{{ col.label }}</span>
            <UBadge
              :label="String(columns[col.id].length)"
              color="neutral"
              variant="subtle"
              size="sm"
            />
            <UButton
              icon="i-lucide-plus"
              color="neutral"
              variant="ghost"
              size="sm"
              class="ml-auto"
              :tooltip="{ text: `Add ${col.label} task` }"
              @click="openCreateTask(col.id)"
            />
          </div>

          <!-- Draggable column -->
          <VueDraggable
            v-model="columns[col.id]"
            :group="{ name: 'tasks', pull: true, put: true }"
            :animation="150"
            class="flex flex-col gap-2 flex-1 rounded-xl p-2 bg-muted min-h-24 overflow-y-auto"
            ghost-class="opacity-40"
            filter=".drag-ignore"
            @start="isDragging = true"
            @end="isDragging = false"
            @add="(e) => onColumnAdd(col.id, e)"
            @update="onColumnUpdate"
          >
            <div
              v-if="!columns[col.id].length && !isDragging"
              class="drag-ignore flex items-center justify-center flex-1 py-4 text-xs text-muted italic"
            >
              No tasks
            </div>
            <TaskDisplayCard
              v-for="task in columns[col.id]"
              :key="task.path"
              :task="task"
              :has-blocking-deps="hasBlockingDeps(task)"
              :loading="updating === task.path || markingDone === task.path"
              @click="editTask = task"
              @mark-done="markTaskDone(slugFromPath(task.path))"
              @reopen="reopenTask(slugFromPath(task.path))"
              @delete="confirmDeleteTask(slugFromPath(task.path))"
            />
          </VueDraggable>
        </div>
      </div>

      <!-- List view -->
      <div
        v-else
        class="overflow-y-auto flex-1 min-h-0"
        :class="tasksPending ? 'opacity-50 pointer-events-none' : 'transition-opacity'"
      >
        <AppTaskStatusGroup
          v-for="col in visibleColumns"
          :key="col.id"
          v-model="columns[col.id]"
          :status-cfg="col"
          group="tasks"
          :is-open="openListStatuses.includes(col.id)"
          :is-dragging="isDragging"
          :loading-path="markingDone"
          show-add-button
          @toggle="toggleListStatus(col.id)"
          @drag-start="isDragging = true"
          @drag-end="isDragging = false"
          @drag-add="(e) => onColumnAdd(col.id, e)"
          @drag-update="onColumnUpdate"
          @add-task="openCreateTask(col.id)"
          @task-click="editTask = ($event as unknown as Task)"
          @mark-done="markTaskDone(slugFromPath($event.path))"
          @reopen="reopenTask(slugFromPath($event.path))"
          @delete="confirmDeleteTask(slugFromPath($event.path))"
        />
        <div
          v-if="!totalVisible"
          class="flex items-center justify-center py-12 text-sm text-muted"
        >
          No tasks match the current filters.
        </div>
      </div>

    </div>

    <template #overlays>
      <TaskForm
        v-if="editTask"
        :project-slug="slug"
        :task="editTask"
        :available-statuses="project?.availableStatuses"
        @close="() => { editTask = null; refreshTasks() }"
      />
      <TaskForm
        v-else-if="showCreateTask"
        :project-slug="slug"
        :initial-status="createTaskStatus"
        :available-statuses="project?.availableStatuses"
        :default-priority="project?.defaultPriority"
        :default-assignee="project?.defaultAssignee"
        @close="showCreateTask = false"
        @saved="() => { showCreateTask = false; refreshTasks() }"
      />
      <ProjectForm
        v-if="showEditProject"
        :project="project!"
        @close="() => { showEditProject = false; refreshProject() }"
      />
      <AppConfirmDialog
        :open="!!taskToDelete"
        title="Delete task?"
        message="This cannot be undone."
        confirm-label="Delete"
        :loading="deleting"
        @update:open="taskToDelete = null"
        @confirm="deleteTask"
        @cancel="taskToDelete = null"
      />
    </template>
  </AppPageBase>
</template>
