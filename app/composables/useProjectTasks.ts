export async function useProjectTasks(keys: { projects: string; tasks: string }) {
  const [{ data: projects, refresh: refreshProjects }, { data: tasks, refresh: refreshTasks }] = await Promise.all([
    useAsyncData(keys.projects, () => queryCollection('projects').all()),
    useAsyncData(keys.tasks, () => queryCollection('tasks').all()),
  ])

  async function refreshAll() {
    await Promise.all([refreshProjects(), refreshTasks()])
  }

  return { projects, tasks, refreshAll }
}
