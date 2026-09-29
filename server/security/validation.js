import { z } from 'zod'

const trimmedString = (max) => z.string().trim().max(max)
const requiredString = (max) => trimmedString(max).min(1)

function envNumber({ fallback, integer = false, min = 0, max = Number.MAX_SAFE_INTEGER }) {
  let schema = z.number().finite().min(min).max(max)
  if (integer) schema = schema.int()
  return z.preprocess((value) => {
    if (value === undefined || value === '') return fallback
    return typeof value === 'string' ? Number(value) : value
  }, schema)
}

function envString(fallback = '', max = 16_384) {
  return z.preprocess((value) => value === undefined ? fallback : value, z.string().max(max))
}

const originListSchema = envString().transform((value, context) => {
  const origins = value.split(',').map((item) => item.trim()).filter(Boolean)
  for (const origin of origins) {
    try {
      const parsed = new URL(origin)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) {
        throw new Error()
      }
    } catch {
      context.addIssue({ code: 'custom', message: `无效来源地址：${origin}` })
      return z.NEVER
    }
  }
  return origins
})

const hostnameListSchema = envString().transform((value, context) => {
  const hosts = value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
  for (const host of hosts) {
    try {
      const parsed = new URL(`https://${host}`)
      if (parsed.hostname !== host || parsed.host !== host || parsed.pathname !== '/' || parsed.username || parsed.password) throw new Error()
    } catch {
      context.addIssue({ code: 'custom', message: `无效图片域名：${host}` })
      return z.NEVER
    }
  }
  return hosts
})

