<script setup lang="ts">
interface Project {
  path: string
  title: string
  icon?: string
}

const props = defineProps<{
  tasks: Task[]
  projects: Project[]
  presetStatuses?: SelectItem[]
}>()

const emit = defineEmits<{ refresh: [] }>()

interface SelectItem { label: string; value: string; icon?: string; color?: string; avatar?: { alt: string } }

// Filters — empty array = no filter (show all)
const search = ref('')
const filterStatuses = ref<SelectItem[]>(
  props.presetStatuses ?? (STATUS_SELECT_ITEMS as SelectItem[]).filter(s => s.value !== 'done'),
)

watch(() => props.presetStatuses, (val) => {
  filterStatuses.value = val ?? []
})
const filterPriorities = ref<SelectItem[]>([])
const filterProjects = ref<SelectItem[]>([])
const filterAssignees = ref<SelectItem[]>([])

const projectSelectItems = computed(() =>
  props.projects.map(p => ({
    label: p.title,
    value: slugFromPath(p.path),
  })),
)

const allAssignees = computed(() => getAssigneeNames(props.tasks))

const assigneeFilterItems = computed<SelectItem[]>(() =>
  allAssignees.value.map(name => ({ label: name, value: name, avatar: { alt: name } })),
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

function projectSlugOf(path: string) {
  return path.split('/')[2] ?? ''
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
  if (filterProjects.value.length) t = t.filter(task => filterProjects.value.some(p => p.value === projectSlugOf(task.path)))
  if (filterStatuses.value.length) t = t.filter(task => filterStatuses.value.some(s => s.value === task.status))
  if (filterPriorities.value.length) t = t.filter(task => filterPriorities.value.some(p => p.value === task.priority))
  if (filterAssignees.value.length) t = t.filter(task => filterAssignees.value.some(a => task.assignees?.includes(a.value)))
  return t
})

// Mutable drag state — rebuilt when filter/sort changes
type TaskGroups = Record<string, Record<string, Task[]>>
const draggableGroups = ref<TaskGroups>({})

function buildGroups(tasks: Task[]): TaskGroups {
  const result: TaskGroups = {}
  for (const task of tasks) {
    const pSlug = projectSlugOf(task.path)
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
const openProjects = ref<string[]>([])

watch(projectSlugs, (slugs) => {
  for (const s of slugs) {
    if (!openProjects.value.includes(s)) openProjects.value.push(s)
  }
}, { immediate: true })

function toggleProject(pSlug: string) {
  const idx = openProjects.value.indexOf(pSlug)
  if (idx >= 0) openProjects.value.splice(idx, 1)
  else openProjects.value.push(pSlug)
}

// Collapsible status subgroups — open by default, keyed as `pSlug:statusId`
const openStatuses = ref<string[]>([])

watch(draggableGroups, (g) => {
  for (const pSlug of Object.keys(g)) {
    for (const statusId of Object.keys(g[pSlug] ?? {})) {
      const key = `${pSlug}:${statusId}`
      if (!openStatuses.value.includes(key)) openStatuses.value.push(key)
    }
  }
}, { immediate: true })

function statusKey(pSlug: string, statusId: string) {
  return `${pSlug}:${statusId}`
}

function toggleStatus(pSlug: string, statusId: string) {
  const key = statusKey(pSlug, statusId)
  const idx = openStatuses.value.indexOf(key)
  if (idx >= 0) openStatuses.value.splice(idx, 1)
  else openStatuses.value.push(key)
}

// Drag handlers
const toast = useToast()
const isDragging = ref(false)
const { persistOrder: persistReorder } = useReorder()
const { updateTask } = useTasks()

function persistProjectOrder(pSlug: string) {
  return persistReorder(pSlug, draggableGroups.value[pSlug] ?? {})
}

async function onGroupAdd(pSlug: string, targetStatusId: string, evt: { newIndex?: number }) {
  const task = draggableGroups.value[pSlug]?.[targetStatusId]?.[evt.newIndex ?? 0]
  if (!task) return
  const tSlug = slugFromPath(task.path)
  try {
    await updateTask(pSlug, tSlug, { status: targetStatusId })
    if (sortBy.value === 'manual') await persistProjectOrder(pSlug)
    emit('refresh')
  }
  catch {
    toast.add({ title: 'Failed to move task', color: 'error' })
    emit('refresh')
  }
}

async function onGroupUpdate(pSlug: string) {
  if (sortBy.value !== 'manual') return
  try {
    await persistProjectOrder(pSlug)
  }
  catch {
    toast.add({ title: 'Failed to save order', color: 'error' })
  }
}

// Mark done
const { markingDone, markDone: _markDone } = useMarkDone()

async function markDone(task: Task) {
  if (task.status === 'done') return
  await _markDone(projectSlugOf(task.path), task.path, () => emit('refresh'))
}

// Edit modal
const editingTask = ref<Task | null>(null)

function closeEdit() {
  editingTask.value = null
  emit('refresh')
}

const hasActiveFilter = computed(() =>
  !!search.value || filterProjects.value.length > 0 || filterStatuses.value.length > 0
    || filterPriorities.value.length > 0 || filterAssignees.value.length > 0,
)

function clearFilters() {
  search.value = ''
  filterProjects.value = []
  filterStatuses.value = []
  filterPriorities.value = []
  filterAssignees.value = []
}
</script>

<template>
  <!-- Filter + sort bar -->
  <div class="flex flex-wrap items-center gap-2">
    <UInput
      v-model="search"
      placeholder="Search tasks…"
      icon="i-lucide-search"
      size="sm"
      class="w-44"
    />
    <AppFilterMenu
      v-model="filterProjects"
      :items="projectSelectItems"
      placeholder="Projects"
    />
    <AppFilterMenu
      v-model="filterStatuses"
      :items="(STATUS_SELECT_ITEMS as SelectItem[])"
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
    <USelect
      v-model="sortBy"
      :items="SORT_ITEMS"
      value-key="value"
      size="sm"
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
      <!-- Project header -->
      <button
        class="flex items-center gap-2 w-full px-4 py-2.5 hover:bg-muted transition-colors text-left border-b border-default"
        @click="toggleProject(pSlug)"
      >
        <UIcon
          name="i-lucide-chevron-right"
          class="size-3.5 shrink-0 transition-transform duration-150"
          :class="openProjects.includes(pSlug) ? 'rotate-90' : ''"
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
        <NuxtLink
          :to="`/projects/${pSlug}`"
          class="text-xs text-muted hover:text-primary shrink-0"
          @click.stop
        >
          Open →
        </NuxtLink>
      </button>

      <!-- Status subgroups -->
      <div
        v-if="openProjects.includes(pSlug)"
        class="divide-y divide-default"
      >
        <TaskStatusGroup
          v-for="statusCfg in statusesForProject(pSlug)"
          :key="statusCfg.id"
          v-model="draggableGroups[pSlug]![statusCfg.id]!"
          :status-cfg="statusCfg"
          :group="`tasks-${pSlug}`"
          :is-open="openStatuses.includes(statusKey(pSlug, statusCfg.id))"
          :is-dragging="isDragging"
          :sort="sortBy === 'manual'"
          :loading-path="markingDone"
          muted
          @toggle="toggleStatus(pSlug, statusCfg.id)"
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
    :project-slug="projectSlugOf(editingTask.path)"
    :task="editingTask"
    @close="closeEdit"
  />
</template>
