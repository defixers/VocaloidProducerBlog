import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { createSecurityMonitor } from '../server/security/audit.js'
import { postSecureWebhook, validateUpstreamUrl } from '../server/security/upstream.js'

const envFile = resolve('.env')
if (existsSync(envFile)) loadEnvFile(envFile)

const webhookUrl = process.env.SECURITY_ALERT_WEBHOOK_URL || ''
const allowedHosts = new Set((process.env.SECURITY_ALERT_WEBHOOK_HOSTS || '')
  .split(',').map((host) => host.trim().toLowerCase()).filter(Boolean))
if (!webhookUrl || !allowedHosts.size) {
  throw new Error('SECURITY_ALERT_WEBHOOK_URL and SECURITY_ALERT_WEBHOOK_HOSTS are required.')
}
validateUpstreamUrl(webhookUrl, allowedHosts)

const timeoutSeconds = Number(process.env.SECURITY_ALERT_TIMEOUT_SECONDS || 5)
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0.1 || timeoutSeconds > 60) {
  throw new Error('SECURITY_ALERT_TIMEOUT_SECONDS must be between 0.1 and 60.')
}

const monitor = createSecurityMonitor({
  ipKey: 'manual-test-alert-does-not-process-an-ip',
  storageRoot: '.',
  windowMinutes: 10,
  cooldownMinutes: 0,
  proxyMinRequests: 1,
  proxyFailureRate: 1,
  diskMinFreeBytes: 1,
  diskCheckMinutes: 5,
  thresholds: {},
}, {
  deliverAlert: (alert) => postSecureWebhook(webhookUrl, alert, {
    allowedHosts,
    timeoutMs: timeoutSeconds * 1000,
  }),
})

await monitor.triggerAlert('test', { reason: 'manual_delivery_test' }, { throwDeliveryError: true })
console.log('Security test alert delivered successfully.')
