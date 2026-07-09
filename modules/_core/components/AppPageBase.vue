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

export interface PageTab {
  label: string
  icon?: string
  to: string
  exact?: boolean
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
  mobileActions?: PageAction[]
  tabs?: PageTab[]
  loading?: boolean
  error?: string | null
  empty?: boolean
  emptyState?: Record<string, unknown>
  fullHeight?: boolean
}>(), {
  actions: () => [],
  mobileActions: undefined,
  tabs: () => [],
  loading: false,
  error: null,
  empty: false,
  emptyState: () => ({}),
  fullHeight: false,
})

const route = useRoute()

const effectiveTitle = computed(() => props.title ?? route.meta.title ?? '')
const effectiveIcon = computed(() => props.icon ?? route.meta.icon)

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

// Mobile three-dots: prefers mobileActions, falls back to actions prop
const mobileDropdownItems = computed(() => {
  const src = props.mobileActions ?? (props.actions.length > 0 ? props.actions : null)
  if (!src?.length) return []
  return [src.map(a => ({
    label: a.label,
    icon: a.icon,
    color: a.color,
    disabled: a.disabled,
    to: a.to,
    onSelect: a.onSelect,
  }))]
})

// Mobile breadcrumb helpers
const mobileBreadcrumbBack = computed(() => {
  if (!props.breadcrumb?.length || props.backTo) return null
  return props.breadcrumb.slice(0, -1).reverse().find(b => b.to) ?? null
})
const mobileBreadcrumbCurrent = computed(() =>
  props.breadcrumb?.at(-1)?.label ?? '',
)

const normalizedEmptyProps = computed(() => ({
  icon: 'i-lucide-inbox',
  title: 'Nothing here yet',
  description: 'Nothing to display right now.',
  ...props.emptyState,
}))
</script>

<template>
  <UDashboardPanel :ui="{ root: 'w-full min-w-0 flex-1 max-w-none', body: 'flex flex-col flex-1 overflow-hidden' }">
    <template #header>
      <UDashboardNavbar :ui="{ title: 'flex items-center gap-1.5 font-semibold text-highlighted min-w-0 overflow-hidden' }">
        <template #leading>
          <UDashboardSidebarCollapse side="left" />
          <span class="self-stretch flex-1 border-l border-muted mr-1.5" aria-hidden="true"></span>
          <!-- Back button -->
          <UButton
            v-if="backTo"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            :to="backTo"
          />
          <!-- Mobile breadcrumb back button (only when no backTo already set) -->
          <UButton
            v-else-if="mobileBreadcrumbBack"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            class="md:hidden"
            :to="mobileBreadcrumbBack.to"
          />
          <slot name="leading" />
        </template>

        <template #title>
          <slot name="title">
            <div v-if="breadcrumb?.length" class="min-w-0 flex-1">
              <!-- Desktop: full breadcrumb -->
              <UBreadcrumb
                :items="breadcrumb"
                :ui="{ root: 'min-w-0 hidden md:flex', link: 'truncate' }"
              />
              <!-- Mobile: current segment only -->
              <span class="md:hidden block truncate min-w-0 font-medium text-sm">{{ mobileBreadcrumbCurrent }}</span>
            </div>
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
          <!-- Slot actions: hidden on mobile, shown on desktop -->
          <div class="hidden md:flex items-center gap-2">
            <slot name="actions" />
          </div>

          <!-- Desktop: actions prop (single button or dropdown) -->
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
            class="hidden md:flex"
            @click="singleAction.onSelect?.()"
          />

          <UDropdownMenu
            v-else-if="actions.length > 1"
            :items="dropdownActionItems"
            class="hidden md:flex"
          >
            <UButton
              label="Actions"
              trailing-icon="i-lucide-chevron-down"
              color="neutral"
              variant="outline"
              size="sm"
            />
          </UDropdownMenu>

          <!-- Mobile: always-visible status/indicator slot -->
          <slot name="right" />

          <!-- Mobile: three-dots dropdown -->
          <UDropdownMenu
            v-if="mobileDropdownItems.length"
            :items="mobileDropdownItems"
            class="md:hidden"
          >
            <UButton
              icon="i-lucide-ellipsis"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="More actions"
            />
          </UDropdownMenu>
        </template>
      </UDashboardNavbar>

      <UNavigationMenu
        v-if="tabs.length"
        :items="tabs"
        highlight
        pill
        class="border-b border-default px-2 sm:px-4"
      />
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
        <div class="">
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

      <div v-else class="flex flex-col flex-1 min-h-0 overflow-hidden p-2">
        <slot />
      </div>

      <slot name="overlays" />
    </template>
  </UDashboardPanel>
</template>
