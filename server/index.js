import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { promisify } from 'node:util'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import multer from 'multer'
import { hashAdminPassword, isAdminPasswordHash, verifyAdminPassword } from './security/password.js'
import {
  UploadSecurityError,
  inspectUpload,
  requiresVirusScan,
  uploadContentType,
  validateUploadMetadata,
} from './security/upload.js'
import { UpstreamSecurityError, fetchUpstreamBuffer, validateUpstreamUrl } from './security/upstream.js'

const execFileAsync = promisify(execFile)

const rootDir = resolve(import.meta.dirname, '..')
const envFile = join(rootDir, '.env')
if (existsSync(envFile)) loadEnvFile(envFile)
const storageRoot = process.env.APP_STORAGE_ROOT ? resolve(process.env.APP_STORAGE_ROOT) : join(rootDir, 'server')
const dataDir = join(storageRoot, 'data')
const dataFile = join(dataDir, 'content.json')
const uploadDir = join(storageRoot, 'uploads')
const distDir = join(rootDir, 'dist')
const port = Number(process.env.PORT || 8787)
const isProduction = process.env.NODE_ENV === 'production'
const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || (isProduction ? '' : await hashAdminPassword('utopia-dev'))
const configuredOrigins = process.env.APP_ORIGIN || (isProduction
  ? ''
  : 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8787,http://localhost:8787')
const allowedOrigins = new Set(configuredOrigins.split(',').map((value) => value.trim()).filter(Boolean).map((value) => new URL(value).origin))
const sessionIdleMs = Number(process.env.ADMIN_SESSION_IDLE_MINUTES || 30) * 60 * 1000
const sessionAbsoluteMs = Number(process.env.ADMIN_SESSION_ABSOLUTE_HOURS || 8) * 60 * 60 * 1000
const sessionCookieName = isProduction ? '__Host-utopia_admin_session' : 'utopia_admin_session'
const adminSessions = new Map()
const loginFailures = new Map()
const activeAdminWrites = new Map()
const activePublicRequests = new Map()
const loginFailureLimit = 10000
let activeLoginAttempts = 0
let activeUploads = 0
let contentMutationQueue = Promise.resolve()
let bilibiliFeedPending = null
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || (isProduction ? 1 : 0))
const loginWindowMs = positiveNumber('ADMIN_LOGIN_WINDOW_MINUTES', 15) * 60 * 1000
const loginIpLimit = positiveInteger('ADMIN_LOGIN_IP_LIMIT', 10)
const loginAccountLimit = positiveInteger('ADMIN_LOGIN_ACCOUNT_LIMIT', 30)
const loginBackoffBaseMs = positiveNumber('ADMIN_LOGIN_BACKOFF_BASE_MS', 500)
const loginBackoffMaxMs = positiveNumber('ADMIN_LOGIN_BACKOFF_MAX_MS', 30000)
const loginConcurrency = positiveInteger('ADMIN_LOGIN_CONCURRENCY', 2)
const adminWriteWindowMs = positiveNumber('ADMIN_WRITE_WINDOW_MINUTES', 10) * 60 * 1000
const adminWriteLimit = positiveInteger('ADMIN_WRITE_LIMIT', 60)
const adminWriteConcurrency = positiveInteger('ADMIN_WRITE_CONCURRENCY', 2)
const uploadWindowMs = positiveNumber('UPLOAD_WINDOW_MINUTES', 60) * 60 * 1000
const uploadLimit = positiveInteger('UPLOAD_LIMIT', 10)
const uploadConcurrency = positiveInteger('UPLOAD_CONCURRENCY', 1)
const uploadMaxFileBytes = Math.floor(positiveNumber('UPLOAD_MAX_FILE_MB', 100) * 1024 * 1024)
const uploadTotalQuotaBytes = Math.floor(positiveNumber('UPLOAD_TOTAL_QUOTA_MB', 1024) * 1024 * 1024)
const archiveLimits = {
  maxUncompressedBytes: Math.floor(positiveNumber('UPLOAD_ARCHIVE_MAX_UNCOMPRESSED_MB', 512) * 1024 * 1024),
  maxFiles: positiveInteger('UPLOAD_ARCHIVE_MAX_FILES', 1000),
  maxDepth: positiveInteger('UPLOAD_ARCHIVE_MAX_DEPTH', 10),
  maxCompressionRatio: positiveNumber('UPLOAD_ARCHIVE_MAX_RATIO', 100),
}
const virusScanCommand = String(process.env.UPLOAD_VIRUS_SCAN_COMMAND || '').trim()
const virusScanArgs = stringArrayFromEnv('UPLOAD_VIRUS_SCAN_ARGS', ['--no-summary'])
const virusScanTimeoutMs = positiveNumber('UPLOAD_SCAN_TIMEOUT_SECONDS', 60) * 1000
const publicRateWindowMs = positiveNumber('PUBLIC_RATE_WINDOW_MINUTES', 10) * 60 * 1000
const bilibiliFeedRateLimit = positiveInteger('BILIBILI_FEED_RATE_LIMIT', 60)
const bilibiliImageRateLimit = positiveInteger('BILIBILI_IMAGE_RATE_LIMIT', 180)
const resourceDownloadRateLimit = positiveInteger('RESOURCE_DOWNLOAD_RATE_LIMIT', 60)
const bilibiliFeedConcurrency = positiveInteger('BILIBILI_FEED_CONCURRENCY', 4)
const bilibiliImageConcurrency = positiveInteger('BILIBILI_IMAGE_CONCURRENCY', 8)
const resourceDownloadConcurrency = positiveInteger('RESOURCE_DOWNLOAD_CONCURRENCY', 4)
const bilibiliUpstreamTimeoutMs = positiveNumber('BILIBILI_UPSTREAM_TIMEOUT_SECONDS', 8) * 1000
const bilibiliJsonMaxBytes = Math.floor(positiveNumber('BILIBILI_JSON_MAX_MB', 2) * 1024 * 1024)
const bilibiliImageMaxBytes = Math.floor(positiveNumber('BILIBILI_IMAGE_MAX_MB', 5) * 1024 * 1024)
const bilibiliRedirectLimit = positiveInteger('BILIBILI_REDIRECT_LIMIT', 3)
const bilibiliImageCacheLimit = Math.floor(positiveNumber('BILIBILI_IMAGE_CACHE_MB', 32) * 1024 * 1024)
const bilibiliImageCacheEntries = positiveInteger('BILIBILI_IMAGE_CACHE_ENTRIES', 64)
const resourceDownloadMaxBytes = Math.floor(positiveNumber('RESOURCE_DOWNLOAD_MAX_MB', 100) * 1024 * 1024)
const resourceDownloadTimeoutMs = positiveNumber('RESOURCE_DOWNLOAD_TIMEOUT_SECONDS', 120) * 1000
const serverHeadersTimeoutMs = positiveNumber('SERVER_HEADERS_TIMEOUT_SECONDS', 15) * 1000
const serverRequestTimeoutMs = positiveNumber('SERVER_REQUEST_TIMEOUT_SECONDS', 120) * 1000
const bilibiliUid = process.env.BILIBILI_UID || '1858510441'
const bilibiliCookie = process.env.BILIBILI_COOKIE || ''
const bilibiliCache = { expiresAt: 0, payload: null }
const bilibiliImageCache = new Map()
const bilibiliImagePending = new Map()
let bilibiliImageCacheSize = 0
const bilibiliMetrics = {
  feedHits: 0,
  feedMisses: 0,
  feedCoalesced: 0,
  imageHits: 0,
  imageMisses: 0,
  imageCoalesced: 0,
  imageEvictions: 0,
}
const bilibiliApiHosts = new Set(['api.bilibili.com'])
const bilibiliImageHosts = new Set([
  'i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com',
  'archive.biliimg.com', 'article.biliimg.com', 'dynamic-pic.biliimg.com',
])
const wbiKeyCache = { expiresAt: 0, key: '' }
const wbiMixinTable = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