const jsonStringArraySchema = z.preprocess((value) => {
  if (value === undefined || value === '') return ['--no-summary']
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}, z.array(z.string().max(500)).max(32))

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: envNumber({ fallback: 8787, integer: true, min: 1, max: 65_535 }),
  APP_STORAGE_ROOT: envString('', 2_048),
  APP_ORIGIN: originListSchema,
  ARTICLE_IMAGE_HOSTS: hostnameListSchema,
  ADMIN_PASSWORD_HASH: envString(),
  ADMIN_SESSION_IDLE_MINUTES: envNumber({ fallback: 30, min: 0.01, max: 10_080 }),
  ADMIN_SESSION_ABSOLUTE_HOURS: envNumber({ fallback: 8, min: 0.01, max: 720 }),
  ADMIN_LOGIN_WINDOW_MINUTES: envNumber({ fallback: 15, min: 0.01, max: 1_440 }),
  ADMIN_LOGIN_IP_LIMIT: envNumber({ fallback: 10, integer: true, min: 1, max: 100_000 }),
  ADMIN_LOGIN_ACCOUNT_LIMIT: envNumber({ fallback: 30, integer: true, min: 1, max: 100_000 }),
  ADMIN_LOGIN_BACKOFF_BASE_MS: envNumber({ fallback: 500, min: 1, max: 3_600_000 }),
  ADMIN_LOGIN_BACKOFF_MAX_MS: envNumber({ fallback: 30_000, min: 1, max: 3_600_000 }),
  ADMIN_LOGIN_CONCURRENCY: envNumber({ fallback: 2, integer: true, min: 1, max: 1_000 }),
  ADMIN_WRITE_WINDOW_MINUTES: envNumber({ fallback: 10, min: 0.01, max: 1_440 }),
  ADMIN_WRITE_LIMIT: envNumber({ fallback: 60, integer: true, min: 1, max: 100_000 }),
  ADMIN_WRITE_CONCURRENCY: envNumber({ fallback: 2, integer: true, min: 1, max: 1_000 }),
  UPLOAD_WINDOW_MINUTES: envNumber({ fallback: 60, min: 0.01, max: 10_080 }),
  UPLOAD_LIMIT: envNumber({ fallback: 10, integer: true, min: 1, max: 100_000 }),
  UPLOAD_CONCURRENCY: envNumber({ fallback: 1, integer: true, min: 1, max: 100 }),
  UPLOAD_MAX_FILE_MB: envNumber({ fallback: 100, min: 0.001, max: 10_240 }),
  UPLOAD_TOTAL_QUOTA_MB: envNumber({ fallback: 1_024, min: 0.001, max: 1_048_576 }),
  UPLOAD_ARCHIVE_MAX_UNCOMPRESSED_MB: envNumber({ fallback: 512, min: 0.001, max: 1_048_576 }),
  UPLOAD_ARCHIVE_MAX_FILES: envNumber({ fallback: 1_000, integer: true, min: 1, max: 1_000_000 }),
  UPLOAD_ARCHIVE_MAX_DEPTH: envNumber({ fallback: 10, integer: true, min: 1, max: 100 }),
  UPLOAD_ARCHIVE_MAX_RATIO: envNumber({ fallback: 100, min: 1, max: 1_000_000 }),
  UPLOAD_VIRUS_SCAN_COMMAND: envString('', 2_048),
  UPLOAD_VIRUS_SCAN_ARGS: jsonStringArraySchema,
  UPLOAD_SCAN_TIMEOUT_SECONDS: envNumber({ fallback: 60, min: 0.1, max: 3_600 }),
  PUBLIC_RATE_WINDOW_MINUTES: envNumber({ fallback: 10, min: 0.01, max: 1_440 }),
  BILIBILI_FEED_RATE_LIMIT: envNumber({ fallback: 60, integer: true, min: 1, max: 100_000 }),
  BILIBILI_IMAGE_RATE_LIMIT: envNumber({ fallback: 180, integer: true, min: 1, max: 100_000 }),
  RESOURCE_DOWNLOAD_RATE_LIMIT: envNumber({ fallback: 60, integer: true, min: 1, max: 100_000 }),
  BILIBILI_FEED_CONCURRENCY: envNumber({ fallback: 4, integer: true, min: 1, max: 1_000 }),
  BILIBILI_IMAGE_CONCURRENCY: envNumber({ fallback: 8, integer: true, min: 1, max: 1_000 }),
  RESOURCE_DOWNLOAD_CONCURRENCY: envNumber({ fallback: 4, integer: true, min: 1, max: 1_000 }),
  BILIBILI_UPSTREAM_TIMEOUT_SECONDS: envNumber({ fallback: 8, min: 0.1, max: 300 }),
  BILIBILI_JSON_MAX_MB: envNumber({ fallback: 2, min: 0.001, max: 100 }),
  BILIBILI_IMAGE_MAX_MB: envNumber({ fallback: 5, min: 0.001, max: 100 }),
  BILIBILI_REDIRECT_LIMIT: envNumber({ fallback: 3, integer: true, min: 0, max: 20 }),
  BILIBILI_IMAGE_CACHE_MB: envNumber({ fallback: 32, min: 0.001, max: 10_240 }),
  BILIBILI_IMAGE_CACHE_ENTRIES: envNumber({ fallback: 64, integer: true, min: 1, max: 100_000 }),
  RESOURCE_DOWNLOAD_MAX_MB: envNumber({ fallback: 100, min: 0.001, max: 10_240 }),
  RESOURCE_DOWNLOAD_TIMEOUT_SECONDS: envNumber({ fallback: 120, min: 0.1, max: 3_600 }),
  SERVER_HEADERS_TIMEOUT_SECONDS: envNumber({ fallback: 15, min: 0.1, max: 300 }),
  SERVER_REQUEST_TIMEOUT_SECONDS: envNumber({ fallback: 120, min: 0.1, max: 3_600 }),
  SECURITY_LOG_IP_KEY: envString('', 1_024),
  SECURITY_ALERT_WINDOW_MINUTES: envNumber({ fallback: 10, min: 0.01, max: 10_080 }),
  SECURITY_ALERT_COOLDOWN_MINUTES: envNumber({ fallback: 30, min: 0, max: 10_080 }),
  SECURITY_ALERT_LOGIN_FAILURES: envNumber({ fallback: 10, integer: true, min: 1, max: 100_000 }),
  SECURITY_ALERT_UPLOAD_REJECTIONS: envNumber({ fallback: 5, integer: true, min: 1, max: 100_000 }),
  SECURITY_ALERT_SERVER_ERRORS: envNumber({ fallback: 5, integer: true, min: 1, max: 100_000 }),
  SECURITY_ALERT_PROXY_FAILURES: envNumber({ fallback: 10, integer: true, min: 1, max: 100_000 }),
  SECURITY_ALERT_PROXY_MIN_REQUESTS: envNumber({ fallback: 10, integer: true, min: 1, max: 100_000 }),
  SECURITY_ALERT_PROXY_FAILURE_RATE_PERCENT: envNumber({ fallback: 50, min: 0.01, max: 100 }),
  SECURITY_DISK_MIN_FREE_MB: envNumber({ fallback: 1_024, min: 1, max: 1_048_576 }),
  SECURITY_DISK_CHECK_MINUTES: envNumber({ fallback: 5, min: 0.01, max: 10_080 }),
  SECURITY_ALERT_WEBHOOK_URL: envString('', 2_048),
  SECURITY_ALERT_WEBHOOK_HOSTS: hostnameListSchema,
  SECURITY_ALERT_TIMEOUT_SECONDS: envNumber({ fallback: 5, min: 0.1, max: 60 }),
  TRUST_PROXY_HOPS: envNumber({ fallback: 0, integer: true, min: 0, max: 100 }),
  BILIBILI_UID: z.preprocess((value) => value === undefined || value === '' ? '1858510441' : value, z.string().regex(/^\d{1,20}$/)),
  BILIBILI_COOKIE: envString('', 32_768),
}).strip()

