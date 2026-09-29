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
import { createSecurityMonitor } from './security/audit.js'
import {
  ContentValidationError,
  createArticleInputSchema,
  parseContent,
  parseInput,
  parseServerEnv,
  resourceInputSchema,
} from './security/validation.js'
import {
  UploadSecurityError,
  inspectUpload,
  requiresVirusScan,
  uploadContentType,
  validateUploadMetadata,
} from './security/upload.js'
import { UpstreamSecurityError, fetchUpstreamBuffer, postSecureWebhook, validateUpstreamUrl } from './security/upstream.js'

const execFileAsync = promisify(execFile)

const rootDir = resolve(import.meta.dirname, '..')
const envFile = join(rootDir, '.env')
if (existsSync(envFile)) loadEnvFile(envFile)
const rawProduction = process.env.NODE_ENV === 'production'
const env = parseServerEnv({
  ...process.env,
  APP_ORIGIN: process.env.APP_ORIGIN || (rawProduction
    ? ''
    : 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8787,http://localhost:8787'),
  TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS || (rawProduction ? '1' : '0'),
})
const storageRoot = env.APP_STORAGE_ROOT ? resolve(env.APP_STORAGE_ROOT) : join(rootDir, 'server')
const dataDir = join(storageRoot, 'data')
const dataFile = join(dataDir, 'content.json')
const uploadDir = join(storageRoot, 'uploads')
const distDir = join(rootDir, 'dist')
const port = env.PORT
const isProduction = env.NODE_ENV === 'production'
const adminPasswordHash = env.ADMIN_PASSWORD_HASH || (isProduction ? '' : await hashAdminPassword('utopia-dev'))
const allowedOrigins = new Set(env.APP_ORIGIN)
const articleImageHosts = new Set(env.ARTICLE_IMAGE_HOSTS)
const articleInputSchema = createArticleInputSchema(articleImageHosts)
const sessionIdleMs = env.ADMIN_SESSION_IDLE_MINUTES * 60 * 1000
const sessionAbsoluteMs = env.ADMIN_SESSION_ABSOLUTE_HOURS * 60 * 60 * 1000
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
const trustProxyHops = env.TRUST_PROXY_HOPS
const loginWindowMs = env.ADMIN_LOGIN_WINDOW_MINUTES * 60 * 1000
const loginIpLimit = env.ADMIN_LOGIN_IP_LIMIT
const loginAccountLimit = env.ADMIN_LOGIN_ACCOUNT_LIMIT
const loginBackoffBaseMs = env.ADMIN_LOGIN_BACKOFF_BASE_MS
const loginBackoffMaxMs = env.ADMIN_LOGIN_BACKOFF_MAX_MS
const loginConcurrency = env.ADMIN_LOGIN_CONCURRENCY
const adminWriteWindowMs = env.ADMIN_WRITE_WINDOW_MINUTES * 60 * 1000
const adminWriteLimit = env.ADMIN_WRITE_LIMIT
const adminWriteConcurrency = env.ADMIN_WRITE_CONCURRENCY
const uploadWindowMs = env.UPLOAD_WINDOW_MINUTES * 60 * 1000
const uploadLimit = env.UPLOAD_LIMIT
const uploadConcurrency = env.UPLOAD_CONCURRENCY
const uploadMaxFileBytes = Math.floor(env.UPLOAD_MAX_FILE_MB * 1024 * 1024)
const uploadTotalQuotaBytes = Math.floor(env.UPLOAD_TOTAL_QUOTA_MB * 1024 * 1024)
const archiveLimits = {
  maxUncompressedBytes: Math.floor(env.UPLOAD_ARCHIVE_MAX_UNCOMPRESSED_MB * 1024 * 1024),
  maxFiles: env.UPLOAD_ARCHIVE_MAX_FILES,
  maxDepth: env.UPLOAD_ARCHIVE_MAX_DEPTH,
  maxCompressionRatio: env.UPLOAD_ARCHIVE_MAX_RATIO,
}
const virusScanCommand = env.UPLOAD_VIRUS_SCAN_COMMAND.trim()
const virusScanArgs = env.UPLOAD_VIRUS_SCAN_ARGS
const virusScanTimeoutMs = env.UPLOAD_SCAN_TIMEOUT_SECONDS * 1000
const publicRateWindowMs = env.PUBLIC_RATE_WINDOW_MINUTES * 60 * 1000
const bilibiliFeedRateLimit = env.BILIBILI_FEED_RATE_LIMIT
const bilibiliImageRateLimit = env.BILIBILI_IMAGE_RATE_LIMIT
const resourceDownloadRateLimit = env.RESOURCE_DOWNLOAD_RATE_LIMIT
const bilibiliFeedConcurrency = env.BILIBILI_FEED_CONCURRENCY
const bilibiliImageConcurrency = env.BILIBILI_IMAGE_CONCURRENCY
const resourceDownloadConcurrency = env.RESOURCE_DOWNLOAD_CONCURRENCY
const bilibiliUpstreamTimeoutMs = env.BILIBILI_UPSTREAM_TIMEOUT_SECONDS * 1000
const bilibiliJsonMaxBytes = Math.floor(env.BILIBILI_JSON_MAX_MB * 1024 * 1024)
const bilibiliImageMaxBytes = Math.floor(env.BILIBILI_IMAGE_MAX_MB * 1024 * 1024)
const bilibiliRedirectLimit = env.BILIBILI_REDIRECT_LIMIT
const bilibiliImageCacheLimit = Math.floor(env.BILIBILI_IMAGE_CACHE_MB * 1024 * 1024)
const bilibiliImageCacheEntries = env.BILIBILI_IMAGE_CACHE_ENTRIES
const resourceDownloadMaxBytes = Math.floor(env.RESOURCE_DOWNLOAD_MAX_MB * 1024 * 1024)
const resourceDownloadTimeoutMs = env.RESOURCE_DOWNLOAD_TIMEOUT_SECONDS * 1000
const serverHeadersTimeoutMs = env.SERVER_HEADERS_TIMEOUT_SECONDS * 1000
const serverRequestTimeoutMs = env.SERVER_REQUEST_TIMEOUT_SECONDS * 1000
const bilibiliUid = env.BILIBILI_UID
const bilibiliCookie = env.BILIBILI_COOKIE
const securityIpKey = env.SECURITY_LOG_IP_KEY || (isProduction ? '' : crypto.randomBytes(32).toString('hex'))
const securityWebhookHosts = new Set(env.SECURITY_ALERT_WEBHOOK_HOSTS)
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
if (loginBackoffMaxMs < loginBackoffBaseMs) throw new Error('ADMIN_LOGIN_BACKOFF_MAX_MS 不能小于 ADMIN_LOGIN_BACKOFF_BASE_MS。')
if (isProduction && securityIpKey.length < 32) {
  throw new Error('SECURITY_LOG_IP_KEY must contain at least 32 characters in production.')
}
if (env.SECURITY_ALERT_WEBHOOK_URL) {
  if (!securityWebhookHosts.size) throw new Error('SECURITY_ALERT_WEBHOOK_HOSTS is required when a webhook is configured.')
  validateUpstreamUrl(env.SECURITY_ALERT_WEBHOOK_URL, securityWebhookHosts)
}

await mkdir(dataDir, { recursive: true })
await mkdir(uploadDir, { recursive: true })

const securityMonitor = createSecurityMonitor({
  ipKey: securityIpKey,
  storageRoot,
  windowMinutes: env.SECURITY_ALERT_WINDOW_MINUTES,
  cooldownMinutes: env.SECURITY_ALERT_COOLDOWN_MINUTES,
  proxyMinRequests: env.SECURITY_ALERT_PROXY_MIN_REQUESTS,
  proxyFailureRate: env.SECURITY_ALERT_PROXY_FAILURE_RATE_PERCENT / 100,
  diskMinFreeBytes: Math.floor(env.SECURITY_DISK_MIN_FREE_MB * 1024 * 1024),
  diskCheckMinutes: env.SECURITY_DISK_CHECK_MINUTES,
  thresholds: {
    loginFailures: env.SECURITY_ALERT_LOGIN_FAILURES,
    uploadRejections: env.SECURITY_ALERT_UPLOAD_REJECTIONS,
    serverErrors: env.SECURITY_ALERT_SERVER_ERRORS,
    proxyFailures: env.SECURITY_ALERT_PROXY_FAILURES,
  },
}, {
  deliverAlert: env.SECURITY_ALERT_WEBHOOK_URL
    ? (alert) => postSecureWebhook(env.SECURITY_ALERT_WEBHOOK_URL, alert, {
        allowedHosts: securityWebhookHosts,
        timeoutMs: env.SECURITY_ALERT_TIMEOUT_SECONDS * 1000,
      })
    : null,
})

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', trustProxyHops)
app.use((request, response, next) => {
  request.requestId = crypto.randomUUID()
  response.set('X-Request-Id', request.requestId)
  response.once('finish', () => {
    if (response.statusCode >= 500) {
      securityLog('server_error', request, 'failed', {
        reason: 'http_server_error',
        statusCode: response.statusCode,
      })
    }
  })
  next()
})
app.use(express.json({ limit: '512kb' }))
app.use('/uploads', (_request, response) => response.status(404).json({ error: '资源不存在' }))

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
  return parseContent(JSON.parse(raw), articleImageHosts)
}

