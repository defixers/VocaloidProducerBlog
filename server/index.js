import crypto from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import express from 'express'
import multer from 'multer'

const rootDir = resolve(import.meta.dirname, '..')
const envFile = join(rootDir, '.env')
if (existsSync(envFile)) loadEnvFile(envFile)
const dataDir = join(rootDir, 'server', 'data')
const dataFile = join(dataDir, 'content.json')
const uploadDir = join(rootDir, 'server', 'uploads')
const distDir = join(rootDir, 'dist')
const port = Number(process.env.PORT || 8787)
const isProduction = process.env.NODE_ENV === 'production'
const adminToken = process.env.ADMIN_TOKEN || (isProduction ? '' : 'utopia-dev')
const bilibiliUid = process.env.BILIBILI_UID || '1858510441'
const bilibiliCookie = process.env.BILIBILI_COOKIE || ''
const bilibiliCache = { expiresAt: 0, payload: null }
const wbiKeyCache = { expiresAt: 0, key: '' }
const wbiMixinTable = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

if (!adminToken) {
  throw new Error('ADMIN_TOKEN is required in production.')
}

await mkdir(dataDir, { recursive: true })
await mkdir(uploadDir, { recursive: true })

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))
app.use('/uploads', express.static(uploadDir, {
  immutable: true,
  maxAge: '30d',
  fallthrough: false,
}))

const allowedExtensions = new Set([
  '.mid', '.midi', '.wav', '.mp3', '.flac', '.zip', '.7z', '.rar',
  '.png', '.jpg', '.jpeg', '.webp', '.pdf', '.psd', '.txt',
])

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_request, file, callback) => {
      const extension = extname(file.originalname).toLowerCase()
      callback(null, `${crypto.randomUUID()}${extension}`)
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const extension = extname(file.originalname).toLowerCase()
    callback(allowedExtensions.has(extension) ? null : new Error('Unsupported file type.'), allowedExtensions.has(extension))
  },
})

async function readContent() {
  const raw = await readFile(dataFile, 'utf8')
  return JSON.parse(raw)
}

async function saveContent(content) {
  const temporaryFile = `${dataFile}.tmp`
  await writeFile(temporaryFile, `${JSON.stringify(content, null, 2)}\n`, 'utf8')
  await rename(temporaryFile, dataFile)
}

function authenticate(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') || ''
  const expected = Buffer.from(adminToken)
  const actual = Buffer.from(token)
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return response.status(401).json({ error: '管理令牌无效' })
  }
  next()
}

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

async function fetchBilibiliJson(url) {
  const response = await fetch(url, {
    headers: bilibiliHeaders(),
    signal: AbortSignal.timeout(8000),
  })
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok || !contentType.includes('application/json')) {
    throw new Error(`Bilibili request failed (${response.status})`)
  }

  const data = await response.json()
  if (data.code !== 0) throw new Error(`Bilibili API error (${data.code ?? 'invalid response'})`)
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
  const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: bilibiliHeaders(),
    signal: AbortSignal.timeout(8000),
  })
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok || !contentType.includes('application/json')) {
    throw new Error(`Bilibili WBI key request failed (${response.status})`)
  }
  const data = await response.json()
  if (!data.data?.wbi_img?.img_url || !data.data?.wbi_img?.sub_url) {
    throw new Error(`Bilibili WBI key error (${data.code ?? 'invalid response'})`)
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
    cover: String(video.pic || '').replace(/^http:/, 'https:').replace(/^\/\//, 'https://'),
    duration: video.length || '',
  })).filter((video) => video.id && video.title && video.cover)
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/bilibili/feed', async (_request, response) => {
  const now = Date.now()
  if (bilibiliCache.payload && bilibiliCache.expiresAt > now) {
    return response.json(bilibiliCache.payload)
  }

  try {
    const [videoResult, dynamicResult] = await Promise.allSettled([
      fetchBilibiliVideos(),
      fetchBilibiliDynamics(),
    ])
    const videoUnavailable = videoResult.status === 'rejected'
    const dynamicUnavailable = dynamicResult.status === 'rejected'
    if (videoUnavailable) console.error('Bilibili video sync failed:', videoResult.reason.message)
    if (dynamicUnavailable) console.error('Bilibili dynamic sync failed:', dynamicResult.reason.message)
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
    bilibiliCache.expiresAt = now + 10 * 60 * 1000
    response.json(payload)
  } catch (error) {
    console.error('Bilibili sync failed:', error.message)
    if (bilibiliCache.payload) return response.json({ ...bilibiliCache.payload, stale: true })
    response.json({
      syncedAt: null,
      videos: [],
      dynamics: [],
      videoUnavailable: true,
      dynamicUnavailable: true,
      unavailable: true,
    })
  }
})

