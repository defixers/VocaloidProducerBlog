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

    let response
    try {
      response = await fetch(path, { ...options, headers })
    } catch {
      throw new Error('无法连接后台 API，请检查内容服务是否已启动')
    }

    if (response.status === 401) {
      setAdminToken('')
      onUnauthorized?.()
      throw new Error('管理令牌无效')
    }

    if (response.status === 204) return null

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      throw new Error('后台 API 返回了网页内容，请检查 /api 反向代理配置')
    }

    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || `请求失败（${response.status}）`)
    }

    return data
  }
}
