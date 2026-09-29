import assert from 'node:assert/strict'
import { createSecurityMonitor } from '../server/security/audit.js'

function config(overrides = {}) {
  return {
    ipKey: 'test-key-with-at-least-thirty-two-characters',
    storageRoot: '.',
    windowMinutes: 10,
    cooldownMinutes: 30,
    proxyMinRequests: 2,
    proxyFailureRate: 0.5,
    diskMinFreeBytes: 1_024,
    diskCheckMinutes: 5,
    thresholds: {
      loginFailures: 2,
      uploadRejections: 2,
      serverErrors: 2,
      proxyFailures: 2,
    },
    ...overrides,
  }
}

const records = []
const errors = []
const delivered = []
let now = Date.parse('2026-09-29T00:00:00.000Z')
let sequence = 0
const monitor = createSecurityMonitor(config(), {
  clock: () => now,
  randomId: () => `request-${++sequence}`,
  write: (record) => records.push(record),
  writeError: (record) => errors.push(record),
  deliverAlert: async (alert) => delivered.push(alert),
})

const request = {
  requestId: 'trace-123',
  ip: '203.0.113.42',
  method: 'POST',
  path: '/api/admin/articles',
}
const audit = monitor.audit('admin_article_create', request, 'succeeded', {
  articleId: 'article-1',
  status: 'published',
  password: 'must-not-appear',
  cookie: 'must-not-appear',
  markdown: '# private article body',
})
assert.equal(audit.requestId, 'trace-123')
assert.equal(audit.articleId, 'article-1')
assert.match(audit.sourceIp, /^hmac-sha256:[a-f0-9]{24}$/)
assert.equal(audit.sourceIp, monitor.ipTag('203.0.113.42'))
assert.doesNotMatch(JSON.stringify(audit), /203\.0\.113\.42|must-not-appear|private article body/)

monitor.audit('admin_login', request, 'failed', { attempts: 1 })
monitor.audit('admin_login', request, 'failed', { attempts: 2 })
await new Promise((resolve) => setImmediate(resolve))
assert.equal(delivered.length, 1)
assert.equal(delivered[0].event, 'loginFailures')

monitor.audit('admin_login', request, 'failed', { attempts: 3 })
await new Promise((resolve) => setImmediate(resolve))
assert.equal(delivered.length, 1, 'cooldown must suppress duplicate alerts')
now += 31 * 60 * 1000
monitor.audit('admin_login', request, 'failed', { attempts: 4 })
monitor.audit('admin_login', request, 'failed', { attempts: 5 })
await new Promise((resolve) => setImmediate(resolve))
assert.equal(delivered.length, 2)

for (const [event, outcome, expected] of [
  ['admin_resource_upload', 'rejected', 'uploadRejections'],
  ['server_error', 'failed', 'serverErrors'],
]) {
  monitor.audit(event, request, outcome, { reason: 'test' })
  monitor.audit(event, request, outcome, { reason: 'test' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(delivered.at(-1).event, expected)
}
monitor.observeProxy('failed')
monitor.observeProxy('failed')
await new Promise((resolve) => setImmediate(resolve))
assert.equal(delivered.at(-1).event, 'proxyFailures')
assert.equal(delivered.at(-1).failureRate, 100)

const diskMonitor = createSecurityMonitor(config({ diskMinFreeBytes: 10_000 }), {
  clock: () => now,
  randomId: () => `disk-${++sequence}`,
  write: (record) => records.push(record),
  writeError: (record) => errors.push(record),
  deliverAlert: async (alert) => delivered.push(alert),
  diskStats: async () => ({ bavail: 2, bsize: 1_000 }),
})
await diskMonitor.checkDisk()
assert.equal(delivered.at(-1).event, 'diskLow')
assert.equal(delivered.at(-1).freeBytes, 2_000)

await monitor.triggerAlert('test', { reason: 'manual_test' }, { throwDeliveryError: true })
assert.equal(delivered.at(-1).event, 'test')
assert.ok(records.some((record) => record.event === 'security_alert_delivery' && record.outcome === 'succeeded'))
assert.ok(errors.some((record) => record.level === 'security_alert'))

console.log('Security monitoring tests passed.')
