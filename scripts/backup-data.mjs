import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { createBackup, parseJsonArray, readBackupKeyFile, reportBackupFailure } from './lib/backup.mjs'

const root = resolve(process.env.BACKUP_APP_ROOT || resolve(import.meta.dirname, '..'))
const envFile = resolve(root, '.env')
if (existsSync(envFile)) loadEnvFile(envFile)

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isSafeInteger(value) || value < 1) throw Object.assign(new Error(`${name} must be a positive integer.`), { code: 'invalid_backup_configuration' })
  return value
}

function booleanValue(name, fallback) {
  const raw = String(process.env[name] ?? fallback).toLowerCase()
  if (!['true', 'false'].includes(raw)) throw Object.assign(new Error(`${name} must be true or false.`), { code: 'invalid_backup_configuration' })
  return raw === 'true'
}

try {
  const keyFile = resolve(process.env.BACKUP_ENCRYPTION_KEY_FILE || '')
  if (!process.env.BACKUP_ENCRYPTION_KEY_FILE) throw Object.assign(new Error('BACKUP_ENCRYPTION_KEY_FILE is required.'), { code: 'missing_backup_key_file' })
  const result = await createBackup({
    storageRoot: resolve(process.env.APP_STORAGE_ROOT || resolve(root, 'server')),
    envFile,
    backupDir: resolve(process.env.BACKUP_LOCAL_DIR || resolve(root, '.backups')),
    key: await readBackupKeyFile(keyFile),
    tarCommand: process.env.BACKUP_TAR_COMMAND || 'tar',
    retentionDays: positiveInteger('BACKUP_RETENTION_DAYS', 14),
    replicaCommand: process.env.BACKUP_REPLICA_COMMAND || '',
    replicaArgs: parseJsonArray(process.env.BACKUP_REPLICA_ARGS, 'BACKUP_REPLICA_ARGS'),
    requireReplica: booleanValue('BACKUP_REQUIRE_REPLICA', 'true'),
  })
  console.log(JSON.stringify({
    level: 'security',
    time: new Date().toISOString(),
    event: 'backup_create',
    outcome: 'succeeded',
    backup: result.path,
    checksum: result.encryptedHash,
    replicated: result.replicated,
    entries: result.entries,
  }))
} catch (error) {
  reportBackupFailure('backup_create', error)
  throw error
}