if (!isAdminPasswordHash(adminPasswordHash)) {
  throw new Error('ADMIN_PASSWORD_HASH must be a valid Argon2id hash.')
}
if (!allowedOrigins.size) {
  throw new Error('APP_ORIGIN is required in production.')
}
if (isProduction && [...allowedOrigins].some((origin) => !origin.startsWith('https://'))) {
  throw new Error('APP_ORIGIN must use HTTPS in production.')
}
if (!Number.isFinite(sessionIdleMs) || sessionIdleMs <= 0 || !Number.isFinite(sessionAbsoluteMs) || sessionAbsoluteMs <= 0) {
  throw new Error('Admin session durations must be positive numbers.')
}
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error('TRUST_PROXY_HOPS must be a non-negative integer.')
}

await mkdir(dataDir, { recursive: true })
await mkdir(uploadDir, { recursive: true })

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', trustProxyHops)
app.use((request, response, next) => {
  request.requestId = crypto.randomUUID()
  response.set('X-Request-Id', request.requestId)
  next()
})
app.use(express.json({ limit: '512kb' }))
app.use('/uploads', (_request, response) => response.status(404).json({ error: '资源不存在' }))

function positiveNumber(name, fallback) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`)
  return value
}

function positiveInteger(name, fallback) {
  const value = positiveNumber(name, fallback)
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`)
  return value
}

