<script setup lang="ts">
const props = defineProps<{
  projectSlug: string
  initialStatus?: 'todo' | 'in-progress' | 'in-review' | 'done' | 'blocked' | 'on-hold'
  availableStatuses?: string[]
  defaultPriority?: string
  defaultAssignee?: string
  task?: Task
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const { createTask, updateTask, archiveTask, unarchiveTask } = useTasks()
const { listAuthors, createAuthor } = useAuthors()
const { tryWithToast } = useApiToast()

const isEdit = computed(() => !!props.task)

const taskPageUrl = computed(() => {
  if (!props.task) return null
  return `/projects/${props.projectSlug}/tasks/${slugFromPath(props.task.path)}`
})

const currentTaskSlug = computed(() => props.task ? slugFromPath(props.task.path) : null)

const form = reactive({
  title: props.task?.title ?? '',
  status: (props.task?.status ?? props.initialStatus ?? 'todo') as 'todo' | 'in-progress' | 'in-review' | 'done' | 'blocked' | 'on-hold',
  priority: (props.task?.priority ?? props.defaultPriority ?? 'medium') as 'low' | 'medium' | 'high' | 'urgent',
  tags: [...(props.task?.tags ?? [])] as string[],
  assignees: props.task ? [...(props.task.assignees ?? [])] : (props.defaultAssignee ? [props.defaultAssignee] : []) as string[],
  due: props.task?.due ?? '',
  dependencies: [...(props.task?.dependencies ?? [])] as string[],
})

const statusMeta = computed(() => STATUS_MAP[form.status])
const priorityMeta = computed(() => PRIORITY_MAP[form.priority])

const statusSelectItems = computed(() => {
  const available = props.availableStatuses ?? STATUS_CONFIG.map(s => s.id)
  return STATUS_SELECT_ITEMS.filter(s =>
    available.includes(s.value) || (props.task && s.value === props.task.status),
  )
})

type ProjectTask = { slug: string, title: string, status: string }
const projectTasks = ref<ProjectTask[]>([])
const dependencyItems = computed(() =>
  projectTasks.value
    .filter(t => t.slug !== currentTaskSlug.value)
    .map(t => ({ label: t.title, value: t.slug })),
)

const isArchived = computed(() => !!props.task?.archivedAt)
const archiving = ref(false)

async function toggleArchive() {
  if (!props.task) return
  archiving.value = true
  const tSlug = slugFromPath(props.task.path)
  const wasArchived = isArchived.value
  try {
    const ok = await tryWithToast(
      () => wasArchived ? unarchiveTask(props.projectSlug, tSlug) : archiveTask(props.projectSlug, tSlug),
      `Failed to ${wasArchived ? 'unarchive' : 'archive'} task`,
    )
    if (ok) { emit('saved'); emit('close') }
  }
  finally {
    archiving.value = false
  }
}

const description = ref('')
const descriptionLoading = ref(false)
const authorNames = ref<string[]>([])

// The updatedAt the form's content is based on, from the load and then from each save's answer. Sent with every
// save so the server refuses (409) instead of overwriting a note or edit that landed while the form was open.
// undefined until the task has been loaded: autosave doesn't start without it.
const baseUpdatedAt = ref<string | null | undefined>(undefined)

const { saving, savedAt, saveError, savedAgo, conflict, scheduleSave, flushSave, resolveConflict, initAutoSave, cleanupAutoSave } = useAutoSave(
  isEdit,
  async () => {
    const res = await updateTask(props.projectSlug, slugFromPath(props.task!.path), {
      title: form.title,
      status: form.status,
      priority: form.priority,
      tags: form.tags,
      assignees: form.assignees,
      due: form.due || undefined,
      dependencies: form.dependencies,
      description: description.value,
      expectedUpdatedAt: baseUpdatedAt.value,
    })
    if (res.updatedAt) baseUpdatedAt.value = res.updatedAt
  },
)

type RawTask = Omit<Task, 'updatedAt'> & { body: string, updatedAt: string | null }

// Load (or reload) the task: form fields, body, and the base for the conflict check.
async function loadTask() {
  const raw = await $fetch<RawTask>(`/api/tasks/${props.projectSlug}/${slugFromPath(props.task!.path)}`)
  Object.assign(form, {
    title: raw.title,
    status: raw.status,
    priority: raw.priority,
    tags: [...(raw.tags ?? [])],
    assignees: [...(raw.assignees ?? [])],
    due: raw.due ?? '',
    dependencies: [...(raw.dependencies ?? [])],
  })
  description.value = raw.body ?? ''
  baseUpdatedAt.value = raw.updatedAt ?? null
}

const reloading = ref(false)

async function reloadAfterConflict() {
  reloading.value = true
  try {
    await loadTask()
    // Let the field watchers run (and no-op, autosave is still stopped) before saving again.
    await nextTick()
    resolveConflict()
  }
  catch {
    saveError.value = 'Reload failed; try again'
  }
  finally {
    reloading.value = false
  }
}

onMounted(async () => {
  listAuthors().then((data) => {
    authorNames.value = data.map(a => a.name)
  })

  $fetch<ProjectTask[]>(`/api/tasks/${props.projectSlug}`).then((data) => {
    projectTasks.value = data
  })

  if (isEdit.value && props.task) {
    descriptionLoading.value = true
    try {
      await loadTask()
      await nextTick()
    }
    catch {
      // Without a base, a save could overwrite newer content: stay read-only rather than autosave blind.
      saveError.value = 'Could not load the task; changes here will not be saved'
      return
    }
    finally {
      descriptionLoading.value = false
    }
  }

  initAutoSave()
})

onBeforeUnmount(() => cleanupAutoSave())


watch(() => form.title, () => scheduleSave())
watch(() => form.status, () => flushSave())
watch(() => form.priority, () => flushSave())
watch(() => form.due, () => flushSave())
watch(() => form.tags, () => flushSave(), { deep: true })
watch(() => form.assignees, () => flushSave(), { deep: true })
watch(() => form.dependencies, () => flushSave(), { deep: true })
watch(description, () => scheduleSave())

// create mode
const creating = ref(false)
const createError = ref<string | null>(null)

async function handleCreateAuthor(name: string) {
  if (!await tryWithToast(() => createAuthor(name), 'Failed to add assignee')) return
  if (!authorNames.value.includes(name)) authorNames.value.push(name)
  if (!form.assignees.includes(name)) form.assignees.push(name)
}

async function create() {
  creating.value = true
  createError.value = null
  try {
    await createTask({
      project: props.projectSlug,
      title: form.title,
      status: form.status,
      priority: form.priority,
      tags: form.tags,
      assignees: form.assignees,
      due: form.due || undefined,
      dependencies: form.dependencies,
      description: description.value,
    })
    emit('saved')
  }
  catch (e: unknown) {
    createError.value = (e as { data?: { message?: string } })?.data?.message ?? 'An error occurred'
  }
  finally {
    creating.value = false
  }
}
</script>

<template>
  <UModal
    :open="true"
    :ui="{ content: 'max-w-2xl' }"
    @update:open="$emit('close')"
  >
    <template #title>
      <div class="flex items-center gap-2 min-w-0">
        <span class="truncate">{{ isEdit ? 'Edit Task' : 'New Task' }}</span>
        <UButton
          v-if="isEdit && taskPageUrl"
          :to="taskPageUrl"
          icon="i-lucide-arrow-up-right"
          label="Full page"
          color="neutral"
          variant="ghost"
          size="sm"
          class="shrink-0"
        />
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="createError"
          :description="createError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
        />

        <UFormField
          label="Title"
          required
        >
          <UInput
            v-model="form.title"
            placeholder="Task title"
            class="w-full"
            autofocus
          />
        </UFormField>

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Status">
            <USelect
              v-model="form.status"
              :items="statusSelectItems"
              value-key="value"
              class="w-full"
            >
              <template #leading>
                <UIcon
                  v-if="statusMeta"
                  :name="statusMeta.icon"
                  :class="`text-${statusMeta.color}`"
                  class="size-4 shrink-0"
                />
              </template>
              <template #item-leading="{ item }">
                <UIcon
                  :name="item.icon"
                  :class="`text-${item.color}`"
                  class="size-4 shrink-0"
                />
              </template>
            </USelect>
          </UFormField>

          <UFormField label="Priority">
            <USelect
              v-model="form.priority"
              :items="PRIORITY_SELECT_ITEMS"
              value-key="value"
              class="w-full"
            >
              <template #leading>
                <UIcon
                  v-if="priorityMeta"
                  :name="priorityMeta.icon"
                  :class="`text-${priorityMeta.color}`"
                  class="size-4 shrink-0"
                />
              </template>
              <template #item-leading="{ item }">
                <UIcon
                  :name="item.icon"
                  :class="`text-${item.color}`"
                  class="size-4 shrink-0"
                />
              </template>
            </USelect>
          </UFormField>
        </div>

        <UFormField label="Due Date">
          <UInput
            v-model="form.due"
            type="date"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Assignees">
          <UInputMenu
            v-model="form.assignees"
            :items="authorNames"
            multiple
            placeholder="Select or create assignees…"
            class="w-full"
            :create-item="{ position: 'bottom' }"
            @create="handleCreateAuthor"
          >
            <template #item-leading="{ item }">
              <UAvatar
                :alt="item"
                size="2xs"
              />
            </template>
          </UInputMenu>
        </UFormField>

        <UFormField
          v-if="dependencyItems.length"
          label="Dependencies"
        >
          <USelect
            v-model="form.dependencies"
            :items="dependencyItems"
            value-key="value"
            multiple
            placeholder="Select blocking tasks…"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Tags">
          <UInputTags
            v-model="form.tags"
            placeholder="Add tags…"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Description">
          <div
            v-if="descriptionLoading"
            class="flex items-center gap-2 py-4 text-sm text-muted"
          >
            <UIcon
              name="i-lucide-loader-2"
              class="size-4 animate-spin"
            />
            Loading…
          </div>
          <AppInputRichText
            v-else
            v-model="description"
            variant="outline"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div
        v-if="isEdit"
        class="flex items-center gap-1.5 w-full text-xs text-muted"
      >
        <UIcon
          v-if="saving"
          name="i-lucide-loader-2"
          class="size-3.5 animate-spin shrink-0"
        />
        <UIcon
          v-else-if="saveError"
          name="i-lucide-triangle-alert"
          class="size-3.5 shrink-0 text-error"
        />
        <UIcon
          v-else-if="savedAt"
          name="i-lucide-check"
          class="size-3.5 shrink-0 text-success"
        />
        <span :class="saveError ? 'text-error' : ''">
          <template v-if="saving">Saving…</template>
          <template v-else-if="saveError">{{ saveError }}</template>
          <template v-else-if="savedAt">Saved {{ savedAgo }}</template>
          <template v-else>Changes save automatically</template>
        </span>
        <UButton
          v-if="conflict"
          label="Reload"
          icon="i-lucide-refresh-cw"
          color="error"
          variant="soft"
          size="xs"
          class="shrink-0"
          :loading="reloading"
          @click="reloadAfterConflict"
        />
        <UButton
          :label="isArchived ? 'Unarchive' : 'Archive'"
          :icon="isArchived ? 'i-lucide-archive-restore' : 'i-lucide-archive'"
          color="neutral"
          variant="ghost"
          size="xs"
          class="ml-auto shrink-0"
          :loading="archiving"
          @click="toggleArchive"
        />
      </div>
      <div
        v-else
        class="flex justify-end w-full"
      >
        <UButton
          label="Create Task"
          :loading="creating"
          :disabled="!form.title.trim()"
          @click="create"
        />
      </div>
    </template>
  </UModal>
</template>
