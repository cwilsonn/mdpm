import { existsSync, readdirSync } from 'node:fs'

export default defineNitroPlugin(() => {
  const projectsDir = contentPath('projects')
  const hasProjects = existsSync(projectsDir)
    && readdirSync(projectsDir).some(f => f !== '.gitkeep')

  if (!hasProjects) {
    seedContent()
  }
})
