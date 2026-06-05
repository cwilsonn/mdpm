<script setup lang="ts">
export interface PageAction {
  label?: string
  icon?: string
  to?: string
  color?: 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'
  variant?: 'solid' | 'outline' | 'soft' | 'subtle' | 'ghost' | 'link'
  disabled?: boolean
  loading?: boolean
  onSelect?: () => void
}

export interface PageBreadcrumbItem {
  label: string
  to?: string
  icon?: string
}

const props = withDefaults(defineProps<{
  title?: string
  icon?: string
  breadcrumb?: PageBreadcrumbItem[]
  backTo?: string
  actions?: PageAction[]
  loading?: boolean
  error?: string | null
  empty?: boolean
  emptyState?: Record<string, unknown>
}>(), {
  actions: () => [],
  loading: false,
  error: null,
  empty: false,
  emptyState: () => ({}),
})

const route = useRoute()
const effectiveTitle = computed(() => props.title ?? (route.meta?.title as string | undefined) ?? '')
const effectiveIcon = computed(() => props.icon ?? (route.meta?.icon as string | undefined))

const singleAction = computed(() => props.actions.length === 1 ? props.actions[0] : null)

const dropdownActionItems = computed(() => {
  if (props.actions.length <= 1) return []
  return [props.actions.map(a => ({
    label: a.label,
    icon: a.icon,
    color: a.color,
    disabled: a.disabled,
    to: a.to,
    onSelect: a.onSelect,
  }))]
})

const normalizedEmptyProps = computed(() => ({
  icon: 'i-lucide-inbox',
  title: 'Nothing here yet',
  description: 'Nothing to display right now.',
  ...props.emptyState,
}))
</script>

<template>
  <UDashboardPanel :ui="{ root: 'w-full min-w-0 flex-1 max-w-none' }">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UButton
            v-if="backTo"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            :to="backTo"
          />
          <slot name="leading" />
        </template>

        <template #title>
          <slot name="title">
            <UBreadcrumb
              v-if="breadcrumb?.length"
              :items="breadcrumb"
              :ui="{ root: 'min-w-0', link: 'truncate' }"
            />
            <div
              v-else
              class="flex min-w-0 items-center gap-2"
            >
              <UIcon
                v-if="effectiveIcon"
                :name="effectiveIcon"
                class="size-5 shrink-0 text-primary"
              />
              <span class="truncate">{{ effectiveTitle }}</span>
            </div>
          </slot>
        </template>

        <template #right>
          <slot name="actions" />

          <UButton
            v-if="singleAction"
            :label="singleAction.label"
            :icon="singleAction.icon"
            :to="singleAction.to"
            :color="singleAction.color || 'primary'"
            :variant="singleAction.variant || 'solid'"
            :disabled="singleAction.disabled"
            :loading="singleAction.loading"
            size="sm"
            @click="singleAction.onSelect?.()"
          />

          <UDropdownMenu
            v-else-if="actions.length > 1"
            :items="dropdownActionItems"
          >
            <UButton
              label="Actions"
              icon="i-lucide-chevron-down"
              trailing-icon="i-lucide-chevron-down"
              color="neutral"
              variant="outline"
              size="sm"
            />
          </UDropdownMenu>

          <slot name="right" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <slot
        v-if="loading"
        name="loading"
      >
        <div class="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <UIcon
            name="i-lucide-loader-2"
            class="size-6 animate-spin text-muted"
          />
          <p class="text-sm text-muted">
            Loading…
          </p>
        </div>
      </slot>

      <slot
        v-else-if="error"
        name="error"
      >
        <div class="p-4">
          <UAlert
            title="Something went wrong"
            :description="error"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
          />
        </div>
      </slot>

      <slot
        v-else-if="empty"
        name="empty"
      >
        <UEmpty v-bind="normalizedEmptyProps" />
      </slot>

      <slot v-else />

      <slot name="overlays" />
    </template>
  </UDashboardPanel>
</template>
