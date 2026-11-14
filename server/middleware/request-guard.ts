import { allowedHosts, checkRequest } from '../utils/request-guard'

// Runs before every route and page. The rules and their reasons live in server/utils/request-guard.ts.
const hosts = allowedHosts()

export default defineEventHandler((event) => {
  const rejection = checkRequest({
    method: event.method,
    path: event.path,
    headers: {
      'host': getRequestHeader(event, 'host'), // raw header: getRequestHost() substitutes 'localhost' when it is missing
      'origin': getRequestHeader(event, 'origin'),
      'content-type': getRequestHeader(event, 'content-type'),
    },
  }, hosts)
  if (rejection) throw createError(rejection)
})
