import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  appendFile, chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir,
  rename, rm, stat, unlink, writeFile,
} from 'node:fs/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAGIC = Buffer.from('VPBACK01', 'ascii')
const NONCE_BYTES = 12
const TAG_BYTES = 16
const BACKUP_PATTERN = /^vpb-backup-\d{8}T\d{6}Z-[a-f0-9]{8}\.vpb$/

function jsonLine(level, event, outcome, details = {}) {
  return JSON.stringify({ level, time: new Date().toISOString(), event, outcome, ...details })
}

export function reportBackupFailure(event, error) {
  const reason = typeof error?.code === 'string' ? error.code : 'backup_operation_failed'
  console.error(jsonLine('security_alert', event, 'failed', { reason }))
}

export function readBackupKey(value) {
  const raw = String(value || '').trim()
  let key
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex')
  else {
    try {
      key = Buffer.from(raw, 'base64')
    } catch {
      key = Buffer.alloc(0)
    }
  }
  if (key.length !== 32) throw Object.assign(new Error('Backup key must be 32 bytes encoded as hex or base64.'), { code: 'invalid_backup_key' })
  return key
}

export async function readBackupKeyFile(path) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw Object.assign(new Error('Backup key path is not a regular file.'), { code: 'invalid_backup_key_file' })
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    throw Object.assign(new Error('Backup key file permissions must be 0600 or stricter.'), { code: 'insecure_backup_key_permissions' })
  }
  if (process.platform !== 'win32' && process.geteuid && info.uid !== process.geteuid()) {
    throw Object.assign(new Error('Backup key file must be owned by the backup process user.'), { code: 'invalid_backup_key_owner' })
  }
  return readBackupKey(await readFile(path, 'utf8'))
}

async function sha256File(path) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function safeRelativePath(value) {
  return value && !value.includes('\\') && !value.startsWith('/')
    && !value.split('/').some((part) => !part || part === '.' || part === '..')
}

async function copyTree(source, target, prefix, entries) {
  const sourceInfo = await lstat(source)
  if (!sourceInfo.isDirectory()) throw Object.assign(new Error(`${source} is not a directory.`), { code: 'invalid_backup_source' })
  await mkdir(target, { recursive: true, mode: 0o700 })
  const children = await readdir(source, { withFileTypes: true })
  children.sort((left, right) => left.name.localeCompare(right.name))
  for (const child of children) {
    const sourcePath = join(source, child.name)
    const targetPath = join(target, child.name)
    const archivePath = `${prefix}/${child.name}`.replaceAll('\\', '/')
    if (child.isSymbolicLink()) throw Object.assign(new Error(`Symbolic link rejected: ${sourcePath}`), { code: 'backup_symlink_rejected' })
    if (child.isDirectory()) {
      await copyTree(sourcePath, targetPath, archivePath, entries)
      continue
    }
    if (!child.isFile()) throw Object.assign(new Error(`Unsupported file type: ${sourcePath}`), { code: 'unsupported_backup_file' })
    await copyFile(sourcePath, targetPath)
    await chmod(targetPath, 0o600)
    const info = await stat(targetPath)
    entries.push({ path: archivePath, size: info.size, sha256: await sha256File(targetPath) })
  }
}

async function encryptFile(input, output, key) {
  const nonce = crypto.randomBytes(NONCE_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
  await writeFile(output, Buffer.concat([MAGIC, nonce]), { mode: 0o600 })
  await pipeline(createReadStream(input), cipher, createWriteStream(output, { flags: 'a', mode: 0o600 }))
  await appendFile(output, cipher.getAuthTag())
}

async function decryptFile(input, output, key) {
  const inputInfo = await stat(input)
  const headerBytes = MAGIC.length + NONCE_BYTES
  if (inputInfo.size <= headerBytes + TAG_BYTES) throw Object.assign(new Error('Backup is truncated.'), { code: 'invalid_backup_format' })
  const handle = await open(input, 'r')
  try {
    const header = Buffer.alloc(headerBytes)
    const tag = Buffer.alloc(TAG_BYTES)
    await handle.read(header, 0, header.length, 0)
    await handle.read(tag, 0, tag.length, inputInfo.size - TAG_BYTES)
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw Object.assign(new Error('Backup format is invalid.'), { code: 'invalid_backup_format' })
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length))
    decipher.setAuthTag(tag)
    await pipeline(
      createReadStream(input, { start: headerBytes, end: inputInfo.size - TAG_BYTES - 1 }),
      decipher,
      createWriteStream(output, { mode: 0o600 }),
    )
  } catch (error) {
    if (error?.code === 'ERR_CRYPTO_INVALID_AUTH_TAG' || /authenticat/i.test(error?.message || '')) {
      throw Object.assign(new Error('Backup authentication failed.'), { code: 'backup_authentication_failed' })
    }
    throw error
  } finally {
    await handle.close()
  }
}

