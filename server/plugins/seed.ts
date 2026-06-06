import { existsSync, readdirSync } from 'node:fs'

export default defineNitroPlugin(() => {
  if (process.env.NODE_ENV !== 'production') return

  const projectsDir = contentPath('projects')
  const hasProjects = existsSync(projectsDir)
    && readdirSync(projectsDir).some(f => f !== '.gitkeep')

  if (!hasProjects) {
    seedContent()
  }
})