function stringArrayFromEnv(name, fallback) {
  const source = process.env[name]
  if (!source) return fallback
  let value
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error(`${name} must be a JSON string array.`)
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be a JSON string array.`)
  }
  return value
}

function decodeUploadFilename(value) {
  const filename = String(value || '')
  if (!/[\u0080-\u00ff]/.test(filename)) return filename
  const decoded = Buffer.from(filename, 'latin1').toString('utf8')
  return decoded.includes('\ufffd') ? filename : decoded
}

function resourceDownloadUrl(resource) {
  return `/api/resources/${encodeURIComponent(resource.id)}/download`
}

function serializeResource(resource) {
  const { storagePath: _storagePath, scanStatus: _scanStatus, ...publicResource } = resource
  return {
    ...publicResource,
    name: decodeUploadFilename(resource.name),
    downloadName: decodeUploadFilename(resource.downloadName),
    downloadUrl: resourceDownloadUrl(resource),
  }
}

function resourceStoragePath(resource) {
  const storedUrl = resource.storagePath || resource.downloadUrl || ''
  if (!storedUrl.startsWith('/uploads/')) return null
  return join(uploadDir, basename(storedUrl))
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_request, file, callback) => {
      const extension = extname(file.originalname).toLowerCase()
      callback(null, `${crypto.randomUUID()}${extension}`)
    },
  }),
  limits: {
    fileSize: uploadMaxFileBytes,
    fieldSize: 32 * 1024,
    fields: 4,
    files: 1,
    parts: 5,
  },
  fileFilter: (request, file, callback) => {
    file.originalname = decodeUploadFilename(file.originalname)
    try {
      request.uploadMetadata = validateUploadMetadata(file)
      callback(null, true)
    } catch (error) {
      callback(error)
    }
  },
})

async function uploadDirectorySize() {
  const entries = await readdir(uploadDir, { withFileTypes: true })
  const sizes = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    return (await stat(join(uploadDir, entry.name))).size
  }))
  return sizes.reduce((total, size) => total + size, 0)
}

async function scanUpload(filePath, extension) {
  if (!virusScanCommand) {
    if (requiresVirusScan(extension)) {
      throw new UploadSecurityError('scanner_unavailable', '压缩包安全扫描服务不可用', 503)
    }
    return 'not_required'
  }
  try {
    await execFileAsync(virusScanCommand, [...virusScanArgs, filePath], {
      timeout: virusScanTimeoutMs,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    })
    return 'clean'
  } catch (error) {
    if (error?.code === 1) throw new UploadSecurityError('malware_detected', '文件未通过安全扫描')
    throw new UploadSecurityError('scanner_unavailable', '文件安全扫描服务不可用', 503)
  }
}

async function withContentMutation(operation) {
  const previous = contentMutationQueue
  let release
  contentMutationQueue = new Promise((resolveQueue) => { release = resolveQueue })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

async function readContent() {
  const raw = await readFile(dataFile, 'utf8')
  return JSON.parse(raw)
}

async function saveContent(content) {
  const temporaryFile = `${dataFile}.tmp`
  await writeFile(temporaryFile, `${JSON.stringify(content, null, 2)}\n`, 'utf8')
  await rename(temporaryFile, dataFile)
}

function parseCookies(request) {
  const cookies = new Map()
  for (const part of String(request.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (name) cookies.set(name, value)
  }
  return cookies
}

function sessionCookieOptions(maxAge = sessionAbsoluteMs) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge,
  }
}

function clearSessionCookie(response) {
  response.clearCookie(sessionCookieName, sessionCookieOptions(0))
}

function removeExpiredSessions(now = Date.now()) {
  for (const [id, session] of adminSessions) {
    if (session.absoluteExpiresAt <= now || session.lastSeenAt + sessionIdleMs <= now) {
      adminSessions.delete(id)
    }
  }
}

function createAdminSession() {
  removeExpiredSessions()
  const now = Date.now()
  const id = crypto.randomBytes(32).toString('base64url')
  const session = {
    csrfToken: crypto.randomBytes(32).toString('base64url'),
    createdAt: now,
    lastSeenAt: now,
    absoluteExpiresAt: now + sessionAbsoluteMs,
  }
  adminSessions.set(id, session)
  return { id, session }
}

function authenticate(request, response, next) {
  const id = parseCookies(request).get(sessionCookieName) || ''
  const session = adminSessions.get(id)
  const now = Date.now()
  if (!session || session.absoluteExpiresAt <= now || session.lastSeenAt + sessionIdleMs <= now) {
    if (id) adminSessions.delete(id)
    clearSessionCookie(response)
    securityLog('admin_session_rejected', request, 'denied')
    return response.status(401).json({ error: '管理会话无效或已过期' })
  }
  session.lastSeenAt = now
  request.adminSession = session
  request.adminSessionId = id
  next()
}

function requireTrustedOrigin(request, response, next) {
  const origin = request.get('origin') || ''
  if (!allowedOrigins.has(origin)) {
    securityLog('admin_origin_rejected', request, 'denied')
    return response.status(403).json({ error: '请求被拒绝' })
  }
  next()
}

function requireCsrf(request, response, next) {
  const supplied = Buffer.from(request.get('x-csrf-token') || '')
  const expected = Buffer.from(request.adminSession?.csrfToken || '')
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    securityLog('admin_csrf_rejected', request, 'denied')
    return response.status(403).json({ error: '请求被拒绝' })
  }
  next()
}

function securityLog(event, request, outcome, details = {}) {
  console.log(JSON.stringify({
    level: 'security',
    time: new Date().toISOString(),
    event,
    outcome,
    requestId: request.requestId,
    ip: request.ip || request.socket.remoteAddress || 'unknown',
    method: request.method,
    path: request.path,
    ...details,
  }))
}

function sendRateLimited(request, response, event, retryAfterSeconds = 60) {
  securityLog(event, request, 'rate_limited')
  response.set('Retry-After', String(Math.max(1, Math.ceil(retryAfterSeconds))))
  response.status(429).json({ error: '请求过于频繁，请稍后重试' })
}

function currentLoginFailure(request) {
  const key = request.ip || request.socket.remoteAddress || 'unknown'
  const failure = loginFailures.get(key)
  if (!failure) return null
  if (failure.lastFailureAt + loginWindowMs <= Date.now()) {
    loginFailures.delete(key)
    return null
  }
  return failure
}

function enforceLoginBackoff(request, response, next) {
  const failure = currentLoginFailure(request)
  if (failure?.blockedUntil > Date.now()) {
    return sendRateLimited(request, response, 'admin_login_backoff', (failure.blockedUntil - Date.now()) / 1000)
  }
  next()
}

function recordLoginFailure(request) {
  const key = request.ip || request.socket.remoteAddress || 'unknown'
  const previous = currentLoginFailure(request)
  const count = (previous?.count || 0) + 1
  const delay = Math.min(loginBackoffBaseMs * (2 ** Math.min(count - 1, 16)), loginBackoffMaxMs)
  if (previous) loginFailures.delete(key)
  while (loginFailures.size >= loginFailureLimit) {
    loginFailures.delete(loginFailures.keys().next().value)
  }
  loginFailures.set(key, {
    count,
    lastFailureAt: Date.now(),
    blockedUntil: Date.now() + delay,
  })
  return { count, delay }
}

function limitLoginConcurrency(request, response, next) {
  if (activeLoginAttempts >= loginConcurrency) {
    return sendRateLimited(request, response, 'admin_login_concurrency', 1)
  }

  activeLoginAttempts += 1
  let released = false
  const release = () => {
    if (released) return
    released = true
    activeLoginAttempts = Math.max(0, activeLoginAttempts - 1)
  }
  response.once('finish', release)
  response.once('close', release)
  next()
}

function clearLoginFailures(request) {
  loginFailures.delete(request.ip || request.socket.remoteAddress || 'unknown')
}

function limitAdminWriteConcurrency(request, response, next) {
  const key = request.adminSessionId
  const active = activeAdminWrites.get(key) || 0
  if (active >= adminWriteConcurrency) {
    return sendRateLimited(request, response, 'admin_write_concurrency', 1)
  }

  activeAdminWrites.set(key, active + 1)
  let released = false
  const release = () => {
    if (released) return
    released = true
    const remaining = (activeAdminWrites.get(key) || 1) - 1
    if (remaining > 0) activeAdminWrites.set(key, remaining)
    else activeAdminWrites.delete(key)
  }
  response.once('finish', release)
  response.once('close', release)
  next()
}

function limitUploadConcurrency(request, response, next) {
  if (activeUploads >= uploadConcurrency) {
    return sendRateLimited(request, response, 'admin_upload_concurrency', 1)
  }

  activeUploads += 1
  let released = false
  const release = () => {
    if (released) return
    released = true
    activeUploads = Math.max(0, activeUploads - 1)
  }
  response.once('finish', release)
  response.once('close', release)
  next()
}

function publicConcurrencyLimiter(bucket, limit, event) {
  return (request, response, next) => {
    const active = activePublicRequests.get(bucket) || 0
    if (active >= limit) return sendRateLimited(request, response, event, 1)

    activePublicRequests.set(bucket, active + 1)
    let released = false
    const release = () => {
      if (released) return
      released = true
      const remaining = (activePublicRequests.get(bucket) || 1) - 1
      if (remaining > 0) activePublicRequests.set(bucket, remaining)
      else activePublicRequests.delete(bucket)
    }
    response.once('finish', release)
    response.once('close', release)
    next()
  }
}

const loginIpLimiter = rateLimit({
  windowMs: loginWindowMs,
  limit: loginIpLimit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (request, response) => sendRateLimited(request, response, 'admin_login_ip_limit', loginWindowMs / 1000),
})

const loginAccountLimiter = rateLimit({
  windowMs: loginWindowMs,
  limit: loginAccountLimit,
  keyGenerator: () => 'admin-account',
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (request, response) => sendRateLimited(request, response, 'admin_login_account_limit', loginWindowMs / 1000),
})

const adminWriteLimiter = rateLimit({
  windowMs: adminWriteWindowMs,
  limit: adminWriteLimit,
  keyGenerator: (request) => request.adminSessionId,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (request, response) => sendRateLimited(request, response, 'admin_write_rate_limit', adminWriteWindowMs / 1000),
})

const uploadRateLimiter = rateLimit({
  windowMs: uploadWindowMs,
  limit: uploadLimit,
  keyGenerator: () => 'admin-account',
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (request, response) => sendRateLimited(request, response, 'admin_upload_rate_limit', uploadWindowMs / 1000),
})

function publicRateLimiter(limit, event) {
  return rateLimit({
    windowMs: publicRateWindowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (request, response) => sendRateLimited(request, response, event, publicRateWindowMs / 1000),
  })
}

const bilibiliFeedLimiter = publicRateLimiter(bilibiliFeedRateLimit, 'bilibili_feed_rate_limit')
const bilibiliImageLimiter = publicRateLimiter(bilibiliImageRateLimit, 'bilibili_image_rate_limit')
const bilibiliCacheStatsLimiter = publicRateLimiter(30, 'bilibili_cache_stats_rate_limit')
const resourceDownloadLimiter = publicRateLimiter(resourceDownloadRateLimit, 'resource_download_rate_limit')
const limitBilibiliFeedConcurrency = publicConcurrencyLimiter('bilibili-feed', bilibiliFeedConcurrency, 'bilibili_feed_concurrency')
const limitBilibiliImageConcurrency = publicConcurrencyLimiter('bilibili-image', bilibiliImageConcurrency, 'bilibili_image_concurrency')
const limitResourceDownloadConcurrency = publicConcurrencyLimiter('resource-download', resourceDownloadConcurrency, 'resource_download_concurrency')

function normalizeArticle(input, existing = {}) {
  const now = new Date().toISOString()
  return {
    ...existing,
    id: existing.id || crypto.randomUUID(),
    title: String(input.title || '').trim(),
    type: String(input.type || '创作手记').trim(),
    date: String(input.date || now.slice(0, 10)).trim(),
    excerpt: String(input.excerpt || '').trim(),
    readTime: String(input.readTime || '5 分钟').trim(),
    color: String(input.color || '#df4f3b').trim(),
    image: String(input.image || '/images/anti-utopia-1600.webp').trim(),
    markdown: String(input.markdown || '').trim(),
    status: input.status === 'published' ? 'published' : 'draft',
    createdAt: existing.createdAt || now,
    updatedAt: now,
  }
}

function normalizeDynamicText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function bilibiliHeaders() {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Referer: `https://space.bilibili.com/${bilibiliUid}`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
  }
  if (bilibiliCookie) headers.Cookie = bilibiliCookie
  return headers
}