async function runTar(command, args) {
  try {
    await execFileAsync(command, args, { windowsHide: true, timeout: 60 * 60 * 1000, maxBuffer: 1024 * 1024 })
  } catch (error) {
    throw Object.assign(new Error('Archive command failed.'), { code: 'archive_command_failed', cause: error })
  }
}

function backupName(date = new Date()) {
  const timestamp = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `vpb-backup-${timestamp}-${crypto.randomBytes(4).toString('hex')}.vpb`
}

async function replicateFiles(command, args, files) {
  if (!command) return false
  if (!Array.isArray(args) || !args.length || !args.some((value) => value.includes('{file}'))) {
    throw Object.assign(new Error('Replica arguments must be a non-empty JSON array containing {file}.'), { code: 'invalid_replica_arguments' })
  }
  for (const file of files) {
    const replacements = { '{file}': file, '{name}': basename(file) }
    const resolvedArgs = args.map((value) => {
      let result = value
      for (const [token, replacement] of Object.entries(replacements)) result = result.replaceAll(token, replacement)
      return result
    })
    try {
      await execFileAsync(command, resolvedArgs, { windowsHide: true, timeout: 60 * 60 * 1000, maxBuffer: 1024 * 1024 })
    } catch (error) {
      throw Object.assign(new Error('Off-site replication failed.'), { code: 'backup_replication_failed', cause: error })
    }
  }
  return true
}

async function pruneLocalBackups(directory, retentionDays, now = Date.now()) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
  const children = await readdir(directory, { withFileTypes: true })
  const backups = []
  for (const child of children) {
    if (!child.isFile() || !BACKUP_PATTERN.test(child.name)) continue
    const path = join(directory, child.name)
    backups.push({ path, name: child.name, mtimeMs: (await stat(path)).mtimeMs })
  }
  backups.sort((left, right) => right.mtimeMs - left.mtimeMs)
  for (const backup of backups.slice(1).filter((item) => item.mtimeMs < cutoff)) {
    await unlink(backup.path)
    await unlink(`${backup.path}.sha256`).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
  }
}

