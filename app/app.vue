<template>
  <UApp>
    <NuxtLoadingIndicator color="var(--ui-primary)" :height="2" :duration="8000" :throttle="0" />
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
