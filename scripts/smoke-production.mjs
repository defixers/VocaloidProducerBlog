import { runProductionSmoke, smokeConfiguration } from './lib/production-smoke.mjs'

try {
  const result = await runProductionSmoke(smokeConfiguration())
  console.log(JSON.stringify({ outcome: 'succeeded', ...result }))
} catch (error) {
  console.error(JSON.stringify({
    outcome: 'failed',
    reason: error?.code || 'production_smoke_failed',
    message: error?.message || 'Production smoke check failed.',
  }))
  process.exitCode = 1
}
