import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { hashAdminPassword } from '../server/security/password.js'
import {
  UpstreamSecurityError,
  fetchUpstreamBuffer,
  isPublicAddress,
  validateUpstreamUrl,
} from '../server/security/upstream.js'

const allowedHosts = new Set(['i0.hdslb.com', 'i1.hdslb.com'])
const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }]

function fakeRequest(steps) {
  let index = 0
  return (url, options, callback) => {
    const request = new EventEmitter()
    request.destroy = (error) => queueMicrotask(() => request.emit('error', error))
    request.end = () => {
      const step = steps[index++]
      assert.ok(step, `Unexpected request to ${url.href}`)
      if (step.hang) {
        const keepAlive = setTimeout(() => {}, 1000)
        options.signal.addEventListener('abort', () => {
          clearTimeout(keepAlive)
          const error = new Error('aborted')
          error.name = 'AbortError'
          request.emit('error', error)
        }, { once: true })
        return
      }
      queueMicrotask(() => {
        const response = new PassThrough()
        response.statusCode = step.status || 200
        response.headers = step.headers || { 'content-type': 'image/webp' }
        callback(response)
        for (const chunk of step.chunks || [Buffer.from(step.body || 'ok')]) response.write(chunk)
        response.end()
      })
    }
    return request
  }
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof UpstreamSecurityError && error.code === code)
}

assert.equal(isPublicAddress('93.184.216.34'), true)
for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fc00::1', 'fe80::1']) {
  assert.equal(isPublicAddress(address), false, `${address} must be blocked`)
}
assert.equal(validateUpstreamUrl('https://i0.hdslb.com/bfs/archive/a.webp', allowedHosts).hostname, 'i0.hdslb.com')
for (const value of [
  'http://i0.hdslb.com/image.webp',
  'https://evil.example/image.webp',
  'https://i0.hdslb.com:8443/image.webp',
  'https://user:pass@i0.hdslb.com/image.webp',
  'https://127.0.0.1/image.webp',
]) assert.throws(() => validateUpstreamUrl(value, allowedHosts), UpstreamSecurityError)

const baseOptions = {
  allowedHosts,
  maxBytes: 16,
  maxRedirects: 2,
  timeoutMs: 100,
  resolveHost: publicResolver,
}

const success = await fetchUpstreamBuffer('https://i0.hdslb.com/image.webp', {
  ...baseOptions,
  requestImpl: fakeRequest([{ status: 302, headers: { location: 'https://i1.hdslb.com/final.webp' } }, { body: 'image' }]),
})
assert.equal(success.url.hostname, 'i1.hdslb.com')
assert.equal(success.body.toString(), 'image')

await expectCode(fetchUpstreamBuffer('https://i0.hdslb.com/image.webp', {
  ...baseOptions,
  resolveHost: async () => [{ address: '127.0.0.1', family: 4 }],
  requestImpl: fakeRequest([]),
}), 'upstream_address_blocked')

await expectCode(fetchUpstreamBuffer('https://i0.hdslb.com/image.webp', {
  ...baseOptions,
  requestImpl: fakeRequest([{ status: 302, headers: { location: 'https://evil.example/private' } }]),
}), 'invalid_upstream_url')

await expectCode(fetchUpstreamBuffer('https://i0.hdslb.com/image.webp', {
  ...baseOptions,
  maxRedirects: 1,
  requestImpl: fakeRequest([
    { status: 302, headers: { location: 'https://i1.hdslb.com/again' } },
    { status: 302, headers: { location: 'https://i0.hdslb.com/loop' } },
  ]),
}), 'upstream_redirect_limit')

await expectCode(fetchUpstreamBuffer('https://i0.hdslb.com/image.webp', {
  ...baseOptions,
  requestImpl: fakeRequest([{ headers: { 'content-length': '17' }, body: 'ignored' }]),
}), 'upstream_response_too_large')

await expectCode(fetchUpstreamBuffer('https://i0.hdslb.com/image.webp', {
  ...baseOptions,
  requestImpl: fakeRequest([{ headers: {}, chunks: [Buffer.alloc(10), Buffer.alloc(10)] }]),
}), 'upstream_response_too_large')

await expectCode(fetchUpstreamBuffer('https://i0.hdslb.com/image.webp', {
  ...baseOptions,
  timeoutMs: 20,
  requestImpl: fakeRequest([{ hang: true }]),
}), 'upstream_timeout')

const port = 18789
const storageRoot = await mkdtemp(join(tmpdir(), 'utopia-public-test-'))
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
    APP_ORIGIN: 'https://admin.example.test',
    APP_STORAGE_ROOT: storageRoot,
    ADMIN_PASSWORD_HASH: await hashAdminPassword('public-security-test-password'),
    BILIBILI_IMAGE_RATE_LIMIT: '1',
    RESOURCE_DOWNLOAD_RATE_LIMIT: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (data) => { serverOutput += data })
server.stderr.on('data', (data) => { serverOutput += data })
const serverUrl = (path) => `http://127.0.0.1:${port}${path}`

try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(serverUrl('/api/health'))).ok) break
    } catch {}
    if (attempt === 39) throw new Error(`Public security test server did not start.\n${serverOutput}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  const maliciousUrl = 'http://127.0.0.1/private?secret=DO-NOT-LOG'
  const firstImage = await fetch(serverUrl(`/api/bilibili/image?url=${encodeURIComponent(maliciousUrl)}`))
  assert.equal(firstImage.status, 400)
  assert.equal((await firstImage.json()).error, '图片地址无效')
  const limitedImage = await fetch(serverUrl(`/api/bilibili/image?url=${encodeURIComponent(maliciousUrl)}`))
  assert.equal(limitedImage.status, 429)
  assert.ok(limitedImage.headers.get('retry-after'))

  assert.equal((await fetch(serverUrl('/api/resources/missing/download'))).status, 404)
  assert.equal((await fetch(serverUrl('/api/resources/missing/download'))).status, 429)

  const statsResponse = await fetch(serverUrl('/api/bilibili/cache-stats'))
  assert.equal(statsResponse.status, 200)
  const stats = await statsResponse.json()
  assert.deepEqual(stats.feed, { hits: 0, misses: 0, coalesced: 0, cached: false })
  assert.equal(stats.images.entries, 0)
  assert.equal(stats.images.bytes, 0)
  assert.ok(stats.images.maxBytes > 0)

  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.ok(!serverOutput.includes('DO-NOT-LOG'))
} finally {
  server.kill()
  await rm(storageRoot, { recursive: true, force: true })
}

console.log('Public endpoint security tests passed.')
