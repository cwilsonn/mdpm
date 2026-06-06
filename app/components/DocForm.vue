<script setup lang="ts">
const props = defineProps<{
  projectSlug: string
  doc?: {
    path: string
    title: string
    tags?: string[]
  }
}>()

const emit = defineEmits<{
  close: []
  saved: [slug: string]
}>()

const isEdit = computed(() => !!props.doc)

const form = reactive({
  title: props.doc?.title ?? '',
  tags: [...(props.doc?.tags ?? [])] as string[],
})

const creating = ref(false)
const createError = ref<string | null>(null)

const { saving, savedAt, saveError, savedAgo, scheduleSave, flushSave, initAutoSave, cleanupAutoSave } = useAutoSave(
  isEdit,
  async () => {
    const slug = slugFromPath(props.doc!.path)
    await $fetch(`/api/docs/${props.projectSlug}/${slug}`, {
      method: 'PATCH',
      body: { title: form.title, tags: form.tags },
    })
  },
)

watch(() => form.title, () => { if (isEdit.value) scheduleSave() })
watch(() => form.tags, () => { if (isEdit.value) scheduleSave() }, { deep: true })

onMounted(() => initAutoSave())
onBeforeUnmount(() => cleanupAutoSave())

async function create() {
  if (!form.title.trim()) return
  creating.value = true
  createError.value = null
  try {
    const { slug } = await $fetch<{ slug: string }>(`/api/docs/${props.projectSlug}`, {
      method: 'POST',
      body: { title: form.title, tags: form.tags },
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
