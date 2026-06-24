<script setup lang="ts">
const props = defineProps<{
  projectSlug: string
  initialStatus?: 'todo' | 'in-progress' | 'in-review' | 'done' | 'blocked'
  availableStatuses?: string[]
  defaultPriority?: string
  defaultAssignee?: string
  task?: {
    path: string
    title: string
    status: string
    priority: string
    tags?: string[]
    assignees?: string[]
    due?: string
    dependencies?: string[]
    githubIssues?: number[]
    githubPRs?: number[]
  }
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const isEdit = computed(() => !!props.task)

const taskPageUrl = computed(() => {
  if (!props.task) return null
  return `/projects/${props.projectSlug}/tasks/${slugFromPath(props.task.path)}`
})

const currentTaskSlug = computed(() => props.task ? slugFromPath(props.task.path) : null)

const form = reactive({
  title: props.task?.title ?? '',
  status: (props.task?.status ?? props.initialStatus ?? 'todo') as 'todo' | 'in-progress' | 'in-review' | 'done' | 'blocked',
  priority: (props.task?.priority ?? props.defaultPriority ?? 'medium') as 'low' | 'medium' | 'high' | 'urgent',
  tags: [...(props.task?.tags ?? [])] as string[],
  assignees: props.task ? [...(props.task.assignees ?? [])] : (props.defaultAssignee ? [props.defaultAssignee] : []) as string[],
  due: props.task?.due ?? '',
  dependencies: [...(props.task?.dependencies ?? [])] as string[],
  githubIssues: [...(props.task?.githubIssues ?? [])].map(String),
  githubPRs: [...(props.task?.githubPRs ?? [])].map(String),
})

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

function parseNums(tags: string[]): number[] {
  return tags.map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n > 0)
}

const description = ref('')
const descriptionLoading = ref(false)
const authorNames = ref<string[]>([])

const { saving, savedAt, saveError, savedAgo, scheduleSave, flushSave, initAutoSave, cleanupAutoSave } = useAutoSave(
  isEdit,
  async () => {
    const slug = slugFromPath(props.task!.path)
    await $fetch(`/api/tasks/${props.projectSlug}/${slug}`, {
      method: 'PATCH',
      body: {
        title: form.title,
        status: form.status,
        priority: form.priority,
        tags: form.tags,
        assignees: form.assignees,
        due: form.due || undefined,
        dependencies: form.dependencies,
        githubIssues: parseNums(form.githubIssues),
        githubPRs: parseNums(form.githubPRs),
        description: description.value,
      },
    })
  },
)

onMounted(async () => {
  $fetch<{ name: string }[]>('/api/authors').then((data) => {
    authorNames.value = data.map(a => a.name)
  })

  $fetch<ProjectTask[]>(`/api/tasks/${props.projectSlug}`).then((data) => {
    projectTasks.value = data
  })

  if (isEdit.value && props.task) {
    const tSlug = slugFromPath(props.task.path)
    descriptionLoading.value = true
    try {
      const raw = await $fetch<{ body: string }>(`/api/tasks/${props.projectSlug}/${tSlug}`)
      description.value = raw.body ?? ''
      await nextTick()
    }
    catch {}
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
watch(() => form.githubIssues, () => flushSave(), { deep: true })
watch(() => form.githubPRs, () => flushSave(), { deep: true })
watch(description, () => scheduleSave())

// create mode
const creating = ref(false)
const createError = ref<string | null>(null)

async function handleCreateAuthor(name: string) {
  try {
    await $fetch('/api/authors', { method: 'POST', body: { name } })
    if (!authorNames.value.includes(name)) authorNames.value.push(name)
    if (!form.assignees.includes(name)) form.assignees.push(name)
  }
  catch {}
}

async function create() {
  creating.value = true
  createError.value = null
  try {
    await $fetch('/api/tasks', {
      method: 'POST',
      body: {
        project: props.projectSlug,
        title: form.title,
        status: form.status,
        priority: form.priority,
        tags: form.tags,
        assignees: form.assignees,
        due: form.due || undefined,
        dependencies: form.dependencies,
        githubIssues: parseNums(form.githubIssues),
        githubPRs: parseNums(form.githubPRs),
        description: description.value,
      },
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
                  v-if="STATUS_MAP[form.status]"
                  :name="STATUS_MAP[form.status].icon"
                  :class="`text-${STATUS_MAP[form.status].color}`"
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
                  v-if="PRIORITY_MAP[form.priority]"
                  :name="PRIORITY_MAP[form.priority].icon"
                  :class="`text-${PRIORITY_MAP[form.priority].color}`"
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

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="GitHub Issues" hint="#">
            <UInputTags
              v-model="form.githubIssues"
              placeholder="42, 87…"
              class="w-full"
            />
          </UFormField>
          <UFormField label="GitHub PRs" hint="#">
            <UInputTags
              v-model="form.githubPRs"
              placeholder="101…"
              class="w-full"
            />
          </UFormField>
        </div>

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
