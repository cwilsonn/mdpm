<script setup lang="ts">
// Autosave indicator for edit forms and the doc editor: saving / error / saved,
// plus the two ways the record can diverge from disk: a refused save (409
// conflict, "Reload" drops local edits) and a change made elsewhere while this
// editor was busy ("Load").
const props = withDefaults(defineProps<{
  saving: boolean
  saveError: string | null
  savedAt: Date | null
  // null until the first save (useAutoSave)
  savedAgo: string | null
  idleLabel?: string
  conflict?: boolean
  reloading?: boolean
  remoteChanged?: boolean
  remoteLoading?: boolean
}>(), { idleLabel: 'Changes save automatically' })

const emit = defineEmits<{ reload: [], loadRemote: [] }>()
</script>

<template>
  <UIcon v-if="props.saving" name="i-lucide-loader-2" class="size-3.5 animate-spin shrink-0" />
  <UIcon v-else-if="props.saveError" name="i-lucide-triangle-alert" class="size-3.5 shrink-0 text-error" />
  <UIcon v-else-if="props.savedAt" name="i-lucide-check" class="size-3.5 shrink-0 text-success" />
  <span :class="props.saveError ? 'text-error' : ''">
    <template v-if="props.saving">Saving…</template>
    <template v-else-if="props.saveError">{{ props.saveError }}</template>
    <template v-else-if="props.savedAt">Saved {{ props.savedAgo }}</template>
    <template v-else>{{ props.idleLabel }}</template>
  </span>
  <UButton
    v-if="props.conflict"
    label="Reload"
    icon="i-lucide-refresh-cw"
    color="error"
    variant="soft"
    size="xs"
    class="shrink-0"
    :loading="props.reloading"
    @click="emit('reload')"
  />
  <template v-else-if="props.remoteChanged">
    <span class="text-warning">· Changed elsewhere</span>
    <UButton
      label="Load"
      icon="i-lucide-refresh-cw"
      color="warning"
      variant="soft"
      size="xs"
      class="shrink-0"
      :loading="props.remoteLoading"
      @click="emit('loadRemote')"
    />
  </template>
</template>