function parseBilibiliImageUrl(value) {
  return validateUpstreamUrl(value, bilibiliImageHosts)
}

function optimizedBilibiliImageUrl(value) {
  const url = parseBilibiliImageUrl(value)
  if (url.pathname.startsWith('/bfs/archive/') && !/@\d+w_\d+h_/.test(url.pathname)) {
    url.pathname = `${url.pathname}@960w_540h_1c.webp`
  }
  return url
}

function getCachedBilibiliImage(key) {
  const entry = bilibiliImageCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    bilibiliImageCache.delete(key)
    bilibiliImageCacheSize -= entry.body.length
    return null
  }
  bilibiliImageCache.delete(key)
  bilibiliImageCache.set(key, entry)
  return entry
}

function cacheBilibiliImage(key, entry) {
  if (entry.body.length > bilibiliImageCacheLimit) return
  while (bilibiliImageCache.size >= bilibiliImageCacheEntries || bilibiliImageCacheSize + entry.body.length > bilibiliImageCacheLimit) {
    const oldestKey = bilibiliImageCache.keys().next().value
    const oldest = bilibiliImageCache.get(oldestKey)
    bilibiliImageCache.delete(oldestKey)
    bilibiliImageCacheSize -= oldest.body.length
    bilibiliMetrics.imageEvictions += 1
  }
  bilibiliImageCache.set(key, entry)
  bilibiliImageCacheSize += entry.body.length
}

