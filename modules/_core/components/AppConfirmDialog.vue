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
  <UModal v-model:open="open" :ui="{ content: 'max-w-sm' }">
    <template #header>
      <div>
        <h3 class="text-base font-semibold">
          {{ title }}
        </h3>
        <p
          v-if="message"
          class="mt-1 text-sm text-muted"
        >
          {{ message }}
        </p>
      </div>
    </template>

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
