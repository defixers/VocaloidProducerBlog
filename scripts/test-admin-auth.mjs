import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { hashAdminPassword } from '../server/security/password.js'

const port = 18787
const origin = 'https://admin.example.test'
const password = 'integration-test-password'
const malformedBodySecret = 'malformed-json-secret'
const passwordHash = await hashAdminPassword(password)
let serverOutput = ''
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: new URL('../', import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'production',
    APP_ORIGIN: origin,
    ADMIN_PASSWORD_HASH: passwordHash,
    ADMIN_SESSION_IDLE_MINUTES: '0.01',
    ADMIN_LOGIN_IP_LIMIT: '100',
    ADMIN_LOGIN_ACCOUNT_LIMIT: '100',
    ADMIN_LOGIN_BACKOFF_BASE_MS: '30',
    ADMIN_LOGIN_BACKOFF_MAX_MS: '60',
    ADMIN_WRITE_LIMIT: '2',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (data) => { serverOutput += data })
server.stderr.on('data', (data) => { serverOutput += data })

const url = (path) => `http://127.0.0.1:${port}${path}`
const post = (path, options = {}) => fetch(url(path), {
  method: 'POST',
  ...options,
  headers: { 'Content-Type': 'application/json', ...options.headers },
})

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(url('/api/health'))).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Authentication test server did not start.')
}

async function login() {
  const response = await post('/api/admin/auth/login', {
    headers: { Origin: origin },
    body: JSON.stringify({ password }),
  })
  assert.equal(response.status, 200)
  const cookieHeader = response.headers.get('set-cookie') || ''
  assert.match(cookieHeader, /__Host-utopia_admin_session=/)
  assert.match(cookieHeader, /HttpOnly/i)
  assert.match(cookieHeader, /Secure/i)
  assert.match(cookieHeader, /SameSite=Strict/i)
  const body = await response.json()
  assert.equal(body.authenticated, true)
  assert.match(body.csrfToken, /^[A-Za-z0-9_-]{40,}$/)
  return { cookie: cookieHeader.split(';')[0], csrfToken: body.csrfToken }
}

try {
  await waitForServer()

  const oversizedRequest = await post('/api/admin/auth/login', {
    headers: { Origin: origin },
    body: JSON.stringify({ password: 'x'.repeat(600 * 1024) }),
  })
  assert.equal(oversizedRequest.status, 413)
  assert.equal((await oversizedRequest.json()).error, '请求内容超过限制')
  const malformedRequest = await post('/api/admin/auth/login', {
    headers: { Origin: origin },
    body: `{"password":"${malformedBodySecret}"`,
  })
  assert.equal(malformedRequest.status, 400)
  assert.equal((await malformedRequest.json()).error, '请求格式无效')
  assert.equal((await post('/api/admin/auth/login', {
    body: JSON.stringify({ password }),
  })).status, 403)
  const failedLogin = await post('/api/admin/auth/login', {
    headers: { Origin: origin },
    body: JSON.stringify({ password: 'incorrect-password' }),
  })
  assert.equal(failedLogin.status, 401)
  assert.equal((await failedLogin.json()).error, '登录失败')
  const backedOffLogin = await post('/api/admin/auth/login', {
    headers: { Origin: origin },
    body: JSON.stringify({ password: 'incorrect-password' }),
  })
  assert.equal(backedOffLogin.status, 429)
  assert.ok(backedOffLogin.headers.get('retry-after'))
  await new Promise((resolve) => setTimeout(resolve, 40))

  const first = await login()
  assert.equal((await fetch(url('/api/admin/auth/session'), {
    headers: { Cookie: first.cookie },
  })).status, 200)
  const adminContentResponse = await fetch(url('/api/admin/content'), {
    headers: { Cookie: first.cookie },
  })
  assert.equal(adminContentResponse.status, 200)
  const contentVersion = (await adminContentResponse.json()).version
  assert.equal((await post('/api/admin/auth/logout', {
    headers: { Origin: origin, Cookie: first.cookie },
  })).status, 403)
  assert.equal((await post('/api/admin/auth/logout', {
    headers: { Origin: 'https://invalid.example', Cookie: first.cookie, 'X-CSRF-Token': first.csrfToken },
  })).status, 403)
  const writeHeaders = { Origin: origin, Cookie: first.cookie, 'X-CSRF-Token': first.csrfToken, 'X-Content-Version': String(contentVersion) }
  assert.equal((await fetch(url('/api/admin/articles/missing'), {
    method: 'DELETE', headers: writeHeaders,
  })).status, 404)
  assert.equal((await fetch(url('/api/admin/articles/missing'), {
    method: 'DELETE', headers: writeHeaders,
  })).status, 404)
  assert.equal((await fetch(url('/api/admin/articles/missing'), {
    method: 'DELETE', headers: writeHeaders,
  })).status, 429)

  await new Promise((resolve) => setTimeout(resolve, 750))
  const expiredSession = await fetch(url('/api/admin/auth/session'), {
    headers: { Cookie: first.cookie },
  })
  assert.equal(expiredSession.status, 200)
  assert.equal((await expiredSession.json()).authenticated, false)

  const second = await login()
  const third = await login()
  assert.equal((await post('/api/admin/auth/revoke-all', {
    headers: { Origin: origin, Cookie: third.cookie, 'X-CSRF-Token': third.csrfToken },
  })).status, 204)
  assert.equal((await fetch(url('/api/admin/content'), {
    headers: { Cookie: second.cookie },
  })).status, 401)
  assert.equal((await fetch(url('/api/admin/content'), {
    headers: { Cookie: third.cookie },
  })).status, 401)

  const fourth = await login()
  assert.equal((await post('/api/admin/auth/logout', {
    headers: { Origin: origin, Cookie: fourth.cookie, 'X-CSRF-Token': fourth.csrfToken },
  })).status, 204)
  const loggedOutSession = await fetch(url('/api/admin/auth/session'), {
    headers: { Cookie: fourth.cookie },
  })
  assert.equal(loggedOutSession.status, 200)
  assert.equal((await loggedOutSession.json()).authenticated, false)

  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.match(serverOutput, /"event":"admin_login"/)
  assert.match(serverOutput, /"ip":"[^"]+"/)
  assert.ok(!serverOutput.includes(password))
  assert.ok(!serverOutput.includes(malformedBodySecret))
  assert.ok(!serverOutput.includes(first.cookie))
  assert.ok(!serverOutput.includes(first.csrfToken))

  console.log('Admin authentication integration tests passed.')
} finally {
  server.kill()
}
