import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { newestBackup, readBackupKeyFile, reportBackupFailure, restoreBackup } from './lib/backup.mjs'

const root = resolve(process.env.BACKUP_APP_ROOT || resolve(import.meta.dirname, '..'))
const envFile = resolve(root, '.env')
if (existsSync(envFile)) loadEnvFile(envFile)

function argument(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? '' : process.argv[index + 1] || ''
}

try {
  if (!process.env.BACKUP_ENCRYPTION_KEY_FILE) throw Object.assign(new Error('BACKUP_ENCRYPTION_KEY_FILE is required.'), { code: 'missing_backup_key_file' })
  const backupDir = resolve(process.env.BACKUP_LOCAL_DIR || resolve(root, '.backups'))
  const suppliedBackup = argument('--backup')
  const backupPath = suppliedBackup ? resolve(suppliedBackup) : await newestBackup(backupDir)
  const targetRoot = argument('--target')
  const envOutput = argument('--env-output')
  if (!targetRoot || !envOutput) {
    throw Object.assign(new Error('Usage: npm run backup:restore -- --backup <file> --target <empty-directory> --env-output <new-env-file>'), { code: 'invalid_restore_arguments' })
  }
  const result = await restoreBackup({
    backupPath,
    targetRoot: resolve(targetRoot),
    envOutput: resolve(envOutput),
    key: await readBackupKeyFile(resolve(process.env.BACKUP_ENCRYPTION_KEY_FILE)),
    tarCommand: process.env.BACKUP_TAR_COMMAND || 'tar',
  })
  console.log(JSON.stringify({
    level: 'security',
    time: new Date().toISOString(),
    event: 'backup_restore',
    outcome: 'succeeded',
    backup: backupPath,
    verifiedFiles: result.verifiedFiles,
    contentVersion: result.contentVersion,
  }))
} catch (error) {
  reportBackupFailure('backup_restore', error)
  throw error
}