export async function createBackup({
  storageRoot,
  envFile,
  backupDir,
  key,
  tarCommand = 'tar',
  retentionDays = 14,
  replicaCommand = '',
  replicaArgs = [],
  requireReplica = false,
  now = new Date(),
}) {
  const resolvedStorage = resolve(storageRoot)
  const resolvedBackup = resolve(backupDir)
  if (resolvedBackup === resolvedStorage || resolvedBackup.startsWith(`${resolvedStorage}${sep}`)) {
    throw Object.assign(new Error('Backup directory must be outside the application storage root.'), { code: 'unsafe_backup_directory' })
  }
  if (requireReplica && !replicaCommand) throw Object.assign(new Error('Off-site replication is required.'), { code: 'backup_replica_required' })
  await mkdir(resolvedBackup, { recursive: true, mode: 0o700 })
  const backupDirectoryInfo = await stat(resolvedBackup)
  if (!backupDirectoryInfo.isDirectory()
    || process.platform !== 'win32' && (backupDirectoryInfo.mode & 0o077) !== 0) {
    throw Object.assign(new Error('Backup directory permissions must be 0700 or stricter.'), { code: 'insecure_backup_directory' })
  }
  if (process.platform !== 'win32' && process.geteuid && backupDirectoryInfo.uid !== process.geteuid()) {
    throw Object.assign(new Error('Backup directory must be owned by the backup process user.'), { code: 'invalid_backup_directory_owner' })
  }
  const work = await mkdtemp(join(tmpdir(), 'vpb-backup-'))
  const name = backupName(now)
  const finalPath = join(resolvedBackup, name)
  const temporaryBackup = join(resolvedBackup, `.${name}.tmp`)
  try {
    const snapshot = join(work, 'snapshot')
    let manifest
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await rm(snapshot, { recursive: true, force: true })
      const entries = []
      const sourceContentPath = join(resolvedStorage, 'data', 'content.json')
      const contentHashBefore = await sha256File(sourceContentPath)
      try {
        await mkdir(join(snapshot, 'config'), { recursive: true, mode: 0o700 })
        await copyTree(join(resolvedStorage, 'data'), join(snapshot, 'data'), 'data', entries)
        await copyTree(join(resolvedStorage, 'uploads'), join(snapshot, 'uploads'), 'uploads', entries)
        if (await sha256File(sourceContentPath) !== contentHashBefore) {
          throw Object.assign(new Error('Content changed while the snapshot was being copied.'), { code: 'backup_snapshot_changed' })
        }
        const envTarget = join(snapshot, 'config', 'app.env')
        const envInfo = await lstat(envFile)
        if (!envInfo.isFile() || envInfo.isSymbolicLink()) throw Object.assign(new Error('Environment file is invalid.'), { code: 'invalid_backup_env_file' })
        await copyFile(envFile, envTarget)
        await chmod(envTarget, 0o600)
        entries.push({ path: 'config/app.env', size: (await stat(envTarget)).size, sha256: await sha256File(envTarget) })
        entries.sort((left, right) => left.path.localeCompare(right.path))
        const content = JSON.parse(await readFile(join(snapshot, 'data', 'content.json'), 'utf8'))
        manifest = {
          schema: 1,
          createdAt: now.toISOString(),
          contentVersion: Number.isInteger(content.version) ? content.version : null,
          entries,
        }
        await writeFile(join(snapshot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
        await validateSnapshot(snapshot)
        break
      } catch (error) {
        const retryable = ['ENOENT', 'backup_snapshot_changed', 'missing_restored_resource', 'restored_resource_size_mismatch'].includes(error?.code)
        if (!retryable || attempt === 3) throw error
      }
    }
    const tarPath = join(work, 'snapshot.tar')
    await runTar(tarCommand, ['-cf', tarPath, '-C', snapshot, '.'])
    await encryptFile(tarPath, temporaryBackup, key)
    await rename(temporaryBackup, finalPath)
    const encryptedHash = await sha256File(finalPath)
    const checksumPath = `${finalPath}.sha256`
    await writeFile(checksumPath, `${encryptedHash}  ${name}\n`, { mode: 0o600 })
    const replicated = await replicateFiles(replicaCommand, replicaArgs, [finalPath, checksumPath])
    if (requireReplica && !replicated) throw Object.assign(new Error('Off-site replication was not completed.'), { code: 'backup_replica_required' })
    await pruneLocalBackups(resolvedBackup, retentionDays, now.valueOf())
    return { path: finalPath, checksumPath, encryptedHash, replicated, entries: manifest.entries.length, createdAt: manifest.createdAt }
  } finally {
    await rm(work, { recursive: true, force: true })
    await rm(temporaryBackup, { force: true })
  }
}

async function verifyAdjacentChecksum(backupPath) {
  const checksumPath = `${backupPath}.sha256`
  const value = (await readFile(checksumPath, 'utf8')).trim()
  const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(value)
  if (!match || match[2] !== basename(backupPath)) throw Object.assign(new Error('Backup checksum file is invalid.'), { code: 'invalid_backup_checksum' })
  const actual = await sha256File(backupPath)
  if (!crypto.timingSafeEqual(Buffer.from(match[1], 'hex'), Buffer.from(actual, 'hex'))) {
    throw Object.assign(new Error('Backup checksum does not match.'), { code: 'backup_checksum_mismatch' })
  }
  return actual
}

async function validateSnapshot(snapshot) {
  const manifest = JSON.parse(await readFile(join(snapshot, 'manifest.json'), 'utf8'))
  if (manifest?.schema !== 1 || !Array.isArray(manifest.entries) || !manifest.entries.length) {
    throw Object.assign(new Error('Backup manifest is invalid.'), { code: 'invalid_backup_manifest' })
  }
  const seen = new Set()
  for (const entry of manifest.entries) {
    if (!safeRelativePath(entry?.path) || seen.has(entry.path)
      || !/^(data|uploads)\//.test(entry.path) && entry.path !== 'config/app.env'
      || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256 || '')) {
      throw Object.assign(new Error('Backup manifest entry is invalid.'), { code: 'invalid_backup_manifest' })
    }
    seen.add(entry.path)
    const path = join(snapshot, ...entry.path.split('/'))
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.size || await sha256File(path) !== entry.sha256) {
      throw Object.assign(new Error(`Backup file verification failed: ${entry.path}`), { code: 'backup_file_verification_failed' })
    }
  }
  if (!seen.has('data/content.json') || !seen.has('config/app.env')) {
    throw Object.assign(new Error('Backup is missing required files.'), { code: 'incomplete_backup' })
  }
  const content = JSON.parse(await readFile(join(snapshot, 'data', 'content.json'), 'utf8'))
  if (!Array.isArray(content.resources) || !Array.isArray(content.articles)) {
    throw Object.assign(new Error('Restored content file is invalid.'), { code: 'invalid_restored_content' })
  }
  for (const resource of content.resources) {
    const stored = String(resource.storagePath || '')
    if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(stored)) {
      throw Object.assign(new Error('Restored resource path is invalid.'), { code: 'invalid_restored_resource' })
    }
    const archivePath = `uploads/${basename(stored)}`
    if (!seen.has(archivePath)) throw Object.assign(new Error(`Restored resource is missing: ${resource.id || 'unknown'}`), { code: 'missing_restored_resource' })
    if (Number.isSafeInteger(resource.size)) {
      const entry = manifest.entries.find((item) => item.path === archivePath)
      if (entry.size !== resource.size) throw Object.assign(new Error(`Restored resource size differs: ${resource.id || 'unknown'}`), { code: 'restored_resource_size_mismatch' })
    }
  }
  return manifest
}

