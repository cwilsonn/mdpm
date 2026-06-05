<script setup lang="ts">
interface Task {
  path: string
  title: string
  status: string
  priority: string
  tags?: string[]
  assignees?: string[]
  due?: string
  dependencies?: string[]
  [key: string]: unknown
}

interface Project {
  path: string
  title: string
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
const filterStatuses = ref<SelectItem[]>(props.presetStatuses ?? [])

watch(() => props.presetStatuses, (val) => {
  filterStatuses.value = val ?? []
})
const filterPriorities = ref<SelectItem[]>([])
const filterProjects = ref<SelectItem[]>([])
const filterAssignees = ref<SelectItem[]>([])

const projectSelectItems = computed(() =>
  props.projects.map(p => ({
    label: p.title,
    value: p.path.split('/').at(-1)!,
  })),
)

const allAssignees = computed(() => {
  const set = new Set<string>()
  for (const t of props.tasks) {
    for (const a of t.assignees ?? []) set.add(a)
  }
  return [...set].sort()
})

const assigneeFilterItems = computed<SelectItem[]>(() =>
  allAssignees.value.map(name => ({ label: name, value: name, avatar: { alt: name } })),
)

// Sort
const SORT_ITEMS = [
  { label: 'Priority', value: 'priority' },
  { label: 'Due Date', value: 'due' },
  { label: 'Title', value: 'title' },
  { label: 'Created', value: 'createdAt' },
]
const sortBy = ref('priority')
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

function sortedTasks(list: Task[]): Task[] {
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
  return path.split('/')[2]
}

function projectNameOf(slug: string) {
  return props.projects.find(p => p.path.split('/').at(-1) === slug)?.title ?? slug
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

// Grouping: projectSlug → statusId → tasks[]
const grouped = computed(() => {
  const result: Record<string, Record<string, Task[]>> = {}
  for (const task of filtered.value) {
    const pSlug = projectSlugOf(task.path)
    if (!result[pSlug]) result[pSlug] = {}
    if (!result[pSlug][task.status]) result[pSlug][task.status] = []
    result[pSlug][task.status].push(task)
  }
  return result
})

const projectSlugs = computed(() => Object.keys(grouped.value).sort())

function statusesForProject(pSlug: string) {
  return STATUS_CONFIG.filter(s => grouped.value[pSlug]?.[s.id]?.length)
}

function projectTaskCount(pSlug: string) {
  return Object.values(grouped.value[pSlug] ?? {}).reduce((s, t) => s + t.length, 0)
}

// Collapsible state — open by default
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

// Mark done
const markingDone = ref<string | null>(null)

async function markDone(task: Task) {
  if (task.status === 'done') return
  const pSlug = projectSlugOf(task.path)
  const tSlug = task.path.split('/').at(-1)!
  markingDone.value = task.path
  try {
    await $fetch(`/api/tasks/${pSlug}/${tSlug}`, {
      method: 'PATCH',
      body: { status: 'done' },
    })
    emit('refresh')
  }
  catch {}
  finally {
    markingDone.value = null
  }
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
  <div class="flex flex-wrap items-center gap-2 mb-4">
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
  <div
    v-if="!projectSlugs.length"
    class="flex justify-center py-12"
  >
    <UEmpty
      icon="i-lucide-check-circle-2"
      title="No tasks"
      :description="hasActiveFilter ? 'No tasks match the current filters.' : 'No tasks yet.'"
    />
  </div>

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
        class="flex items-center gap-2 w-full px-4 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
        @click="toggleProject(pSlug)"
      >
        <UIcon
          name="i-lucide-chevron-right"
          class="size-3.5 shrink-0 transition-transform duration-150"
          :class="openProjects.includes(pSlug) ? 'rotate-90' : ''"
        />
        <span class="font-medium text-sm flex-1 truncate">{{ projectNameOf(pSlug) }}</span>
        <UBadge
          :label="String(projectTaskCount(pSlug))"
          color="neutral"
          variant="subtle"
          size="xs"
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
        <div
          v-for="statusCfg in statusesForProject(pSlug)"
          :key="statusCfg.id"
        >
          <div class="flex items-center gap-1.5 px-4 py-1.5 bg-muted/20">
            <UIcon
              :name="statusCfg.icon"
              :class="`text-${statusCfg.color}`"
              class="size-3.5 shrink-0"
            />
            <span class="text-xs font-medium text-muted">{{ statusCfg.label }}</span>
            <span class="text-xs text-muted">({{ grouped[pSlug][statusCfg.id].length }})</span>
          </div>
          <div class="divide-y divide-default/50">
            <TaskDisplayLine
              v-for="task in sortedTasks(grouped[pSlug][statusCfg.id])"
              :key="task.path"
              :task="task"
              :loading="markingDone === task.path"
              @click="editingTask = task"
              @mark-done="markDone(task)"
            />
          </div>
        </div>
      </div>
    </UCard>
  </div>

  <!-- Edit modal -->
  <TaskForm
    v-if="editingTask"
    :project-slug="projectSlugOf(editingTask.path)"
    :task="(editingTask as any)"
    @close="closeEdit"
  />
</template>
