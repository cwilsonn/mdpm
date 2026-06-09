declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    icon?: string
  }
}

declare module '#app' {
  interface PageMeta {
    title?: string
    icon?: string
  }
}

export {}
