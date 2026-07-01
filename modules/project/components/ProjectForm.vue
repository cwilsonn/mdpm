<script setup lang="ts">
const props = defineProps<{
  project?: {
    path: string
    title: string
    status?: string
    icon?: string
    description?: string
    tags?: string[]
    githubRepo?: string
    availableStatuses?: string[]
    defaultStatus?: string
    defaultPriority?: string
    defaultAssignee?: string
  }
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const { createProject, updateProject } = useProjects()
const { listAuthors, createAuthor } = useAuthors()

const isEdit = computed(() => !!props.project)

const form = reactive({
  title: props.project?.title ?? '',
  status: (props.project?.status ?? 'active') as 'active' | 'archived' | 'on-hold',
  icon: props.project?.icon ?? '',
  description: props.project?.description ?? '',
  tags: [...(props.project?.tags ?? [])] as string[],
  githubRepo: props.project?.githubRepo ?? '',
  availableStatuses: [...(props.project?.availableStatuses ?? ['todo', 'in-progress', 'done'])] as StatusId[],
  defaultStatus: (props.project?.defaultStatus ?? undefined) as StatusId | undefined,
  defaultPriority: (props.project?.defaultPriority ?? undefined) as PriorityId | undefined,
  defaultAssignee: props.project?.defaultAssignee ?? undefined,
})

const defaultStatusMeta = computed(() => form.defaultStatus ? STATUS_MAP[form.defaultStatus] : undefined)
const defaultPriorityMeta = computed(() => form.defaultPriority ? PRIORITY_MAP[form.defaultPriority] : undefined)

const authorNames = ref<string[]>([])

const defaultStatusItems = computed(() =>
  STATUS_SELECT_ITEMS.filter(s => form.availableStatuses.includes(s.value)),
)

watch(() => form.availableStatuses, (newVal) => {
  if (newVal.length === 0) {
    form.availableStatuses = ['todo'] as StatusId[]
    return
  }
  if (form.defaultStatus && !newVal.includes(form.defaultStatus)) {
    form.defaultStatus = newVal[0] ?? undefined
  }
}, { deep: true })

const { saving, savedAt, saveError, savedAgo, scheduleSave, flushSave, initAutoSave, cleanupAutoSave } = useAutoSave(
  isEdit,
  async () => {
    await updateProject(slugFromPath(props.project!.path), {
      title: form.title,
      status: form.status,
      icon: form.icon || null,
      description: form.description || undefined,
      tags: form.tags,
      githubRepo: form.githubRepo || null,
      availableStatuses: form.availableStatuses,
      defaultStatus: form.defaultStatus || null,
      defaultPriority: form.defaultPriority || null,
      defaultAssignee: form.defaultAssignee || null,
    })
  },
)

onMounted(() => {
  initAutoSave()
  listAuthors().then(data => {
    authorNames.value = data.map(a => a.name)
  })
})
onBeforeUnmount(() => cleanupAutoSave())

watch(() => form.title, () => scheduleSave())
watch(() => form.description, () => scheduleSave())
watch(() => form.status, () => flushSave())
watch(() => form.icon, () => flushSave())
watch(() => form.tags, () => flushSave(), { deep: true })
watch(() => form.githubRepo, () => scheduleSave())
watch(() => form.availableStatuses, () => flushSave(), { deep: true })
watch(() => form.defaultStatus, () => flushSave())
watch(() => form.defaultPriority, () => flushSave())
watch(() => form.defaultAssignee, () => scheduleSave())

async function handleCreateDefaultAssignee(name: string) {
  try {
    await createAuthor(name)
    if (!authorNames.value.includes(name)) authorNames.value.push(name)
    form.defaultAssignee = name
  }
  catch {}
}

// create mode
const creating = ref(false)
const createError = ref<string | null>(null)

async function create() {
  creating.value = true
  createError.value = null
  try {
    await createProject({
      title: form.title,
      status: form.status,
      icon: form.icon || undefined,
      description: form.description || undefined,
      tags: form.tags,
      githubRepo: form.githubRepo || undefined,
      availableStatuses: form.availableStatuses,
      defaultStatus: form.defaultStatus || undefined,
      defaultPriority: form.defaultPriority || undefined,
      defaultAssignee: form.defaultAssignee || undefined,
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
    :ui="{ content: 'max-w-lg' }"
    @update:open="$emit('close')"
  >
    <template #title>
      {{ isEdit ? 'Edit Project' : 'New Project' }}
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
            placeholder="Project name"
            class="w-full"
            autofocus
          />
        </UFormField>

        <UFormField label="Status">
          <USelect
            v-model="form.status"
            :items="PROJECT_STATUS_SELECT_ITEMS"
            value-key="value"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Icon">
          <AppIconPicker v-model="form.icon" />
        </UFormField>

        <UFormField label="Description">
          <UTextarea
            v-model="form.description"
            placeholder="Optional project description"
            class="w-full"
            :rows="3"
          />
        </UFormField>

        <UFormField label="Tags">
          <UInputTags
            v-model="form.tags"
            placeholder="Add tags…"
            class="w-full"
          />
        </UFormField>

        <UFormField label="GitHub Repo" hint="owner/repo">
          <UInput
            v-model="form.githubRepo"
            placeholder="e.g. anthropics/claude-code"
            class="w-full"
          />
        </UFormField>

        <USeparator label="Task Defaults" />

        <UFormField label="Available Statuses">
          <USelect
            v-model="form.availableStatuses"
            :items="STATUS_SELECT_ITEMS"
            value-key="value"
            multiple
            class="w-full"
          >
            <template #item-leading="{ item }">
              <UIcon
                :name="item.icon"
                :class="`text-${item.color}`"
                class="size-4 shrink-0"
              />
            </template>
          </USelect>
        </UFormField>

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Default Status">
            <USelect
              v-model="form.defaultStatus"
              :items="defaultStatusItems"
              value-key="value"
              placeholder="None"
              class="w-full"
            >
              <template #leading>
                <UIcon
                  v-if="defaultStatusMeta"
                  :name="defaultStatusMeta.icon"
                  :class="`text-${defaultStatusMeta.color}`"
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

          <UFormField label="Default Priority">
            <USelect
              v-model="form.defaultPriority"
              :items="PRIORITY_SELECT_ITEMS"
              value-key="value"
              placeholder="None"
              class="w-full"
            >
              <template #leading>
                <UIcon
                  v-if="defaultPriorityMeta"
                  :name="defaultPriorityMeta.icon"
                  :class="`text-${defaultPriorityMeta.color}`"
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

        <UFormField label="Default Assignee">
          <UInputMenu
            v-model="form.defaultAssignee"
            :items="authorNames"
            placeholder="Select or create…"
            class="w-full"
            :create-item="{ position: 'bottom' }"
            @create="handleCreateDefaultAssignee"
          >
            <template #leading="{ modelValue }">
              <UAvatar
                v-if="modelValue"
                :alt="(modelValue as string)"
                size="2xs"
                class="ml-0.5"
              />
            </template>
            <template #item-leading="{ item }">
              <UAvatar :alt="item" size="2xs" />
            </template>
          </UInputMenu>
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
          label="Create Project"
          :loading="creating"
          :disabled="!form.title.trim()"
          @click="create"
        />
      </div>
    </template>
  </UModal>
</template>
