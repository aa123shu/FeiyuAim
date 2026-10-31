const TOKEN_KEY = 'feiyu-community-token-v1'
const configuredBase = import.meta.env.VITE_COMMUNITY_API_BASE
  || (import.meta.env.DEV ? '/api' : '/community-api')
const API_BASE = configuredBase.replace(/\/+$/, '')

export function getSessionToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function saveSessionToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // The server session still works for the current page if storage is unavailable.
  }
}

export async function apiRequest(path, options = {}) {
  const token = options.token ?? getSessionToken()
  const headers = new Headers(options.headers || {})
  if (token) headers.set('Authorization', 'Bearer ' + token)

  let body = options.body
  if (body && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(body)
  }

  const response = await fetch(API_BASE + path, { ...options, headers, body })
  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || '服务器请求失败 (' + response.status + ')')
  return payload
}

export async function apiDownload(path, onProgress) {
  const headers = new Headers()
  const token = getSessionToken()
  if (token) headers.set('Authorization', 'Bearer ' + token)
  const response = await fetch(API_BASE + path, { headers })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || '下载失败 (' + response.status + ')')
  }
  if (!response.body?.getReader) return response.blob()

  const reader = response.body.getReader()
  const chunks = []
  const total = Number(response.headers.get('content-length')) || 0
  let loaded = 0
  onProgress?.({ loaded, total, percent: 0 })

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    onProgress?.({ loaded, total, percent: total ? Math.min(100, Math.floor(loaded / total * 100)) : 0 })
  }

  return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' })
}

export async function loadCommunityState() {
  const result = {
    user: null,
    models: [],
    myModels: [],
    favoriteModels: [],
    pendingModels: [],
    reports: [],
    stats: { users: 0, approvedModels: 0, downloads: 0 },
  }
  const token = getSessionToken()

  if (token) {
    try {
      const { user } = await apiRequest('/auth/me')
      result.user = user
    } catch {
      saveSessionToken('')
    }
  }

  const requests = [
    apiRequest('/models'),
    apiRequest('/stats'),
  ]
  if (result.user) {
    requests.push(apiRequest('/models?mine=1'))
    requests.push(apiRequest('/models?favorites=1'))
    if (result.user.role === 'admin') {
      requests.push(apiRequest('/models?status=pending'))
      requests.push(apiRequest('/admin/reports'))
    }
  }
  const [publicResult, stats, mineResult, favoritesResult, pendingResult, reportsResult] = await Promise.all(requests)
  result.models = publicResult.models
  result.stats = stats
  result.myModels = mineResult?.models || []
  result.favoriteModels = favoritesResult?.models || []
  result.pendingModels = pendingResult?.models || []
  result.reports = reportsResult?.reports || []
  return result
}

