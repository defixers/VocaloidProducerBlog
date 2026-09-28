let csrfToken = ''
let contentVersion = null
const unauthorized = Symbol('unauthorized')

async function request(path, options = {}, allowUnauthorized = false) {
  let response
  try {
    response = await fetch(path, { ...options, credentials: 'same-origin' })
  } catch {
    throw new Error('无法连接后台 API，请检查内容服务是否已启动')
  }

  if (response.status === 401 && allowUnauthorized) {
    await response.text()
    csrfToken = ''
    contentVersion = null
    return unauthorized
  }
  if (response.status === 204) return null

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error('后台 API 返回了网页内容，请检查 /api 反向代理配置')
  }

  const data = await response.json()
  if (!response.ok) {
    const error = new Error(data.error || `请求失败（${response.status}）`)
    error.status = response.status
    throw error
  }
  return data
}

export async function loginAdmin(password) {
  const data = await request('/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  csrfToken = data.csrfToken
  return data
}

export async function restoreAdminSession() {
  const data = await request('/api/admin/auth/session', {}, true)
  if (data === unauthorized) return false
  csrfToken = data?.csrfToken || ''
  return Boolean(data?.authenticated)
}

export async function logoutAdmin() {
  if (!csrfToken) return
  const result = await request('/api/admin/auth/logout', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
  }, true)
  csrfToken = ''
  contentVersion = null
  return result !== unauthorized
}

export function createAdminApi(onUnauthorized) {
  return async function adminApi(path, options = {}) {
    const headers = new Headers(options.headers || {})
    const method = String(options.method || 'GET').toUpperCase()

    if (options.body && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json')
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers.set('X-CSRF-Token', csrfToken)
      if (contentVersion === null) throw new Error('内容版本尚未加载，请刷新后重试')
      headers.set('X-Content-Version', String(contentVersion))
    }

    const data = await request(path, { ...options, method, headers }, true)
    if (data === unauthorized) {
      onUnauthorized?.()
      throw new Error('管理会话无效或已过期')
    }
    if (Number.isSafeInteger(data?.version)) contentVersion = data.version
    return data
  }
}
