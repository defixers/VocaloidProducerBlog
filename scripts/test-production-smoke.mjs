import assert from 'node:assert/strict'
import { runProductionSmoke, smokeConfiguration } from './lib/production-smoke.mjs'

const commit = 'a'.repeat(40)
const securityHeaders = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'content-security-policy': "default-src 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=()',
}

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

function mockFetch({ missingCsp = false, buildCommit = commit, publicPortOpen = false } = {}) {
  return async (input, options = {}) => {
    const url = new URL(input)
    if (url.port === '8787') {
      if (publicPortOpen) return jsonResponse({ ok: true })
      throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
    }
    if (url.protocol === 'http:') {
      return new Response(null, { status: 308, headers: { location: `https://${url.hostname}${url.pathname}` } })
    }
    if (options.method === 'HEAD' && url.pathname === '/') return new Response(null, { status: 200 })
    if (url.pathname === '/') {
      const headers = { ...securityHeaders }
      if (missingCsp) delete headers['content-security-policy']
      return new Response('<!doctype html>', { status: 200, headers })
    }
    if (url.pathname === '/admin') {
      return new Response('<!doctype html>', { status: 200, headers: { ...securityHeaders, 'cache-control': 'no-store' } })
    }
    if (url.pathname === '/api/health') return jsonResponse({ ok: true })
    if (url.pathname === '/build-info.json') return jsonResponse({ schema: 1, commit: buildCommit, dirty: false })
    if (url.pathname === '/api/bilibili/cache-stats') {
      return jsonResponse({
        feed: { hits: 1, misses: 1, coalesced: 0, cached: true },
        images: { hits: 1, misses: 1, coalesced: 0, evictions: 0, entries: 1, bytes: 1024, maxBytes: 4096, maxEntries: 8 },
      })
    }
    return new Response(null, { status: 404 })
  }
}

const configuration = smokeConfiguration({ DEPLOY_COMMIT: commit, SMOKE_TIMEOUT_MS: '1000' })
const success = await runProductionSmoke(configuration, { fetchImpl: mockFetch() })
assert.equal(success.commit, commit)
assert.equal(success.checks.includes('public-port-8787-isolated'), true)

await assert.rejects(
  runProductionSmoke(configuration, { fetchImpl: mockFetch({ missingCsp: true }) }),
  /content-security-policy/,
)
await assert.rejects(
  runProductionSmoke(configuration, { fetchImpl: mockFetch({ buildCommit: 'b'.repeat(40) }) }),
  /build identity/,
)
await assert.rejects(
  runProductionSmoke(configuration, { fetchImpl: mockFetch({ publicPortOpen: true }) }),
  /Public port 8787 is reachable/,
)

console.log('Production smoke tests passed.')