function formatIssues(error) {
  return error.issues.map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`).join('; ')
}

export class ContentValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ContentValidationError'
  }
}

export function parseServerEnv(source = process.env) {
  const result = serverEnvSchema.safeParse(source)
  if (!result.success) throw new Error(`环境变量配置无效：${formatIssues(result.error)}`)
  return result.data
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

export function isSafeArticleImage(value, allowedHosts = new Set()) {
  if (value.startsWith('/images/')) {
    if (value.includes('\\') || value.includes('?') || value.includes('#') || /[\u0000-\u001f\u007f]/.test(value)) return false
    try {
      const decoded = decodeURIComponent(value)
      if (decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded)) return false
      return !decoded.split('/').some((part) => part === '..' || part === '.')
    } catch {
      return false
    }
  }
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && url.port === '' && allowedHosts.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function createArticleInputSchema(allowedImageHosts = new Set()) {
  return z.object({
    title: requiredString(120),
    type: requiredString(40).default('创作手记'),
    date: z.string().refine(validDate, '日期必须是有效的 YYYY-MM-DD').default(() => new Date().toISOString().slice(0, 10)),
    excerpt: trimmedString(300).default(''),
    readTime: requiredString(30).default('5 分钟'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '强调色必须是 #RRGGBB').default('#df4f3b'),
    image: z.string().trim().max(500).refine((value) => isSafeArticleImage(value, allowedImageHosts), '封面地址不安全').default('/images/anti-utopia-1600.webp'),
    markdown: requiredString(100_000),
    status: z.enum(['draft', 'published']).default('draft'),
  }).strict()
}

export const resourceInputSchema = z.object({
  name: trimmedString(120).default(''),
  tag: requiredString(40).default('二创资源'),
  meta: trimmedString(300).default(''),
}).strict()

function createStoredArticleSchema(allowedImageHosts) {
  return z.object({
  id: z.string().uuid(),
  title: requiredString(120),
  type: requiredString(40),
  date: z.string().refine(validDate),
  excerpt: trimmedString(300),
  readTime: requiredString(30),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  image: z.string().max(500).refine((value) => isSafeArticleImage(value, allowedImageHosts), '封面地址不安全'),
  markdown: requiredString(100_000),
  status: z.enum(['draft', 'published']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  }).strict()
}

const storedResourceSchema = z.object({
  id: z.string().uuid(),
  name: requiredString(120),
  meta: trimmedString(300),
  tag: requiredString(40),
  storagePath: z.string().regex(/^\/uploads\/[A-Za-z0-9._-]+$/),
  downloadName: requiredString(255),
  size: z.number().int().nonnegative(),
  mime: requiredString(120),
  scanStatus: z.enum(['clean', 'not_required']),
  createdAt: z.string().datetime(),
}).strict()

export function parseContent(value, allowedImageHosts = new Set()) {
  const contentSchema = z.object({
    version: z.number().int().nonnegative().default(0),
    articles: z.array(createStoredArticleSchema(allowedImageHosts)),
    resources: z.array(storedResourceSchema),
  }).strict()
  const result = contentSchema.safeParse(value)
  if (!result.success) throw new ContentValidationError(`内容文件格式无效：${formatIssues(result.error)}`)
  return result.data
}

export function parseInput(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) throw new ContentValidationError(`输入内容无效：${formatIssues(result.error)}`)
  return result.data
}
