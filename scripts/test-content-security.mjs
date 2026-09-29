import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { hashAdminPassword } from '../server/security/password.js'
import { parseServerEnv } from '../server/security/validation.js'

assert.throws(() => parseServerEnv({ PORT: 'invalid' }), /PORT/)
assert.throws(() => parseServerEnv({ UPLOAD_VIRUS_SCAN_ARGS: 'not-json' }), /UPLOAD_VIRUS_SCAN_ARGS/)
assert.equal(parseServerEnv({ PORT: '9000' }).PORT, 9000)

const dom = new JSDOM('<!doctype html>')
globalThis.window = dom.window
globalThis.document = dom.window.document
const { renderMarkdown } = await import('../src/security/markdown.js')
const rendered = renderMarkdown(`# 标题

**强调** \`code\` [安全链接](https://example.com)

<script>alert(1)</script><img src=x onerror=alert(1)>

[危险](javascript:alert(1)) [数据](data:text/html,test) [协议相对](//example.com/x)`)
assert.match(rendered, /<h1>标题<\/h1>/)
assert.match(rendered, /<strong>强调<\/strong>/)
assert.match(rendered, /<code>code<\/code>/)
assert.match(rendered, /href="https:\/\/example\.com"/)
assert.match(rendered, /rel="noopener noreferrer"/)
assert.doesNotMatch(rendered, /script|onerror|<img|javascript:/i)

const port = 18790
const origin = 'https://admin.example.test'
const password = 'content-security-test-password'
const passwordHash = await hashAdminPassword(password)
const storageRoot = await mkdtemp(join(tmpdir(), 'utopia-content-test-'))
await mkdir(join(storageRoot, 'data'), { recursive: true })
await mkdir(join(storageRoot, 'uploads'), { recursive: true })
await writeFile(join(storageRoot, 'data', 'content.json'), '{"articles":[],"resources":[]}\n')

let serverOutput = ''
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: new URL('../', import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'production',
    SECURITY_LOG_IP_KEY: 'integration-test-ip-key-with-32-characters',
    APP_ORIGIN: origin,
    APP_STORAGE_ROOT: storageRoot,
    ADMIN_PASSWORD_HASH: passwordHash,
    ADMIN_LOGIN_IP_LIMIT: '100',
    ADMIN_LOGIN_ACCOUNT_LIMIT: '100',
    ADMIN_WRITE_LIMIT: '100',
    UPLOAD_LIMIT: '100',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (data) => { serverOutput += data })
server.stderr.on('data', (data) => { serverOutput += data })

const url = (path) => `http://127.0.0.1:${port}${path}`

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(url('/api/health'))).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Content security test server did not start.\n${serverOutput}`)
}

async function requestArticle(session, body, version = session.version) {
  return fetch(url('/api/admin/articles'), {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: session.cookie,
      'X-CSRF-Token': session.csrfToken,
      'X-Content-Version': String(version),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function invalidArticle(session, body) {
  const response = await requestArticle(session, { title: '测试文章', markdown: '# 正文', ...body })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /输入内容无效|封面地址不安全/)
}

async function invalidResource(session, fields) {
  const form = new FormData()
  const midi = Buffer.concat([Buffer.from('MThd'), Buffer.from([0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0])])
  form.append('file', new Blob([midi], { type: 'audio/midi' }), 'test.mid')
  for (const [name, value] of Object.entries(fields)) form.append(name, value)
  const response = await fetch(url('/api/admin/resources'), {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: session.cookie,
      'X-CSRF-Token': session.csrfToken,
      'X-Content-Version': String(session.version),
    },
    body: form,
  })
  assert.equal(response.status, 400)
}

try {
  await waitForServer()
  const login = await fetch(url('/api/admin/auth/login'), {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  assert.equal(login.status, 200)
  const loginBody = await login.json()
  const session = {
    cookie: (login.headers.get('set-cookie') || '').split(';')[0],
    csrfToken: loginBody.csrfToken,
    version: 0,
  }
  const content = await (await fetch(url('/api/admin/content'), { headers: { Cookie: session.cookie } })).json()
  session.version = content.version

  await invalidArticle(session, { unexpected: true })
  await invalidArticle(session, { title: 'x'.repeat(121) })
  await invalidArticle(session, { excerpt: 'x'.repeat(301) })
  await invalidArticle(session, { date: '2026-02-30' })
  await invalidArticle(session, { status: 'public' })
  for (const image of ['javascript:alert(1)', 'data:image/png;base64,AA==', '//example.com/a.webp', '/images/../secret']) {
    await invalidArticle(session, { image })
  }

  const accepted = await requestArticle(session, { title: '有效文章', markdown: '# 正文', image: '/images/cover.webp' })
  assert.equal(accepted.status, 201)
  session.version = (await accepted.json()).version

  const concurrent = await Promise.all([
    requestArticle(session, { title: '并发甲', markdown: '# 甲' }),
    requestArticle(session, { title: '并发乙', markdown: '# 乙' }),
  ])
  assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409])
  const conflict = concurrent.find((response) => response.status === 409)
  const conflictBody = await conflict.json()
  assert.equal(conflictBody.version, session.version + 1)
  assert.match(conflictBody.error, /刷新后重试/)

  await invalidResource(session, { name: '测试', tag: '资源', meta: '', unexpected: 'field' })
  await invalidResource(session, { name: '测试', tag: '资源', meta: 'x'.repeat(301) })

  const stored = JSON.parse(await readFile(join(storageRoot, 'data', 'content.json'), 'utf8'))
  assert.equal(stored.version, 2)
  assert.equal(stored.articles.length, 2)
  assert.equal(stored.resources.length, 0)
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.match(serverOutput, /"event":"admin_article_create","outcome":"succeeded"/)
  assert.ok(!serverOutput.includes('有效文章'))
  assert.ok(!serverOutput.includes('# 正文'))
  console.log('Content validation and Markdown security tests passed.')
} finally {
  server.kill()
  await rm(storageRoot, { recursive: true, force: true })
  dom.window.close()
}
