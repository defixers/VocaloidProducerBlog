import crypto from 'node:crypto'
import { statfs } from 'node:fs/promises'

const SAFE_DETAIL_KEYS = new Set([
  'articleId', 'attempts', 'backoffMs', 'count', 'extension', 'fileState',
  'failureRate', 'freeBytes', 'reason', 'resourceId', 'scanStatus', 'size', 'status',
  'statusCode', 'thresholdBytes', 'windowMinutes',
])

const ALERT_RULES = new Map([
  ['admin_login:failed', 'loginFailures'],
  ['admin_resource_upload:rejected', 'uploadRejections'],
  ['server_error:failed', 'serverErrors'],
])

function safeDetails(details) {
  const output = {}
  if (!details || typeof details !== 'object') return output
  for (const [key, value] of Object.entries(details)) {
    if (!SAFE_DETAIL_KEYS.has(key)) continue
    if (typeof value === 'string') output[key] = value.slice(0, 160)
    else if (typeof value === 'number' && Number.isFinite(value)) output[key] = value
    else if (typeof value === 'boolean') output[key] = value
  }
  return output
}

function requestIp(request) {
  return request?.ip || request?.socket?.remoteAddress || 'unknown'
}

export function createSecurityMonitor(config, dependencies = {}) {
  const clock = dependencies.clock || (() => Date.now())
  const randomId = dependencies.randomId || (() => crypto.randomUUID())
  const write = dependencies.write || ((record) => console.log(JSON.stringify(record)))
  const writeError = dependencies.writeError || ((record) => console.error(JSON.stringify(record)))
  const deliverAlert = dependencies.deliverAlert || null
  const diskStats = dependencies.diskStats || statfs
  const buckets = new Map()
  let proxySamples = []
  const lastAlerts = new Map()
  const windowMs = config.windowMinutes * 60 * 1000
  const cooldownMs = config.cooldownMinutes * 60 * 1000

  function ipTag(ip) {
    if (!ip || ip === 'unknown') return 'unknown'
    return `hmac-sha256:${crypto.createHmac('sha256', config.ipKey).update(String(ip)).digest('hex').slice(0, 24)}`
  }

  async function triggerAlert(type, details = {}, options = {}) {
    const now = clock()
    const previousAlert = lastAlerts.get(type)
    if (type !== 'test' && previousAlert !== undefined && now - previousAlert < cooldownMs) return false
    lastAlerts.set(type, now)
    const alert = {
      level: 'security_alert',
      time: new Date(now).toISOString(),
      event: type,
      outcome: 'triggered',
      requestId: randomId(),
      ...safeDetails(details),
    }
    writeError(alert)
    if (deliverAlert) {
      try {
        await deliverAlert(alert)
        write({ ...alert, level: 'security', event: 'security_alert_delivery', outcome: 'succeeded' })
      } catch (error) {
        writeError({
          level: 'security',
          time: new Date(clock()).toISOString(),
          event: 'security_alert_delivery',
          outcome: 'failed',
          requestId: alert.requestId,
          reason: typeof error?.code === 'string' ? error.code : 'delivery_failed',
        })
        if (options.throwDeliveryError) throw error
      }
    }
    return true
  }

  function observe(bucketName) {
    const threshold = config.thresholds[bucketName]
    if (!threshold) return
    const now = clock()
    const recent = (buckets.get(bucketName) || []).filter((time) => now - time < windowMs)
    recent.push(now)
    buckets.set(bucketName, recent)
    if (recent.length >= threshold) {
      void triggerAlert(bucketName, { count: recent.length, windowMinutes: config.windowMinutes })
    }
  }

  function observeProxy(outcome) {
    const now = clock()
    proxySamples = proxySamples.filter((sample) => now - sample.time < windowMs)
    proxySamples.push({ time: now, failed: outcome === 'failed' })
    const failures = proxySamples.filter((sample) => sample.failed).length
    const failureRate = failures / proxySamples.length
    if (proxySamples.length >= config.proxyMinRequests
      && failures >= config.thresholds.proxyFailures
      && failureRate >= config.proxyFailureRate) {
      void triggerAlert('proxyFailures', {
        count: failures,
        failureRate: Math.round(failureRate * 10_000) / 100,
        windowMinutes: config.windowMinutes,
      })
    }
  }

  function audit(event, request, outcome, details = {}) {
    const now = clock()
    const record = {
      level: 'security',
      time: new Date(now).toISOString(),
      event: String(event).slice(0, 80),
      outcome: String(outcome).slice(0, 40),
      requestId: request?.requestId || randomId(),
      sourceIp: ipTag(requestIp(request)),
      method: request?.method || 'INTERNAL',
      path: request?.path || 'internal',
      ...safeDetails(details),
    }
    write(record)
    const bucketName = ALERT_RULES.get(`${record.event}:${record.outcome}`)
    if (bucketName) observe(bucketName)
    return record
  }

  async function checkDisk() {
    try {
      const stats = await diskStats(config.storageRoot)
      const freeBytes = Number(stats.bavail) * Number(stats.bsize)
      if (Number.isFinite(freeBytes) && freeBytes < config.diskMinFreeBytes) {
        await triggerAlert('diskLow', { freeBytes, thresholdBytes: config.diskMinFreeBytes })
      }
    } catch (error) {
      audit('disk_space_check', null, 'failed', {
        reason: typeof error?.code === 'string' ? error.code : 'disk_check_failed',
      })
    }
  }

  function startDiskMonitoring() {
    void checkDisk()
    const timer = setInterval(() => void checkDisk(), config.diskCheckMinutes * 60 * 1000)
    timer.unref()
    return timer
  }

  return { audit, checkDisk, ipTag, observeProxy, startDiskMonitoring, triggerAlert }
}