app.get('/api/content', async (_request, response, next) => {
  try {
    const content = await readContent()
    response.json({
      articles: content.articles.filter((article) => article.status === 'published'),
      resources: content.resources,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/admin/content', authenticate, async (_request, response, next) => {
  try {
    response.json(await readContent())
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin/articles', authenticate, async (request, response, next) => {
  try {
    const article = normalizeArticle(request.body)
    if (!article.title || !article.markdown) {
      return response.status(400).json({ error: '标题和 Markdown 正文不能为空' })
    }
    const content = await readContent()
    content.articles.unshift(article)
    await saveContent(content)
    response.status(201).json(article)
  } catch (error) {
    next(error)
  }
})

app.put('/api/admin/articles/:id', authenticate, async (request, response, next) => {
  try {
    const content = await readContent()
    const index = content.articles.findIndex((article) => article.id === request.params.id)
    if (index === -1) return response.status(404).json({ error: '文章不存在' })
    const article = normalizeArticle(request.body, content.articles[index])
    if (!article.title || !article.markdown) {
      return response.status(400).json({ error: '标题和 Markdown 正文不能为空' })
    }
    content.articles[index] = article
    await saveContent(content)
    response.json(article)
  } catch (error) {
    next(error)
  }
})

app.delete('/api/admin/articles/:id', authenticate, async (request, response, next) => {
  try {
    const content = await readContent()
    const nextArticles = content.articles.filter((article) => article.id !== request.params.id)
    if (nextArticles.length === content.articles.length) {
      return response.status(404).json({ error: '文章不存在' })
    }
    content.articles = nextArticles
    await saveContent(content)
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin/resources', authenticate, upload.single('file'), async (request, response, next) => {
  try {
    if (!request.file) return response.status(400).json({ error: '请选择上传文件' })
    const now = new Date().toISOString()
    const resource = {
      id: crypto.randomUUID(),
      name: String(request.body.name || request.file.originalname).trim(),
      meta: String(request.body.meta || `${Math.ceil(request.file.size / 1024)} KB`).trim(),
      tag: String(request.body.tag || '二创资源').trim(),
      downloadUrl: `/uploads/${request.file.filename}`,
      downloadName: request.file.originalname,
      size: request.file.size,
      createdAt: now,
    }
    const content = await readContent()
    content.resources.unshift(resource)
    await saveContent(content)
    response.status(201).json(resource)
  } catch (error) {
    if (request.file) await unlink(request.file.path).catch(() => {})
    next(error)
  }
})

app.delete('/api/admin/resources/:id', authenticate, async (request, response, next) => {
  try {
    const content = await readContent()
    const resource = content.resources.find((item) => item.id === request.params.id)
    if (!resource) return response.status(404).json({ error: '资源不存在' })
    content.resources = content.resources.filter((item) => item.id !== request.params.id)
    await saveContent(content)
    if (resource.downloadUrl.startsWith('/uploads/')) {
      await unlink(join(uploadDir, resource.downloadUrl.slice('/uploads/'.length))).catch(() => {})
    }
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.use('/api', (_request, response) => {
  response.status(404).json({ error: '接口不存在' })
})

app.use((error, _request, response, _next) => {
  console.error(error)
  const status = error instanceof multer.MulterError ? 400 : 500
  response.status(status).json({ error: error.message || '服务器错误' })
})

if (existsSync(distDir)) {
  app.use('/assets', express.static(join(distDir, 'assets'), { immutable: true, maxAge: isProduction ? '1y' : 0 }))
  app.use(express.static(distDir, { index: false, maxAge: isProduction ? '1h' : 0 }))
  app.get('*', (_request, response) => response.sendFile(join(distDir, 'index.html')))
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Content server: http://127.0.0.1:${port}`)
  if (!isProduction) console.log('Development admin token: utopia-dev')
})