async function directoryIsEmpty(path) {
  try {
    return (await readdir(path)).length === 0
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    throw error
  }
}

export async function restoreBackup({ backupPath, targetRoot, envOutput, key, tarCommand = 'tar', verifyOnly = false }) {
  await verifyAdjacentChecksum(backupPath)
  const work = await mkdtemp(join(tmpdir(), 'vpb-restore-'))
  try {
    const tarPath = join(work, 'snapshot.tar')
    const snapshot = join(work, 'snapshot')
    await mkdir(snapshot, { mode: 0o700 })
    await decryptFile(backupPath, tarPath, key)
    await runTar(tarCommand, ['-xf', tarPath, '-C', snapshot])
    const manifest = await validateSnapshot(snapshot)
    if (!verifyOnly) {
      if (!await directoryIsEmpty(targetRoot)) throw Object.assign(new Error('Restore target must be empty.'), { code: 'restore_target_not_empty' })
      try {
        await lstat(envOutput)
        throw Object.assign(new Error('Environment output already exists.'), { code: 'restore_env_exists' })
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      await mkdir(targetRoot, { recursive: true, mode: 0o750 })
      await copyTree(join(snapshot, 'data'), join(targetRoot, 'data'), 'data', [])
      await copyTree(join(snapshot, 'uploads'), join(targetRoot, 'uploads'), 'uploads', [])
      await mkdir(dirname(envOutput), { recursive: true, mode: 0o700 })
      await copyFile(join(snapshot, 'config', 'app.env'), envOutput)
      await chmod(envOutput, 0o600)
    }
    return { manifest, verifiedFiles: manifest.entries.length, contentVersion: manifest.contentVersion }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

export async function newestBackup(directory) {
  const children = await readdir(directory, { withFileTypes: true })
  const candidates = []
  for (const child of children) {
    if (!child.isFile() || !BACKUP_PATTERN.test(child.name)) continue
    const path = join(directory, child.name)
    candidates.push({ path, mtimeMs: (await stat(path)).mtimeMs })
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
  if (!candidates.length) throw Object.assign(new Error('No backup was found.'), { code: 'backup_not_found' })
  return candidates[0].path
}

export function parseJsonArray(value, name) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new Error()
    return parsed
  } catch {
    throw Object.assign(new Error(`${name} must be a JSON string array.`), { code: 'invalid_backup_configuration' })
  }
}
