<script setup lang="ts">
const props = defineProps<{
  projectSlug?: string
  doc?: {
    path: string
    title: string
    tags?: string[]
    parent?: string | null
  }
}>()

const emit = defineEmits<{
  close: []
  saved: [slug: string]
}>()

const isEdit = computed(() => !!props.doc)
const isStandalone = computed(() => !props.projectSlug)

const form = reactive({
  title: props.doc?.title ?? '',
  tags: [...(props.doc?.tags ?? [])] as string[],
  parent: props.doc?.parent ?? '',
})

// sibling docs for parent selector
const siblingDocs = ref<{ label: string; value: string }[]>([])
const parentItems = computed(() => [
  { label: 'None (top-level)', value: '' },
  ...siblingDocs.value,
])

onMounted(async () => {
  initAutoSave()
  try {
    const docs = isStandalone.value
      ? await $fetch<{ slug: string; title: string }[]>('/api/standalone-docs')
      : await $fetch<{ slug: string; title: string }[]>(`/api/docs/${props.projectSlug}`)
    const selfSlug = props.doc ? slugFromPath(props.doc.path) : ''
    siblingDocs.value = docs
      .filter(d => d.slug !== selfSlug)
      .map(d => ({ label: d.title, value: d.slug }))
  }
  catch {}
})
onBeforeUnmount(() => cleanupAutoSave())

const creating = ref(false)
const createError = ref<string | null>(null)

function patchUrl() {
  const slug = slugFromPath(props.doc!.path)
  return isStandalone.value
    ? `/api/standalone-docs/${slug}`
    : `/api/docs/${props.projectSlug}/${slug}`
}

const { saving, savedAt, saveError, savedAgo, scheduleSave, flushSave, initAutoSave, cleanupAutoSave } = useAutoSave(
  isEdit,
  async () => {
    await $fetch(patchUrl(), {
      method: 'PATCH',
      body: {
        title: form.title,
        tags: form.tags,
        parent: form.parent || null,
      },
    })
  },
)

watch(() => form.title, () => { if (isEdit.value) scheduleSave() })
watch(() => form.tags, () => { if (isEdit.value) scheduleSave() }, { deep: true })
watch(() => form.parent, () => { if (isEdit.value) scheduleSave() })

async function create() {
  if (!form.title.trim()) return
  creating.value = true
  createError.value = null
  try {
    const url = isStandalone.value
      ? '/api/standalone-docs'
      : `/api/docs/${props.projectSlug}`
    const { slug } = await $fetch<{ slug: string }>(url, {
      method: 'POST',
      body: {
        title: form.title,
        tags: form.tags,
        ...(form.parent ? { parent: form.parent } : {}),
      },
    })
    emit('saved', slug)
  }
  catch (e: any) {
    createError.value = e?.data?.message ?? 'Failed to create doc'
  }
  finally {
    creating.value = false
  }
}
</script>

<template>
  <UModal :open="true" @update:open="emit('close')">
    <template #title>
      {{ isEdit ? 'Edit Doc' : 'New Doc' }}
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

        <UFormField label="Title" required>
          <UInput
            v-model="form.title"
            placeholder="Doc title"
            class="w-full"
            autofocus
            @keydown.enter="!isEdit && create()"
          />
        </UFormField>

        <UFormField label="Tags">
          <UInputTags
            v-model="form.tags"
            placeholder="Add tags…"
            class="w-full"
          />
        </UFormField>

        <UFormField v-if="parentItems.length > 1" label="Parent doc">
          <USelect
            v-model="form.parent"
            :items="parentItems"
            value-key="value"
            label-key="label"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div v-if="isEdit" class="flex items-center gap-1.5 w-full text-xs text-muted">
        <UIcon v-if="saving" name="i-lucide-loader-2" class="size-3.5 animate-spin shrink-0" />
        <UIcon v-else-if="saveError" name="i-lucide-triangle-alert" class="size-3.5 shrink-0 text-error" />
        <UIcon v-else-if="savedAt" name="i-lucide-check" class="size-3.5 shrink-0 text-success" />
        <span :class="saveError ? 'text-error' : ''">
          <template v-if="saving">Saving…</template>
          <template v-else-if="saveError">{{ saveError }}</template>
          <template v-else-if="savedAt">Saved {{ savedAgo }}</template>
          <template v-else>Changes save automatically</template>
        </span>
      </div>
      <div v-else class="flex justify-end w-full">
        <UButton
          label="Create Doc"
          :loading="creating"
          :disabled="!form.title.trim()"
          @click="create"
        />
      </div>
    </template>
  </UModal>
</template>
