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

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
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