function sendBilibiliImage(response, image, cacheStatus) {
  response.set({
    'Cache-Control': 'public, max-age=604800, immutable, stale-while-revalidate=2592000',
    'Content-Type': image.contentType,
    'Content-Length': image.body.length,
    'X-Content-Type-Options': 'nosniff',
    'X-Image-Cache': cacheStatus,
  })
  response.send(image.body)
}

function proxiedBilibiliImageUrl(value) {
  if (!value) return ''
  const url = parseBilibiliImageUrl(value)
  return `/api/bilibili/image?url=${encodeURIComponent(url.href)}`
}

async function fetchBilibiliJson(url) {
  const response = await fetchUpstreamBuffer(url, {
    allowedHosts: bilibiliApiHosts,
    headers: bilibiliHeaders(),
    maxBytes: bilibiliJsonMaxBytes,
    maxRedirects: bilibiliRedirectLimit,
    timeoutMs: bilibiliUpstreamTimeoutMs,
  })
  const contentType = String(response.headers['content-type'] || '')
  if (response.status < 200 || response.status >= 300 || !contentType.includes('application/json')) {
    throw new UpstreamSecurityError('bilibili_json_invalid')
  }

  let data
  try {
    data = JSON.parse(response.body.toString('utf8'))
  } catch {
    throw new UpstreamSecurityError('bilibili_json_invalid')
  }
  if (data.code !== 0) throw new UpstreamSecurityError('bilibili_api_rejected')
  return data
}

function formatBilibiliDate(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Number(timestamp) * 1000)).replaceAll('/', '-')
}

function formatBilibiliCount(value) {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact', maximumFractionDigits: 1,
  }).format(Number(value) || 0)
}

function wbiKeyFromUrl(url) {
  return new URL(url).pathname.split('/').pop().split('.')[0]
}

async function getWbiMixinKey() {
  if (wbiKeyCache.key && wbiKeyCache.expiresAt > Date.now()) return wbiKeyCache.key
  const data = await fetchBilibiliJson('https://api.bilibili.com/x/web-interface/nav')
  if (!data.data?.wbi_img?.img_url || !data.data?.wbi_img?.sub_url) {
    throw new UpstreamSecurityError('bilibili_wbi_key_invalid')
  }
  const rawKey = `${wbiKeyFromUrl(data.data.wbi_img.img_url)}${wbiKeyFromUrl(data.data.wbi_img.sub_url)}`
  const key = wbiMixinTable.map((index) => rawKey[index]).join('').slice(0, 32)
  wbiKeyCache.key = key
  wbiKeyCache.expiresAt = Date.now() + 60 * 60 * 1000
  return key
}

