const TOKEN_KEY = 'utopia-admin-token'

export function getAdminToken() {
  return sessionStorage.getItem(TOKEN_KEY) || ''
}

export function setAdminToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token)
  else sessionStorage.removeItem(TOKEN_KEY)
}

export function createAdminApi(getToken, onUnauthorized) {
  return async function adminApi(path, options = {}) {
    const headers = new Headers(options.headers || {})
    headers.set('Authorization', `Bearer ${getToken()}`)

    if (options.body && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(path, { ...options, headers })

    if (response.status === 401) {
      setAdminToken('')
      onUnauthorized?.()
      throw new Error('管理令牌无效')
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `请求失败（${response.status}）`)
    }

    return response.status === 204 ? null : response.json()
  }
}
