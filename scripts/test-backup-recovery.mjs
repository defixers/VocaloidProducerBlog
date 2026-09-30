import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBackup, readBackupKey, restoreBackup } from './lib/backup.mjs'

const root = await mkdtemp(join(tmpdir(), 'vpb-backup-test-'))
try {
  const storageRoot = join(root, 'storage')
  const backupDir = join(root, 'backups')
  const replicaDir = join(root, 'replica')
  const envFile = join(root, '.env')
  const uploadName = 'resource.mid'
  const upload = Buffer.from('MThd\x00\x00\x00\x06\x00\x00\x00\x01\x00\x60', 'binary')
  await mkdir(join(storageRoot, 'data'), { recursive: true })
  await mkdir(join(storageRoot, 'uploads'), { recursive: true })
  await writeFile(join(storageRoot, 'uploads', uploadName), upload)
  await writeFile(join(storageRoot, 'data', 'content.json'), `${JSON.stringify({
    version: 7,
    articles: [],
    resources: [{ id: crypto.randomUUID(), storagePath: `/uploads/${uploadName}`, size: upload.length }],
  })}\n`)
  await writeFile(envFile, 'ADMIN_PASSWORD_HASH=encrypted-inside-backup\n')
  const key = readBackupKey(crypto.randomBytes(32).toString('hex'))
  const replicaScript = new URL('./fixtures/copy-backup.mjs', import.meta.url).pathname.replace(/^\/(.:\/)/, '$1')
  await mkdir(backupDir, { recursive: true, mode: 0o700 })
  const expiredBackup = join(backupDir, 'vpb-backup-20260801T000000Z-deadbeef.vpb')
  await writeFile(expiredBackup, 'expired')
  await writeFile(`${expiredBackup}.sha256`, 'expired')
  const expiredAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
  await utimes(expiredBackup, expiredAt, expiredAt)
  const backup = await createBackup({
    storageRoot,
    envFile,
    backupDir,
    key,
    retentionDays: 14,
    replicaCommand: process.execPath,
    replicaArgs: [replicaScript, '{file}', join(replicaDir, '{name}')],
    requireReplica: true,
  })
  assert.equal(backup.replicated, true)
  await assert.rejects(stat(expiredBackup), (error) => error.code === 'ENOENT')
  await assert.rejects(stat(`${expiredBackup}.sha256`), (error) => error.code === 'ENOENT')
  assert.equal((await readFile(join(replicaDir, backup.path.split(/[\\/]/).at(-1)))).length > 0, true)
  assert.match(await readFile(backup.checksumPath, 'utf8'), /^[a-f0-9]{64}  vpb-backup-/)

  const restoredRoot = join(root, 'restored')
  const restoredEnv = join(root, 'restored-config', '.env')
  const restored = await restoreBackup({ backupPath: backup.path, targetRoot: restoredRoot, envOutput: restoredEnv, key })
  assert.equal(restored.contentVersion, 7)
  assert.deepEqual(await readFile(join(restoredRoot, 'uploads', uploadName)), upload)
  assert.equal(await readFile(restoredEnv, 'utf8'), 'ADMIN_PASSWORD_HASH=encrypted-inside-backup\n')

  await assert.rejects(
    restoreBackup({ backupPath: backup.path, targetRoot: restoredRoot, envOutput: join(root, 'other.env'), key }),
    (error) => error.code === 'restore_target_not_empty',
  )

  const tampered = join(backupDir, 'vpb-backup-20260930T000000Z-deadbeef.vpb')
  await copyFile(backup.path, tampered)
  await copyFile(backup.checksumPath, `${tampered}.sha256`)
  const originalChecksum = await readFile(`${tampered}.sha256`, 'utf8')
  await writeFile(`${tampered}.sha256`, originalChecksum.replace(backup.path.split(/[\\/]/).at(-1), tampered.split(/[\\/]/).at(-1)))
  const bytes = await readFile(tampered)
  bytes[Math.floor(bytes.length / 2)] ^= 0xff
  await writeFile(tampered, bytes)
  await assert.rejects(
    restoreBackup({ backupPath: tampered, targetRoot: join(root, 'tampered'), envOutput: join(root, 'tampered.env'), key }),
    (error) => error.code === 'backup_checksum_mismatch',
  )

  await assert.rejects(
    restoreBackup({ backupPath: backup.path, targetRoot: join(root, 'wrong-key'), envOutput: join(root, 'wrong.env'), key: crypto.randomBytes(32) }),
    (error) => error.code === 'backup_authentication_failed',
  )

  const invalidStorage = join(root, 'invalid-storage')
  await mkdir(join(invalidStorage, 'data'), { recursive: true })
  await mkdir(join(invalidStorage, 'uploads'), { recursive: true })
  await writeFile(join(invalidStorage, 'data', 'content.json'), `${JSON.stringify({
    version: 1,
    articles: [],
    resources: [{ id: crypto.randomUUID(), storagePath: '/uploads/missing.mid', size: 10 }],
  })}\n`)
  await assert.rejects(
    createBackup({ storageRoot: invalidStorage, envFile, backupDir: join(root, 'invalid-backups'), key }),
    (error) => error.code === 'missing_restored_resource',
  )
  console.log('Backup and recovery tests passed.')
} finally {
  await rm(root, { recursive: true, force: true })
}