async function createWbiUrl(endpoint, input) {
  const params = { ...input, wts: Math.floor(Date.now() / 1000) }
  const query = Object.keys(params).sort().map((key) => {
    const value = String(params[key]).replace(/[!'()*]/g, '')
    return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
  }).join('&')
  const signature = crypto.createHash('md5').update(`${query}${await getWbiMixinKey()}`).digest('hex')
  return `${endpoint}?${query}&w_rid=${signature}`
}

function extractBilibiliDynamic(item) {
  const module = item.modules?.module_dynamic || {}
  const originalModule = item.orig?.modules?.module_dynamic || {}
  const description = module.desc || originalModule.desc
  const major = module.major || originalModule.major || {}
  const richNodes = description?.rich_text_nodes || major.opus?.summary?.rich_text_nodes || []
  const text = normalizeDynamicText(
    description?.text
      || major.opus?.summary?.text
      || major.archive?.title
      || major.article?.title
      || major.draw?.items?.[0]?.description,
  )

  if (!text) return null

  const topic = richNodes.find((node) => node.type === 'RICH_TEXT_NODE_TYPE_TOPIC')?.text
    || (major.archive ? '#视频投稿' : '#B站动态')
  const timestamp = Number(item.modules?.module_author?.pub_ts)
  const time = Number.isFinite(timestamp)
    ? formatBilibiliDate(timestamp)
    : normalizeDynamicText(item.modules?.module_author?.pub_time)

  return {
    id: String(item.id_str || item.id || crypto.randomUUID()),
    time,
    text: text.length > 180 ? `${text.slice(0, 177)}...` : text,
    topic,
  }
}

async function fetchBilibiliDynamics() {
  const url = new URL('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space')
  url.searchParams.set('host_mid', bilibiliUid)
  const data = await fetchBilibiliJson(url)
  if (!Array.isArray(data.data?.items)) throw new Error('Bilibili dynamic response is invalid')

  return data.data.items.map(extractBilibiliDynamic).filter(Boolean).slice(0, 3)
}

async function fetchBilibiliVideos() {
  const url = await createWbiUrl('https://api.bilibili.com/x/space/wbi/arc/search', {
    mid: bilibiliUid,
    order: 'pubdate',
    pn: 1,
    ps: 30,
  })
  const data = await fetchBilibiliJson(url)
  const list = data.data?.list?.vlist
  if (!Array.isArray(list)) throw new Error('Bilibili video response is invalid')

  return list.map((video) => ({
    id: video.bvid,
    title: normalizeDynamicText(video.title),
    stats: `${formatBilibiliCount(video.play)}播放 · ${formatBilibiliCount(video.video_review)}弹幕`,
    date: formatBilibiliDate(video.created),
    cover: proxiedBilibiliImageUrl(String(video.pic || '').replace(/^http:/, 'https:').replace(/^\/\//, 'https://')),
    duration: video.length || '',
  })).filter((video) => video.id && video.title && video.cover)
}

function upstreamErrorCode(error) {
  return typeof error?.code === 'string' ? error.code : 'unexpected_upstream_error'
}

function logUpstreamFailure(event, error) {
  console.error(JSON.stringify({
    level: 'upstream',
    time: new Date().toISOString(),
    event,
    outcome: 'failed',
    reason: upstreamErrorCode(error),
  }))
}

async function fetchBilibiliImage(imageUrl) {
  const upstream = await fetchUpstreamBuffer(imageUrl, {
    allowedHosts: bilibiliImageHosts,
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: 'https://www.bilibili.com/',
      'User-Agent': bilibiliHeaders()['User-Agent'],
    },
    maxBytes: bilibiliImageMaxBytes,
    maxRedirects: bilibiliRedirectLimit,
    timeoutMs: bilibiliUpstreamTimeoutMs,
  })
  const contentType = String(upstream.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase()
  const allowedContentTypes = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp'])
  if (upstream.status < 200 || upstream.status >= 300 || !allowedContentTypes.has(contentType)) {
    throw new UpstreamSecurityError('bilibili_image_invalid')
  }
  return { body: upstream.body, contentType, expiresAt: Date.now() + 6 * 60 * 60 * 1000 }
}

async function refreshBilibiliFeed() {
  const [videoResult, dynamicResult] = await Promise.allSettled([
    fetchBilibiliVideos(),
    fetchBilibiliDynamics(),
  ])
  const videoUnavailable = videoResult.status === 'rejected'
  const dynamicUnavailable = dynamicResult.status === 'rejected'
  if (videoUnavailable) logUpstreamFailure('bilibili_video_sync', videoResult.reason)
  if (dynamicUnavailable) logUpstreamFailure('bilibili_dynamic_sync', dynamicResult.reason)
  const videoStale = videoUnavailable && Boolean(bilibiliCache.payload?.videos?.length)
  const dynamicStale = dynamicUnavailable && Boolean(bilibiliCache.payload?.dynamics?.length)

  const payload = {
    syncedAt: new Date().toISOString(),
    videos: videoStale ? bilibiliCache.payload.videos : videoUnavailable ? [] : videoResult.value,
    dynamics: dynamicStale ? bilibiliCache.payload.dynamics : dynamicUnavailable ? [] : dynamicResult.value,
    videoUnavailable,
    dynamicUnavailable,
    videoStale,
    dynamicStale,
    unavailable: videoUnavailable && dynamicUnavailable && !videoStale && !dynamicStale,
  }
  bilibiliCache.payload = payload
  bilibiliCache.expiresAt = Date.now() + 10 * 60 * 1000
  return payload
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/bilibili/image', bilibiliImageLimiter, limitBilibiliImageConcurrency, async (request, response) => {
  try {
    const imageUrl = optimizedBilibiliImageUrl(request.query.url)
    const cached = getCachedBilibiliImage(imageUrl.href)
    if (cached) {
      bilibiliMetrics.imageHits += 1
      return sendBilibiliImage(response, cached, 'HIT')
    }

    let pending = bilibiliImagePending.get(imageUrl.href)
    let cacheStatus = 'COALESCED'
    if (pending) {
      bilibiliMetrics.imageCoalesced += 1
    } else {
      bilibiliMetrics.imageMisses += 1
      cacheStatus = 'MISS'
      pending = fetchBilibiliImage(imageUrl).then((image) => {
        cacheBilibiliImage(imageUrl.href, image)
        return image
      })
      bilibiliImagePending.set(imageUrl.href, pending)
    }
    try {
      sendBilibiliImage(response, await pending, cacheStatus)
    } finally {
      if (bilibiliImagePending.get(imageUrl.href) === pending) bilibiliImagePending.delete(imageUrl.href)
    }
  } catch (error) {
    securityLog('bilibili_image_proxy', request, 'failed', { reason: upstreamErrorCode(error) })
    const invalidRequest = ['invalid_upstream_url', 'upstream_address_blocked'].includes(error?.code)
    response.status(invalidRequest ? 400 : 502).json({ error: invalidRequest ? '图片地址无效' : 'Bilibili 图片暂不可用' })
  }
})

app.get('/api/bilibili/feed', bilibiliFeedLimiter, limitBilibiliFeedConcurrency, async (request, response) => {
  const now = Date.now()
  if (bilibiliCache.payload && bilibiliCache.expiresAt > now) {
    bilibiliMetrics.feedHits += 1
    response.set('X-Feed-Cache', 'HIT')
    return response.json(bilibiliCache.payload)
  }

  try {
    let cacheStatus = 'COALESCED'
    if (bilibiliFeedPending) {
      bilibiliMetrics.feedCoalesced += 1
    } else {
      bilibiliMetrics.feedMisses += 1
      cacheStatus = 'MISS'
      bilibiliFeedPending = refreshBilibiliFeed()
    }
    response.set('X-Feed-Cache', cacheStatus)
    response.json(await bilibiliFeedPending)
  } catch (error) {
    securityLog('bilibili_feed', request, 'failed', { reason: upstreamErrorCode(error) })
    if (bilibiliCache.payload) return response.json({ ...bilibiliCache.payload, stale: true })
    response.json({
      syncedAt: null,
      videos: [],
      dynamics: [],
      videoUnavailable: true,
      dynamicUnavailable: true,
      unavailable: true,
    })
  } finally {
    bilibiliFeedPending = null
  }
})

app.get('/api/bilibili/cache-stats', bilibiliCacheStatsLimiter, (request, response) => {
  securityLog('bilibili_cache_stats', request, 'succeeded')
  response.json({
    feed: {
      hits: bilibiliMetrics.feedHits,
      misses: bilibiliMetrics.feedMisses,
      coalesced: bilibiliMetrics.feedCoalesced,
      cached: Boolean(bilibiliCache.payload && bilibiliCache.expiresAt > Date.now()),
    },
    images: {
      hits: bilibiliMetrics.imageHits,
      misses: bilibiliMetrics.imageMisses,
      coalesced: bilibiliMetrics.imageCoalesced,
      evictions: bilibiliMetrics.imageEvictions,
      entries: bilibiliImageCache.size,
      bytes: bilibiliImageCacheSize,
      maxBytes: bilibiliImageCacheLimit,
      maxEntries: bilibiliImageCacheEntries,
    },
  })
})

app.get('/api/resources/:id/download', resourceDownloadLimiter, limitResourceDownloadConcurrency, async (request, response, next) => {
  try {
    const content = await readContent()
    const resource = content.resources.find((item) => item.id === request.params.id)
    const filePath = resource && resourceStoragePath(resource)
    if (!resource || !filePath) return response.status(404).json({ error: '资源不存在' })
    const fileStats = await stat(filePath)
    if (fileStats.size > resourceDownloadMaxBytes) {
      return response.status(413).json({ error: '资源文件超过下载限制' })
    }

    const downloadName = basename(decodeUploadFilename(resource.downloadName) || 'download')
    const extension = extname(downloadName).toLowerCase()
    const downloadTimer = setTimeout(() => {
      if (!response.writableEnded) response.destroy()
    }, resourceDownloadTimeoutMs)
    downloadTimer.unref()
    const clearDownloadTimer = () => clearTimeout(downloadTimer)
    response.once('finish', clearDownloadTimer)
    response.once('close', clearDownloadTimer)
    response.download(filePath, downloadName, {
      headers: {
        'Content-Type': resource.mime || uploadContentType(extension),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
      },
    }, (error) => {
      if (error && !response.headersSent) next(error)
    })
  } catch (error) {
    if (error?.code === 'ENOENT') return response.status(404).json({ error: '资源不存在' })
    next(error)
  }
})

app.get('/api/content', async (_request, response, next) => {
  try {
    const content = await readContent()
    response.json({
      articles: content.articles.filter((article) => article.status === 'published'),
      resources: content.resources.map(serializeResource),
    })
  } catch (error) {
    next(error)
  }
})

app.use('/api/admin', (_request, response, next) => {
  response.set('Cache-Control', 'no-store')
  next()
})

app.post('/api/admin/auth/login', requireTrustedOrigin, loginIpLimiter, loginAccountLimiter, enforceLoginBackoff, limitLoginConcurrency, async (request, response, next) => {
  try {
    const password = typeof request.body?.password === 'string' ? request.body.password : ''
    if (!await verifyAdminPassword(adminPasswordHash, password)) {
      const failure = recordLoginFailure(request)
      securityLog('admin_login', request, 'failed', { attempts: failure.count, backoffMs: failure.delay })
      response.set('Retry-After', String(Math.max(1, Math.ceil(failure.delay / 1000))))
      return response.status(401).json({ error: '登录失败' })
    }

    clearLoginFailures(request)
    const previousSessionId = parseCookies(request).get(sessionCookieName)
    if (previousSessionId) adminSessions.delete(previousSessionId)
    const { id, session } = createAdminSession()
    response.cookie(sessionCookieName, id, sessionCookieOptions())
    securityLog('admin_login', request, 'succeeded')
    response.json({ authenticated: true, csrfToken: session.csrfToken })
  } catch (error) {
    next(error)
  }
})

app.get('/api/admin/auth/session', (request, response) => {
  const id = parseCookies(request).get(sessionCookieName) || ''
  const session = adminSessions.get(id)
  const now = Date.now()
  if (!session || session.absoluteExpiresAt <= now || session.lastSeenAt + sessionIdleMs <= now) {
    if (id) adminSessions.delete(id)
    clearSessionCookie(response)
    return response.json({ authenticated: false })
  }

  session.lastSeenAt = now
  response.json({ authenticated: true, csrfToken: session.csrfToken })
})

app.post('/api/admin/auth/logout', requireTrustedOrigin, authenticate, requireCsrf, (request, response) => {
  adminSessions.delete(request.adminSessionId)
  clearSessionCookie(response)
  securityLog('admin_logout', request, 'succeeded')
  response.status(204).end()
})

app.post('/api/admin/auth/revoke-all', requireTrustedOrigin, authenticate, requireCsrf, (_request, response) => {
  adminSessions.clear()
  clearSessionCookie(response)
  securityLog('admin_sessions_revoke_all', _request, 'succeeded')
  response.status(204).end()
})

const protectAdminWrite = [
  requireTrustedOrigin,
  authenticate,
  requireCsrf,
  adminWriteLimiter,
  limitAdminWriteConcurrency,
]

app.get('/api/admin/content', authenticate, async (_request, response, next) => {
  try {
    const content = await readContent()
    response.json({ ...content, resources: content.resources.map(serializeResource) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin/articles', ...protectAdminWrite, async (request, response, next) => {
  try {
    const article = normalizeArticle(request.body)
    if (!article.title || !article.markdown) {
      return response.status(400).json({ error: '标题和 Markdown 正文不能为空' })
    }
    await withContentMutation(async () => {
      const content = await readContent()
      content.articles.unshift(article)
      await saveContent(content)
    })
    response.status(201).json(article)
  } catch (error) {
    next(error)
  }
})

app.put('/api/admin/articles/:id', ...protectAdminWrite, async (request, response, next) => {
  try {
    const result = await withContentMutation(async () => {
      const content = await readContent()
      const index = content.articles.findIndex((item) => item.id === request.params.id)
      if (index === -1) return { status: 'missing' }
      const nextArticle = normalizeArticle(request.body, content.articles[index])
      if (!nextArticle.title || !nextArticle.markdown) {
        return { status: 'invalid' }
      }
      content.articles[index] = nextArticle
      await saveContent(content)
      return { status: 'saved', article: nextArticle }
    })
    if (result.status === 'missing') return response.status(404).json({ error: '文章不存在' })
    if (result.status === 'invalid') return response.status(400).json({ error: '标题和 Markdown 正文不能为空' })
    response.json(result.article)
  } catch (error) {
    next(error)
  }
})

app.delete('/api/admin/articles/:id', ...protectAdminWrite, async (request, response, next) => {
  try {
    const deleted = await withContentMutation(async () => {
      const content = await readContent()
      const nextArticles = content.articles.filter((article) => article.id !== request.params.id)
      if (nextArticles.length === content.articles.length) return false
      content.articles = nextArticles
      await saveContent(content)
      return true
    })
    if (!deleted) return response.status(404).json({ error: '文章不存在' })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin/resources', ...protectAdminWrite, uploadRateLimiter, limitUploadConcurrency, upload.single('file'), async (request, response, next) => {
  try {
    if (!request.file) return response.status(400).json({ error: '请选择上传文件' })
    const { extension } = request.uploadMetadata
    await inspectUpload(request.file.path, extension, archiveLimits)
    const scanStatus = await scanUpload(request.file.path, extension)
    const now = new Date().toISOString()
    const resource = {
      id: crypto.randomUUID(),
      name: String(request.body.name || request.file.originalname).trim(),
      meta: String(request.body.meta || `${Math.ceil(request.file.size / 1024)} KB`).trim(),
      tag: String(request.body.tag || '二创资源').trim(),
      storagePath: `/uploads/${request.file.filename}`,
      downloadName: request.file.originalname,
      size: request.file.size,
      mime: uploadContentType(extension),
      scanStatus,
      createdAt: now,
    }
    await withContentMutation(async () => {
      if (await uploadDirectorySize() > uploadTotalQuotaBytes) {
        throw new UploadSecurityError('storage_quota_exceeded', '资源存储空间已满', 413)
      }
      const content = await readContent()
      content.resources.unshift(resource)
      await saveContent(content)
    })
    securityLog('admin_resource_upload', request, 'succeeded', {
      resourceId: resource.id,
      extension,
      size: resource.size,
      scanStatus,
    })
    response.status(201).json(serializeResource(resource))
  } catch (error) {
    if (request.file) await unlink(request.file.path).catch(() => {})
    next(error)
  }
})

app.delete('/api/admin/resources/:id', ...protectAdminWrite, async (request, response, next) => {
  try {
    const result = await withContentMutation(async () => {
      const content = await readContent()
      const resource = content.resources.find((item) => item.id === request.params.id)
      if (!resource) return null

      const filePath = resourceStoragePath(resource)
      const quarantinedPath = filePath ? `${filePath}.deleting-${crypto.randomUUID()}` : null
      let quarantined = false
      if (filePath) {
        try {
          await rename(filePath, quarantinedPath)
          quarantined = true
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
      }

      content.resources = content.resources.filter((item) => item.id !== request.params.id)
      try {
        await saveContent(content)
      } catch (error) {
        if (quarantined) await rename(quarantinedPath, filePath).catch(() => {})
        throw error
      }

      if (quarantined) {
        await unlink(quarantinedPath).catch(() => {
          securityLog('admin_resource_delete_cleanup', request, 'failed', { resourceId: resource.id })
        })
      }
      return { resource, fileState: quarantined ? 'deleted' : 'missing' }
    })
    if (!result) return response.status(404).json({ error: '资源不存在' })
    securityLog('admin_resource_delete', request, 'succeeded', {
      resourceId: result.resource.id,
      fileState: result.fileState,
    })
    response.status(204).end()
  } catch (error) {
    securityLog('admin_resource_delete', request, 'failed', { resourceId: request.params.id })
    next(error)
  }
})

app.use('/api', (_request, response) => {
  response.status(404).json({ error: '接口不存在' })
})

app.use((error, request, response, _next) => {
  if (error instanceof UploadSecurityError) {
    if (request.file?.path) unlink(request.file.path).catch(() => {})
    securityLog('admin_resource_upload', request, 'rejected', { reason: error.code })
    return response.status(error.status).json({ error: error.clientMessage })
  }
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    securityLog('admin_resource_upload', request, 'rejected', { reason: error.code })
    return response.status(status).json({ error: status === 413 ? '上传文件超过限制' : '上传请求无效' })
  }

  console.error(JSON.stringify({
    level: 'error',
    time: new Date().toISOString(),
    requestId: request.requestId,
    name: error.name,
  }))

  if (error?.type === 'entity.too.large') {
    return response.status(413).json({ error: '请求内容超过限制' })
  }
  if (error instanceof SyntaxError && error?.status === 400 && 'body' in error) {
    return response.status(400).json({ error: '请求格式无效' })
  }
  response.status(500).json({ error: '服务器错误' })
})

if (existsSync(distDir)) {
  app.use('/assets', express.static(join(distDir, 'assets'), { immutable: true, maxAge: isProduction ? '1y' : 0 }))
  app.use(express.static(distDir, { index: false, maxAge: isProduction ? '1h' : 0 }))
  app.get('*', (_request, response) => response.sendFile(join(distDir, 'index.html')))
}

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Content server: http://127.0.0.1:${port}`)
  if (!isProduction) console.log('Development admin password: utopia-dev')
})

server.headersTimeout = serverHeadersTimeoutMs
server.requestTimeout = serverRequestTimeoutMs
server.keepAliveTimeout = 5000
server.maxRequestsPerSocket = 100
