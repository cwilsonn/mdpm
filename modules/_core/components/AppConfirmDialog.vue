<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })

withDefaults(defineProps<{
  title?: string
  message?: string
  confirmLabel?: string
  confirmColor?: 'error' | 'primary' | 'warning'
  loading?: boolean
}>(), {
  title: 'Are you sure?',
  message: '',
  confirmLabel: 'Confirm',
  confirmColor: 'error',
  loading: false,
})

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function handleCancel() {
  emit('cancel')
  open.value = false
}

function handleConfirm() {
  emit('confirm')
}
</script>

<template>
  <!-- title/description as props, not a #header slot: only then are they the dialog's title and description
       (aria-labelledby/-describedby). A #header override leaves the dialog with an empty accessible name. -->
  <UModal
    v-model:open="open"
    :title="title"
    :description="message || undefined"
    :close="false"
    :ui="{ content: 'max-w-sm' }"
  >

    <template v-if="$slots.default" #body>
      <slot />
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="handleCancel"
        />
        <UButton
          :label="confirmLabel"
          :color="confirmColor"
          :loading="loading"
          @click="handleConfirm"
        />
      </div>
    </template>
  </UModal>
</template>
