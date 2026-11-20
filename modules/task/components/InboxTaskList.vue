<script setup lang="ts">
const props = defineProps<{
  tasks: Task[]
  projects: Project[]
  presetStatuses?: FilterItem[]
}>()

const emit = defineEmits<{ refresh: [] }>()

// Filters — empty array = no filter (show all)
const search = ref('')
const filterStatuses = ref<FilterItem[]>(
  props.presetStatuses ?? (STATUS_SELECT_ITEMS as FilterItem[]).filter(s => s.value !== 'done'),
)

watch(() => props.presetStatuses, (val) => {
  filterStatuses.value = val ?? []
})
const filterPriorities = ref<FilterItem[]>([])
const filterProjects = ref<FilterItem[]>([])

const projectFilterItems = computed(() =>
  props.projects.map(p => ({
    label: p.title,
    value: slugFromPath(p.path),
  })),
)

// Sort
const SORT_ITEMS = [
  { label: 'Manual', value: 'manual' },
  { label: 'Priority', value: 'priority' },
  { label: 'Due Date', value: 'due' },
  { label: 'Title', value: 'title' },
  { label: 'Created', value: 'createdAt' },
]
const sortBy = ref('priority')
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

function sortedTasks(list: Task[], statusId?: string): Task[] {
  if (sortBy.value === 'manual') {
    return [...list].sort((a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0))
  }
  if (statusId === 'done') {
    return [...list].sort((a, b) =>
      ((b.updatedAt as string) ?? '').localeCompare((a.updatedAt as string) ?? ''),
    )
  }
  return [...list].sort((a, b) => {
    if (sortBy.value === 'priority') {
      return (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
    }
    if (sortBy.value === 'due') {
      if (!a.due && !b.due) return 0
      if (!a.due) return 1
      if (!b.due) return -1
      return (a.due as string).localeCompare(b.due as string)
    }
    if (sortBy.value === 'title') return a.title.localeCompare(b.title)
    if (sortBy.value === 'createdAt') {
      return ((a.createdAt as string) ?? '').localeCompare((b.createdAt as string) ?? '')
    }
    return 0
  })
}

function projectNameOf(slug: string) {
  return props.projects.find(p => slugFromPath(p.path) === slug)?.title ?? slug
}

function projectIconOf(slug: string) {
  return props.projects.find(p => slugFromPath(p.path) === slug)?.icon ?? 'i-lucide-folder-open'
}

// Filtering — empty array = no constraint
const filtered = computed(() => {
  let t = props.tasks
  const q = search.value.trim().toLowerCase()
  if (q) t = t.filter(task => task.title.toLowerCase().includes(q))
  if (filterProjects.value.length) t = t.filter(task => filterProjects.value.some(p => p.value === projectSlugFromPath(task.path)))
  if (filterStatuses.value.length) t = t.filter(task => filterStatuses.value.some(s => s.value === task.status))
  if (filterPriorities.value.length) t = t.filter(task => filterPriorities.value.some(p => p.value === task.priority))
  return t
})

// Mutable drag state — rebuilt when filter/sort changes
type TaskGroups = Record<string, Record<string, Task[]>>
const draggableGroups = ref<TaskGroups>({})

function buildGroups(tasks: Task[]): TaskGroups {
  const result: TaskGroups = {}
  for (const task of tasks) {
    const pSlug = projectSlugFromPath(task.path)
    if (!result[pSlug]) result[pSlug] = {}
    const sId = task.status ?? 'todo'
    if (!result[pSlug][sId]) result[pSlug][sId] = []
    result[pSlug][sId]!.push(task)
  }
  for (const pSlug of Object.keys(result)) {
    for (const sId of Object.keys(result[pSlug]!)) {
      result[pSlug]![sId] = sortedTasks(result[pSlug]![sId]!, sId)
    }
  }
  return result
}

watch([filtered, sortBy], ([tasks]) => {
  draggableGroups.value = buildGroups(tasks)
}, { immediate: true })

const projectSlugs = computed(() => Object.keys(draggableGroups.value).sort())

function statusesForProject(pSlug: string) {
  return STATUS_CONFIG.filter(s => draggableGroups.value[pSlug]?.[s.id]?.length)
}

function projectTaskCount(pSlug: string) {
  return Object.values(draggableGroups.value[pSlug] ?? {}).reduce((s, t) => s + t.length, 0)
}

// Collapsible projects — open by default
const openProjects = useToggleSet()

watch(projectSlugs, (slugs) => {
  for (const s of slugs) openProjects.add(s)
}, { immediate: true })

// Collapsible status subgroups — open by default, keyed as `pSlug:statusId`
const openStatuses = useToggleSet()

function statusKey(pSlug: string, statusId: string) {
  return `${pSlug}:${statusId}`
}

watch(draggableGroups, (g) => {
  for (const pSlug of Object.keys(g)) {
    for (const statusId of Object.keys(g[pSlug] ?? {})) openStatuses.add(statusKey(pSlug, statusId))
  }
}, { immediate: true })

// Drag handlers
const isDragging = ref(false)
const { persistOrder: persistReorder } = useReorder()
const { updateTask } = useTasks()
const { tryWithToast } = useApiToast()

function persistProjectOrder(pSlug: string) {
  return persistReorder(pSlug, draggableGroups.value[pSlug] ?? {})
}

async function onGroupAdd(pSlug: string, targetStatusId: string, evt: { newIndex?: number }) {
  const task = draggableGroups.value[pSlug]?.[targetStatusId]?.[evt.newIndex ?? 0]
  if (!task) return
  const tSlug = slugFromPath(task.path)
  await tryWithToast(async () => {
    await updateTask(pSlug, tSlug, { status: targetStatusId })
    if (sortBy.value === 'manual') await persistProjectOrder(pSlug)
  }, 'Failed to move task')
  emit('refresh')
}

async function onGroupUpdate(pSlug: string) {
  if (sortBy.value !== 'manual') return
  await tryWithToast(() => persistProjectOrder(pSlug), 'Failed to save order')
}

// Mark done
const { markingDone, markDone: _markDone } = useMarkDone()

async function markDone(task: Task) {
  if (task.status === 'done') return
  await _markDone(projectSlugFromPath(task.path), task.path, () => emit('refresh'))
}

// Edit modal
const editingTask = ref<Task | null>(null)

function closeEdit() {
  editingTask.value = null
  emit('refresh')
}

const hasActiveFilter = computed(() =>
  !!search.value || filterProjects.value.length > 0 || filterStatuses.value.length > 0
    || filterPriorities.value.length > 0,
)

function clearFilters() {
  search.value = ''
  filterProjects.value = []
  filterStatuses.value = []
  filterPriorities.value = []
}
</script>

<template>
  <!-- Filter + sort bar -->
  <div class="flex flex-wrap items-center gap-2">
    <UInput
      v-model="search"
      placeholder="Search tasks…"
      aria-label="Search tasks"
      icon="i-lucide-search"
      size="sm"
      class="w-44"
    />
    <AppFilterMenu
      v-model="filterProjects"
      :items="projectFilterItems"
      placeholder="Projects"
    />
    <AppFilterMenu
      v-model="filterStatuses"
      :items="(STATUS_SELECT_ITEMS as FilterItem[])"
      placeholder="Status"
    />
    <AppFilterMenu
      v-model="filterPriorities"
      :items="(PRIORITY_SELECT_ITEMS as FilterItem[])"
      placeholder="Priority"
    />
    <USelect
      v-model="sortBy"
      :items="SORT_ITEMS"
      value-key="value"
      size="sm"
      aria-label="Sort by"
      class="w-36"
    />
    <UButton
      v-if="hasActiveFilter"
      icon="i-lucide-x"
      label="Clear"
      color="neutral"
      variant="ghost"
      size="sm"
      @click="clearFilters"
    />
    <span class="text-xs text-muted ml-auto">
      {{ filtered.length }} task{{ filtered.length !== 1 ? 's' : '' }}
    </span>
  </div>

  <!-- Empty state -->
  <UEmpty
    v-if="!projectSlugs.length"
    icon="i-lucide-check-circle-2"
    title="No tasks"
    :description="hasActiveFilter ? 'No tasks match the current filters.' : 'No tasks yet.'"
  />

  <!-- Grouped list -->
  <div
    v-else
    class="space-y-3"
  >
    <UCard
      v-for="pSlug in projectSlugs"
      :key="pSlug"
      :ui="{ root: 'overflow-hidden', body: 'p-0!' }"
    >
      <!-- Project header: the disclosure button and the project link are siblings (no link inside a button) -->
      <div class="flex items-center gap-2 w-full pe-4 hover:bg-muted transition-colors border-b border-default">
        <button
          type="button"
          class="flex flex-1 min-w-0 items-center gap-2 ps-4 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          :aria-expanded="openProjects.has(pSlug)"
          @click="openProjects.toggle(pSlug)"
        >
          <UIcon
            name="i-lucide-chevron-right"
            class="size-3.5 shrink-0 transition-transform duration-150"
            :class="openProjects.has(pSlug) ? 'rotate-90' : ''"
          />
          <UIcon :name="projectIconOf(pSlug)" class="size-4 shrink-0 text-primary" />
          <span class="font-medium text-sm flex-1 truncate">{{ projectNameOf(pSlug) }}</span>
          <UBadge
            :label="String(projectTaskCount(pSlug))"
            color="neutral"
            variant="subtle"
            size="sm"
            class="shrink-0"
          />
        </button>
        <NuxtLink
          :to="`/projects/${pSlug}`"
          class="inline-flex items-center min-h-6 px-1 rounded-sm text-xs text-muted hover:text-primary shrink-0 focus-visible:outline-2 focus-visible:outline-primary"
        >
          Open<span class="sr-only"> {{ projectNameOf(pSlug) }}</span>&nbsp;<span aria-hidden="true">→</span>
        </NuxtLink>
      </div>

      <!-- Status subgroups -->
      <div
        v-if="openProjects.has(pSlug)"
        class="divide-y divide-default"
      >
        <TaskStatusGroup
          v-for="statusCfg in statusesForProject(pSlug)"
          :key="statusCfg.id"
          v-model="draggableGroups[pSlug]![statusCfg.id]!"
          :status-cfg="statusCfg"
          :group="`tasks-${pSlug}`"
          :is-open="openStatuses.has(statusKey(pSlug, statusCfg.id))"
          :is-dragging="isDragging"
          :sort="sortBy === 'manual'"
          :loading-path="markingDone"
          muted
          @toggle="openStatuses.toggle(statusKey(pSlug, statusCfg.id))"
          @drag-start="isDragging = true"
          @drag-end="isDragging = false"
          @drag-add="(e) => onGroupAdd(pSlug, statusCfg.id, e)"
          @drag-update="onGroupUpdate(pSlug)"
          @task-click="editingTask = $event"
          @mark-done="markDone($event)"
        />
      </div>
    </UCard>
  </div>

  <!-- Edit modal -->
  <TaskForm
    v-if="editingTask"
    :project-slug="projectSlugFromPath(editingTask.path)"
    :task="editingTask"
    @close="closeEdit"
  />
</template>