async function saveContent(content) {
  const temporaryFile = `${dataFile}.tmp`
  const validatedContent = parseContent(content, articleImageHosts)
  await writeFile(temporaryFile, `${JSON.stringify(validatedContent, null, 2)}\n`, 'utf8')
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
  return securityMonitor.audit(event, request, outcome, details)
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

function buildArticle(input, existing = {}) {
  const now = new Date().toISOString()
  return {
    ...existing,
    id: existing.id || crypto.randomUUID(),
    ...input,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  }
}

class ContentConflictError extends Error {
  constructor(version) {
    super('内容已被其他操作更新，请刷新后重试')
    this.name = 'ContentConflictError'
    this.version = version
  }
}

function expectedContentVersion(request) {
  const source = request.get('X-Content-Version') || ''
  if (!/^\d+$/.test(source)) throw new ContentValidationError('X-Content-Version 必须是非负整数')
  const version = Number(source)
  if (!Number.isSafeInteger(version)) throw new ContentValidationError('X-Content-Version 超出允许范围')
  return version
}

function assertContentVersion(request, content) {
  if (expectedContentVersion(request) !== content.version) throw new ContentConflictError(content.version)
}

async function persistContentMutation(content) {
  content.version += 1
  await saveContent(content)
  return content.version
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
  securityLog(event, null, 'failed', { reason: upstreamErrorCode(error) })
}

async function fetchBilibiliImage(imageUrl) {
  try {
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
    securityMonitor.observeProxy('succeeded')
    return { body: upstream.body, contentType, expiresAt: Date.now() + 6 * 60 * 60 * 1000 }
  } catch (error) {
    securityMonitor.observeProxy('failed')
    throw error
  }
}

async function refreshBilibiliFeed() {
  const [videoResult, dynamicResult] = await Promise.allSettled([
    fetchBilibiliVideos(),
    fetchBilibiliDynamics(),
  ])
  const videoUnavailable = videoResult.status === 'rejected'
  const dynamicUnavailable = dynamicResult.status === 'rejected'
  securityMonitor.observeProxy(videoUnavailable ? 'failed' : 'succeeded')
  securityMonitor.observeProxy(dynamicUnavailable ? 'failed' : 'succeeded')
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
    const article = buildArticle(parseInput(articleInputSchema, request.body))
    const version = await withContentMutation(async () => {
      const content = await readContent()
      assertContentVersion(request, content)
      content.articles.unshift(article)
      return persistContentMutation(content)
    })
    securityLog('admin_article_create', request, 'succeeded', {
      articleId: article.id,
      status: article.status,
    })
    response.status(201).json({ article, version })
  } catch (error) {
    next(error)
  }
})

