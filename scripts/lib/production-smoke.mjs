const SHA_PATTERN = /^[0-9a-f]{40}$/
const CACHE_STATUS_FIELDS = ['hits', 'misses', 'coalesced']

function fail(message) {
  throw Object.assign(new Error(message), { code: 'production_smoke_failed' })
}

function parseOrigin(value, name) {
  let url
  try {
    url = new URL(value)
  } catch {
    fail(`${name} must be a valid URL.`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
    fail(`${name} must be an HTTPS origin without credentials, a custom port, path, query, or fragment.`)
  }
  return url
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) fail(`${label} returned HTTP ${response.status}; expected ${expected}.`)
}

function assertHeader(response, name, predicate, label) {
  const value = response.headers.get(name) || ''
  if (!predicate(value)) fail(`${label} has an invalid or missing ${name} header.`)
}

async function readJson(response, label) {
  assertHeader(response, 'content-type', (value) => /application\/json/i.test(value), label)
  try {
    return await response.json()
  } catch {
    fail(`${label} did not return valid JSON.`)
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative integer.`)
}

function assertNoSensitiveKeys(value, path = 'cache metrics') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (/(cookie|authorization|password|secret|token|access.?key)/i.test(key)) {
      fail(`${path} exposes a sensitive field: ${key}.`)
    }
    assertNoSensitiveKeys(child, `${path}.${key}`)
  }
}

function validateCacheMetrics(metrics) {
  if (!metrics?.feed || !metrics?.images) fail('Cache metrics response is incomplete.')
  for (const field of CACHE_STATUS_FIELDS) assertNonNegativeInteger(metrics.feed[field], `feed.${field}`)
  if (typeof metrics.feed.cached !== 'boolean') fail('feed.cached must be a boolean.')
  for (const field of [...CACHE_STATUS_FIELDS, 'evictions', 'entries', 'bytes']) {
    assertNonNegativeInteger(metrics.images[field], `images.${field}`)
  }
  if (!Number.isSafeInteger(metrics.images.maxBytes) || metrics.images.maxBytes < 1) fail('images.maxBytes must be positive.')
  if (!Number.isSafeInteger(metrics.images.maxEntries) || metrics.images.maxEntries < 1) fail('images.maxEntries must be positive.')
  if (metrics.images.bytes > metrics.images.maxBytes) fail('Image cache bytes exceed the configured limit.')
  if (metrics.images.entries > metrics.images.maxEntries) fail('Image cache entries exceed the configured limit.')
  assertNoSensitiveKeys(metrics)
}

export function smokeConfiguration(environment = process.env) {
  const baseUrl = parseOrigin(environment.SMOKE_BASE_URL || 'https://utopiap.top', 'SMOKE_BASE_URL')
  const wwwUrl = parseOrigin(environment.SMOKE_WWW_URL || 'https://www.utopiap.top', 'SMOKE_WWW_URL')
  const expectedCommit = String(environment.DEPLOY_COMMIT || '').trim().toLowerCase()
  if (!SHA_PATTERN.test(expectedCommit)) fail('DEPLOY_COMMIT must be a full 40-character Git SHA.')
  const timeoutMs = Number(environment.SMOKE_TIMEOUT_MS || 10_000)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    fail('SMOKE_TIMEOUT_MS must be an integer from 1000 to 60000.')
  }
  return { baseUrl, wwwUrl, expectedCommit, timeoutMs }
}

export async function runProductionSmoke(configuration, { fetchImpl = fetch } = {}) {
  const { baseUrl, wwwUrl, expectedCommit, timeoutMs } = configuration
  const checks = []
  const request = (url, options = {}) => fetchImpl(url, {
    ...options,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': 'VocaloidProducerBlog-Production-Smoke/1.0', ...options.headers },
  })

  for (const origin of [baseUrl, wwwUrl]) {
    const insecure = new URL(origin)
    insecure.protocol = 'http:'
    const response = await request(insecure, { method: 'HEAD' })
    if (![301, 308].includes(response.status)) fail(`${insecure.origin} does not permanently redirect to HTTPS.`)
    const location = new URL(response.headers.get('location') || '', insecure)
    if (location.protocol !== 'https:' || location.hostname !== origin.hostname
      || location.pathname !== insecure.pathname || location.search !== insecure.search) {
      fail(`${insecure.origin} redirects to an unexpected location.`)
    }
    checks.push(`redirect:${origin.hostname}`)

    const tlsResponse = await request(origin, { method: 'HEAD' })
    if (tlsResponse.status < 200 || tlsResponse.status >= 400) fail(`${origin.origin} failed the HTTPS certificate/status check.`)
    checks.push(`tls:${origin.hostname}`)
  }

  const home = await request(baseUrl)
  assertStatus(home, 200, 'Homepage')
  assertHeader(home, 'strict-transport-security', (value) => /max-age=\d+/i.test(value), 'Homepage')
  assertHeader(home, 'content-security-policy', (value) => /default-src/i.test(value), 'Homepage')
  assertHeader(home, 'x-content-type-options', (value) => value.toLowerCase() === 'nosniff', 'Homepage')
  assertHeader(home, 'x-frame-options', (value) => value.toUpperCase() === 'DENY', 'Homepage')
  assertHeader(home, 'referrer-policy', Boolean, 'Homepage')
  assertHeader(home, 'permissions-policy', Boolean, 'Homepage')
  checks.push('security-headers')

  const admin = await request(new URL('/admin', baseUrl))
  assertStatus(admin, 200, 'Admin page')
  assertHeader(admin, 'cache-control', (value) => /(?:^|,)\s*no-store(?:\s*,|$)/i.test(value), 'Admin page')
  assertHeader(admin, 'x-frame-options', (value) => value.toUpperCase() === 'DENY', 'Admin page')
  checks.push('admin-no-store')

  const healthResponse = await request(new URL('/api/health', baseUrl))
  assertStatus(healthResponse, 200, 'Health endpoint')
  const health = await readJson(healthResponse, 'Health endpoint')
  if (health?.ok !== true) fail('Health endpoint did not report ok=true.')
  checks.push('health')

  const buildResponse = await request(new URL('/build-info.json', baseUrl))
  assertStatus(buildResponse, 200, 'Build identity')
  const build = await readJson(buildResponse, 'Build identity')
  if (build?.schema !== 1 || build.commit !== expectedCommit || build.dirty !== false) {
    fail(`Production build identity does not match ${expectedCommit}.`)
  }
  checks.push('build-identity')

  const metricsResponse = await request(new URL('/api/bilibili/cache-stats', baseUrl))
  assertStatus(metricsResponse, 200, 'Cache metrics')
  validateCacheMetrics(await readJson(metricsResponse, 'Cache metrics'))
  checks.push('cache-metrics')

  const publicPort = new URL(baseUrl)
  publicPort.protocol = 'http:'
  publicPort.port = '8787'
  publicPort.pathname = '/api/health'
  try {
    const response = await request(publicPort)
    fail(`Public port 8787 is reachable with HTTP ${response.status}.`)
  } catch (error) {
    if (error?.code === 'production_smoke_failed') throw error
  }
  checks.push('public-port-8787-isolated')

  return { commit: expectedCommit, origin: baseUrl.origin, checks }
}
