<script setup lang="ts">
const props = defineProps<{
  project?: {
    path: string
    title: string
    status: string
    description?: string
    tags?: string[]
  }
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const isEdit = computed(() => !!props.project)

const form = reactive({
  title: props.project?.title ?? '',
  status: (props.project?.status ?? 'active') as 'active' | 'archived' | 'on-hold',
  description: props.project?.description ?? '',
  tags: [...(props.project?.tags ?? [])] as string[],
})

// auto-save state
const loaded = ref(false)
const saving = ref(false)
const savedAt = ref<Date | null>(null)
const saveError = ref<string | null>(null)
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

const savedAgo = computed(() => {
  if (!savedAt.value) return null
  const diff = Math.floor((now.value - savedAt.value.getTime()) / 1000)
  if (diff < 10) return 'just now'
  if (diff < 60) return `${diff}s ago`
  return `${Math.floor(diff / 60)}m ago`
})

onMounted(() => {
  loaded.value = true
  if (isEdit.value) {
    ticker = setInterval(() => now.value = Date.now(), 5000)
  }
})

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
  if (saveTimer) flushSave()
})

function scheduleSave() {
  if (!isEdit.value || !loaded.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => flushSave(), 800)
}

async function flushSave() {
  if (!isEdit.value || !loaded.value || saving.value) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  saving.value = true
  saveError.value = null
  try {
    const slug = props.project!.path.split('/').at(-1)
    await $fetch(`/api/projects/${slug}`, {
      method: 'PATCH',
      body: {
        title: form.title,
        status: form.status,
        description: form.description || undefined,
        tags: form.tags,
      },
    })
    savedAt.value = new Date()
  }
  catch (e: unknown) {
    saveError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Save failed'
  }
  finally {
    saving.value = false
  }
}

watch(() => form.title, () => scheduleSave())
watch(() => form.description, () => scheduleSave())
watch(() => form.status, () => flushSave())
watch(() => form.tags, () => flushSave(), { deep: true })

// create mode
const creating = ref(false)
const createError = ref<string | null>(null)

async function create() {
  creating.value = true
  createError.value = null
  try {
    await $fetch('/api/projects', {
      method: 'POST',
      body: {
        title: form.title,
        status: form.status,
        description: form.description || undefined,
        tags: form.tags,
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
