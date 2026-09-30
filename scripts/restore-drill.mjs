import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { tmpdir } from 'node:os'
import { newestBackup, readBackupKeyFile, reportBackupFailure, restoreBackup } from './lib/backup.mjs'

const root = resolve(process.env.BACKUP_APP_ROOT || resolve(import.meta.dirname, '..'))
const envFile = resolve(root, '.env')
if (existsSync(envFile)) loadEnvFile(envFile)
const startedAt = new Date()
const backupDir = resolve(process.env.BACKUP_LOCAL_DIR || resolve(root, '.backups'))
const drillLogDir = resolve(process.env.BACKUP_DRILL_LOG_DIR || join(backupDir, 'drills'))
let work
let backupName = 'unknown'

async function writeDrillRecord(record) {
  await mkdir(drillLogDir, { recursive: true, mode: 0o700 })
  const timestamp = record.finishedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  await writeFile(join(drillLogDir, `restore-drill-${timestamp}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
}

try {
  if (!process.env.BACKUP_ENCRYPTION_KEY_FILE) throw Object.assign(new Error('BACKUP_ENCRYPTION_KEY_FILE is required.'), { code: 'missing_backup_key_file' })
  const backupPath = await newestBackup(backupDir)
  backupName = basename(backupPath)
  work = await mkdtemp(join(tmpdir(), 'vpb-drill-'))
  const result = await restoreBackup({
    backupPath,
    targetRoot: join(work, 'storage'),
    envOutput: join(work, 'config', '.env'),
    key: await readBackupKeyFile(resolve(process.env.BACKUP_ENCRYPTION_KEY_FILE)),
    tarCommand: process.env.BACKUP_TAR_COMMAND || 'tar',
  })
  const finishedAt = new Date()
  const durationSeconds = Math.round((finishedAt - startedAt) / 10) / 100
  if (durationSeconds > 7_200) {
    throw Object.assign(new Error('Restore drill exceeded the two-hour RTO.'), { code: 'restore_drill_rto_exceeded' })
  }
  const record = {
    schema: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSeconds,
    outcome: 'succeeded',
    backup: backupName,
    verifiedFiles: result.verifiedFiles,
    contentVersion: result.contentVersion,
    issues: [],
  }
  await writeDrillRecord(record)
  console.log(JSON.stringify({ level: 'security', event: 'backup_restore_drill', ...record }))
} catch (error) {
  const finishedAt = new Date()
  const reason = typeof error?.code === 'string' ? error.code : 'backup_operation_failed'
  await writeDrillRecord({
    schema: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSeconds: Math.round((finishedAt - startedAt) / 10) / 100,
    outcome: 'failed',
    backup: backupName,
    verifiedFiles: 0,
    contentVersion: null,
    issues: [reason],
  }).catch(() => {})
  reportBackupFailure('backup_restore_drill', error)
  throw error
} finally {
  if (work) await rm(work, { recursive: true, force: true })
}