app.put('/api/admin/articles/:id', ...protectAdminWrite, async (request, response, next) => {
  try {
    const result = await withContentMutation(async () => {
      const content = await readContent()
      assertContentVersion(request, content)
      const index = content.articles.findIndex((item) => item.id === request.params.id)
      if (index === -1) return { status: 'missing' }
      const nextArticle = buildArticle(parseInput(articleInputSchema, request.body), content.articles[index])
      content.articles[index] = nextArticle
      const version = await persistContentMutation(content)
      return { status: 'saved', article: nextArticle, version }
    })
    if (result.status === 'missing') return response.status(404).json({ error: '文章不存在' })
    securityLog('admin_article_update', request, 'succeeded', {
      articleId: result.article.id,
      status: result.article.status,
    })
    response.json({ article: result.article, version: result.version })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/admin/articles/:id', ...protectAdminWrite, async (request, response, next) => {
  try {
    const result = await withContentMutation(async () => {
      const content = await readContent()
      assertContentVersion(request, content)
      const nextArticles = content.articles.filter((article) => article.id !== request.params.id)
      if (nextArticles.length === content.articles.length) return null
      content.articles = nextArticles
      return { version: await persistContentMutation(content) }
    })
    if (!result) return response.status(404).json({ error: '文章不存在' })
    securityLog('admin_article_delete', request, 'succeeded', { articleId: request.params.id })
    response.json(result)
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin/resources', ...protectAdminWrite, uploadRateLimiter, limitUploadConcurrency, upload.single('file'), async (request, response, next) => {
  try {
    if (!request.file) return response.status(400).json({ error: '请选择上传文件' })
    const fields = parseInput(resourceInputSchema, {
      ...request.body,
      name: request.body.name || request.file.originalname.replace(/\.[^.]+$/, ''),
      meta: request.body.meta || `${Math.ceil(request.file.size / 1024)} KB`,
    })
    const { extension } = request.uploadMetadata
    await inspectUpload(request.file.path, extension, archiveLimits)
    const scanStatus = await scanUpload(request.file.path, extension)
    const now = new Date().toISOString()
    const resource = {
      id: crypto.randomUUID(),
      ...fields,
      storagePath: `/uploads/${request.file.filename}`,
      downloadName: request.file.originalname,
      size: request.file.size,
      mime: uploadContentType(extension),
      scanStatus,
      createdAt: now,
    }
    const version = await withContentMutation(async () => {
      if (await uploadDirectorySize() > uploadTotalQuotaBytes) {
        throw new UploadSecurityError('storage_quota_exceeded', '资源存储空间已满', 413)
      }
      const content = await readContent()
      assertContentVersion(request, content)
      content.resources.unshift(resource)
      return persistContentMutation(content)
    })
    securityLog('admin_resource_upload', request, 'succeeded', {
      resourceId: resource.id,
      extension,
      size: resource.size,
      scanStatus,
    })
    response.status(201).json({ resource: serializeResource(resource), version })
  } catch (error) {
    if (request.file) await unlink(request.file.path).catch(() => {})
    next(error)
  }
})

app.delete('/api/admin/resources/:id', ...protectAdminWrite, async (request, response, next) => {
  try {
    const result = await withContentMutation(async () => {
      const content = await readContent()
      assertContentVersion(request, content)
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
        await persistContentMutation(content)
      } catch (error) {
        if (quarantined) await rename(quarantinedPath, filePath).catch(() => {})
        throw error
      }

      if (quarantined) {
        await unlink(quarantinedPath).catch(() => {
          securityLog('admin_resource_delete_cleanup', request, 'failed', { resourceId: resource.id })
        })
      }
      return { resource, fileState: quarantined ? 'deleted' : 'missing', version: content.version }
    })
    if (!result) return response.status(404).json({ error: '资源不存在' })
    securityLog('admin_resource_delete', request, 'succeeded', {
      resourceId: result.resource.id,
      fileState: result.fileState,
    })
    response.json({ version: result.version })
  } catch (error) {
    securityLog('admin_resource_delete', request, 'failed', { resourceId: request.params.id })
    next(error)
  }
})

app.use('/api', (_request, response) => {
  response.status(404).json({ error: '接口不存在' })
})

app.use((error, request, response, _next) => {
  if (error instanceof ContentConflictError) {
    return response.status(409).json({ error: error.message, version: error.version })
  }
  if (error instanceof ContentValidationError) {
    return response.status(400).json({ error: error.message })
  }
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

securityMonitor.startDiskMonitoring()

server.headersTimeout = serverHeadersTimeoutMs
server.requestTimeout = serverRequestTimeoutMs
server.keepAliveTimeout = 5000
server.maxRequestsPerSocket = 100
