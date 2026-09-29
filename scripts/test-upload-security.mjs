import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashAdminPassword } from '../server/security/password.js'

const port = 18788
const origin = 'https://admin.example.test'
const password = 'upload-security-test-password'
const passwordHash = await hashAdminPassword(password)
const storageRoot = await mkdtemp(join(tmpdir(), 'utopia-upload-test-'))
const scannerScript = fileURLToPath(new URL('./fixtures/virus-scan.mjs', import.meta.url))
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
    UPLOAD_MAX_FILE_MB: '0.01',
    UPLOAD_TOTAL_QUOTA_MB: '1',
    UPLOAD_VIRUS_SCAN_COMMAND: process.execPath,
    UPLOAD_VIRUS_SCAN_ARGS: JSON.stringify([scannerScript]),
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
  throw new Error(`Upload security test server did not start.\n${serverOutput}`)
}

async function login() {
  const response = await fetch(url('/api/admin/auth/login'), {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  return {
    cookie: (response.headers.get('set-cookie') || '').split(';')[0],
    csrfToken: body.csrfToken,
  }
}

async function upload(session, bytes, filename, type) {
  const body = new FormData()
  body.append('file', new Blob([bytes], { type }), filename)
  body.append('name', filename)
  body.append('tag', '测试资源')
  return fetch(url('/api/admin/resources'), {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: session.cookie,
      'X-CSRF-Token': session.csrfToken,
      'X-Content-Version': String(session.version),
    },
    body,
  }).then(async (response) => {
    if (response.ok) session.version = (await response.clone().json()).version
    return response
  })
}

function storedZip(filename, content) {
  const name = Buffer.from(filename)
  const data = Buffer.from(content)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(0x0314, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38)

  const directory = Buffer.concat([central, name])
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(local.length + name.length + data.length, 16)
  return Buffer.concat([local, name, data, directory, eocd])
}

try {
  await waitForServer()
  const session = await login()
  session.version = (await (await fetch(url('/api/admin/content'), {
    headers: { Cookie: session.cookie },
  })).json()).version
  const articleHeaders = {
    Origin: origin,
    Cookie: session.cookie,
    'X-CSRF-Token': session.csrfToken,
    'X-Content-Version': String(session.version),
    'Content-Type': 'application/json',
  }
  const articleRequests = ['并发文章甲', '并发文章乙'].map((title) => fetch(url('/api/admin/articles'), {
    method: 'POST',
    headers: articleHeaders,
    body: JSON.stringify({ title, markdown: `## ${title}`, status: 'draft' }),
  }))
  const articleResponses = await Promise.all(articleRequests)
  assert.deepEqual(articleResponses.map((response) => response.status).sort(), [201, 409])
  const savedArticleResponse = articleResponses.find((response) => response.status === 201)
  session.version = (await savedArticleResponse.json()).version
  const midi = Buffer.concat([Buffer.from('MThd'), Buffer.from([0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0])])

  const accepted = await upload(session, midi, '奇迹从来没出现人声.mid', 'audio/midi')
  assert.equal(accepted.status, 201)
  const { resource } = await accepted.json()
  assert.equal(resource.downloadName, '奇迹从来没出现人声.mid')
  assert.equal(resource.storagePath, undefined)
  assert.match(resource.downloadUrl, /^\/api\/resources\/.+\/download$/)

  const download = await fetch(url(resource.downloadUrl))
  assert.equal(download.status, 200)
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(download.headers.get('content-security-policy'), 'sandbox')
  assert.match(download.headers.get('content-disposition') || '', /^attachment;/i)
  assert.match(download.headers.get('content-disposition') || '', /filename\*=UTF-8''/i)
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), midi)
  assert.equal((await fetch(url('/uploads/direct.mid'))).status, 404)

  const wav = Buffer.alloc(44)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(16000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const psd = Buffer.alloc(26)
  psd.write('8BPS', 0)
  psd.writeUInt16BE(1, 4)
  psd.writeUInt16BE(1, 12)
  psd.writeUInt32BE(1, 14)
  psd.writeUInt32BE(1, 18)
  psd.writeUInt16BE(8, 22)
  psd.writeUInt16BE(3, 24)
  assert.equal((await upload(session, wav, '伴奏.wav', 'audio/wav')).status, 201)
  assert.equal((await upload(session, png, '封面.png', 'image/png')).status, 201)
  assert.equal((await upload(session, psd, '封面工程.psd', 'image/vnd.adobe.photoshop')).status, 201)

  assert.equal((await upload(session, midi, '伪装.mp3', 'audio/mpeg')).status, 422)
  assert.equal((await upload(session, midi, '危险.exe.mid', 'audio/midi')).status, 400)
  assert.equal((await upload(session, midi, '类型错误.mid', 'image/png')).status, 400)
  assert.equal((await upload(session, Buffer.from('<svg></svg>'), '图像.svg', 'image/svg+xml')).status, 400)

  const safeZip = await upload(session, storedZip('readme.txt', 'safe'), '工程.zip', 'application/zip')
  assert.equal(safeZip.status, 201)
  const unsafeEntry = await upload(session, storedZip('payload.exe', 'safe'), '危险工程.zip', 'application/zip')
  assert.equal(unsafeEntry.status, 422)
  const malware = await upload(session, storedZip('readme.txt', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE'), '病毒测试.zip', 'application/zip')
  assert.equal(malware.status, 422)
  const scannerFailure = await upload(session, storedZip('readme.txt', 'SIMULATED-SCANNER-ERROR'), '扫描异常.zip', 'application/zip')
  assert.equal(scannerFailure.status, 503)

  const oversized = Buffer.concat([midi, Buffer.alloc(12 * 1024)])
  assert.equal((await upload(session, oversized, '超限.mid', 'audio/midi')).status, 413)

  const publicContent = await (await fetch(url('/api/content'))).json()
  assert.equal(publicContent.resources.length, 5)
  assert.ok(publicContent.resources.every((item) => !('storagePath' in item) && !('scanStatus' in item)))

  const deleted = await fetch(url(`/api/admin/resources/${resource.id}`), {
    method: 'DELETE',
    headers: { Origin: origin, Cookie: session.cookie, 'X-CSRF-Token': session.csrfToken, 'X-Content-Version': String(session.version) },
  })
  assert.equal(deleted.status, 200)
  session.version = (await deleted.json()).version
  assert.equal((await fetch(url(resource.downloadUrl))).status, 404)

  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.match(serverOutput, /"event":"admin_resource_upload","outcome":"succeeded"/)
  assert.match(serverOutput, /"event":"admin_resource_upload","outcome":"rejected"/)
  assert.match(serverOutput, /"event":"admin_resource_delete","outcome":"succeeded"/)
  assert.match(serverOutput, /"event":"server_error","outcome":"failed".*"statusCode":503/)
  assert.ok(!serverOutput.includes(password))

  const storedContent = JSON.parse(await readFile(join(storageRoot, 'data', 'content.json'), 'utf8'))
  assert.equal(storedContent.resources.length, 4)
  assert.equal(storedContent.articles.length, 1)
  console.log('Upload security integration tests passed.')
} finally {
  server.kill()
  await rm(storageRoot, { recursive: true, force: true })
}
