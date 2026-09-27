import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { hashAdminPassword } from '../server/security/password.js'

const port = 18787
const origin = 'https://admin.example.test'
const password = 'integration-test-password'
const passwordHash = await hashAdminPassword(password)
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: new URL('../', import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'production',
    APP_ORIGIN: origin,
    ADMIN_PASSWORD_HASH: passwordHash,
    ADMIN_SESSION_IDLE_MINUTES: '0.01',
  },
  stdio: 'ignore',
})

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

  assert.equal((await post('/api/admin/auth/login', {
    body: JSON.stringify({ password }),
  })).status, 403)
  assert.equal((await post('/api/admin/auth/login', {
    headers: { Origin: origin },
    body: JSON.stringify({ password: 'incorrect-password' }),
  })).status, 401)

  const first = await login()
  assert.equal((await fetch(url('/api/admin/auth/session'), {
    headers: { Cookie: first.cookie },
  })).status, 200)
  assert.equal((await fetch(url('/api/admin/content'), {
    headers: { Cookie: first.cookie },
  })).status, 200)
  assert.equal((await post('/api/admin/auth/logout', {
    headers: { Origin: origin, Cookie: first.cookie },
  })).status, 403)
  assert.equal((await post('/api/admin/auth/logout', {
    headers: { Origin: 'https://invalid.example', Cookie: first.cookie, 'X-CSRF-Token': first.csrfToken },
  })).status, 403)

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

  console.log('Admin authentication integration tests passed.')
} finally {
  server.kill()
}
