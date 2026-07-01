export function resolveRouteMeta(path: string): { label: string | undefined; icon: string | undefined } {
  const router = useRouter()
  const { meta } = router.resolve(path)
  return { label: meta.title as string | undefined, icon: meta.icon as string | undefined }
}
