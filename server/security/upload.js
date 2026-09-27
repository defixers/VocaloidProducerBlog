import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import { TextDecoder } from 'node:util'

const dangerousExtensions = new Set([
  '.apk', '.app', '.bat', '.cmd', '.com', '.cpl', '.dll', '.exe', '.hta',
  '.htm', '.html', '.jar', '.js', '.mjs', '.msi', '.php', '.phtml', '.ps1',
  '.scr', '.sh', '.svg', '.vbs', '.wasm',
])

const archiveExtensions = new Set(['.zip', '.7z', '.rar'])

const uploadTypes = {
  '.mid': {
    mime: ['audio/midi', 'audio/x-midi', 'application/x-midi', 'application/octet-stream'],
    signature: (bytes) => bytes.subarray(0, 4).equals(Buffer.from('MThd')),
  },
  '.midi': {
    mime: ['audio/midi', 'audio/x-midi', 'application/x-midi', 'application/octet-stream'],
    signature: (bytes) => bytes.subarray(0, 4).equals(Buffer.from('MThd')),
  },
  '.wav': {
    mime: ['audio/wav', 'audio/wave', 'audio/x-wav', 'application/octet-stream'],
    signature: (bytes) => bytes.subarray(0, 4).equals(Buffer.from('RIFF')) && bytes.subarray(8, 12).equals(Buffer.from('WAVE')),
  },
  '.mp3': {
    mime: ['audio/mpeg', 'audio/mp3', 'application/octet-stream'],
    signature: (bytes) => bytes.subarray(0, 3).equals(Buffer.from('ID3')) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0),
  },
  '.flac': {
    mime: ['audio/flac', 'audio/x-flac', 'application/octet-stream'],
    signature: (bytes) => bytes.subarray(0, 4).equals(Buffer.from('fLaC')),
  },
  '.zip': {
    mime: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
    signature: (bytes) => bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]) && [0x04, 0x06, 0x08].includes(bytes[3]),
  },
  '.7z': {
    mime: ['application/x-7z-compressed', 'application/octet-stream'],
    signature: (bytes) => bytes.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])),
  },
  '.rar': {
    mime: ['application/vnd.rar', 'application/x-rar-compressed', 'application/octet-stream'],
    signature: (bytes) => bytes.subarray(0, 7).equals(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]))
      || bytes.subarray(0, 8).equals(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])),
  },
  '.png': {
    mime: ['image/png'],
    signature: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  '.jpg': {
    mime: ['image/jpeg'],
    signature: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  '.jpeg': {
    mime: ['image/jpeg'],
    signature: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  '.webp': {
    mime: ['image/webp'],
    signature: (bytes) => bytes.subarray(0, 4).equals(Buffer.from('RIFF')) && bytes.subarray(8, 12).equals(Buffer.from('WEBP')),
  },
  '.pdf': {
    mime: ['application/pdf'],
    signature: (bytes) => bytes.subarray(0, 5).equals(Buffer.from('%PDF-')),
  },
  '.psd': {
    mime: ['image/vnd.adobe.photoshop', 'application/x-photoshop', 'application/octet-stream'],
    signature: (bytes) => bytes.subarray(0, 4).equals(Buffer.from('8BPS')),
  },
  '.txt': {
    mime: ['text/plain'],
    signature: isPlainText,
  },
}

export const allowedUploadExtensions = new Set(Object.keys(uploadTypes))

export function uploadContentType(extension) {
  return uploadTypes[extension]?.mime[0] || 'application/octet-stream'
}

export class UploadSecurityError extends Error {
  constructor(code, clientMessage, status = 422) {
    super(code)
    this.name = 'UploadSecurityError'
    this.code = code
    this.clientMessage = clientMessage
    this.status = status
  }
}

function isPlainText(bytes) {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return false
  }
  let controls = 0
  for (const byte of bytes) {
    if (byte < 0x20 && ![0x09, 0x0a, 0x0d].includes(byte)) controls += 1
  }
  return controls <= Math.max(1, Math.floor(bytes.length * 0.01))
}

function normalizedMime(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase()
}

export function validateUploadMetadata(file) {
  const filename = String(file.originalname || '')
  const extension = extname(filename).toLowerCase()
  const type = uploadTypes[extension]
  if (!type) throw new UploadSecurityError('unsupported_extension', '不支持的文件类型', 400)
  if (!filename || filename.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(filename)) {
    throw new UploadSecurityError('invalid_filename', '文件名无效', 400)
  }

  const earlierExtensions = filename.slice(0, -extension.length).toLowerCase().match(/\.[a-z0-9]+/g) || []
  if (earlierExtensions.some((item) => dangerousExtensions.has(item))) {
    throw new UploadSecurityError('dangerous_double_extension', '文件名包含高风险双扩展名', 400)
  }

  const mime = normalizedMime(file.mimetype)
  if (!type.mime.includes(mime)) {
    throw new UploadSecurityError('mime_mismatch', '文件 MIME 类型与扩展名不匹配', 400)
  }
  return { extension, mime }
}

export async function inspectUpload(filePath, extension, archiveLimits) {
  const handle = await open(filePath, 'r')
  try {
    const sample = Buffer.alloc(16 * 1024)
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0)
    const bytes = sample.subarray(0, bytesRead)
    const type = uploadTypes[extension]
    if (!type?.signature(bytes)) {
      throw new UploadSecurityError('signature_mismatch', '文件内容与扩展名不匹配')
    }
    if (extension === '.zip') await inspectZip(handle, archiveLimits)
  } finally {
    await handle.close()
  }
}

export function requiresVirusScan(extension) {
  return archiveExtensions.has(extension)
}

async function inspectZip(handle, limits) {
  const fileSize = (await handle.stat()).size
  const tailLength = Math.min(fileSize, 65_557)
  const tail = Buffer.alloc(tailLength)
  await handle.read(tail, 0, tailLength, fileSize - tailLength)
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  const eocd = tail.lastIndexOf(eocdSignature)
  if (eocd < 0 || eocd + 22 > tail.length) {
    throw new UploadSecurityError('invalid_zip_directory', 'ZIP 文件结构无效')
  }

  const entryCount = tail.readUInt16LE(eocd + 10)
  const centralSize = tail.readUInt32LE(eocd + 12)
  const centralOffset = tail.readUInt32LE(eocd + 16)
  const commentLength = tail.readUInt16LE(eocd + 20)
  if (eocd + 22 + commentLength !== tail.length) {
    throw new UploadSecurityError('invalid_zip_directory', 'ZIP 文件结构无效')
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new UploadSecurityError('zip64_unsupported', '暂不支持 ZIP64 压缩包')
  }
  if (entryCount > limits.maxFiles || centralSize > 16 * 1024 * 1024 || centralOffset + centralSize > fileSize) {
    throw new UploadSecurityError('archive_limits_exceeded', '压缩包文件数量或目录大小超过限制')
  }

  const central = Buffer.alloc(centralSize)
  await handle.read(central, 0, centralSize, centralOffset)
  let cursor = 0
  let totalCompressed = 0
  let totalUncompressed = 0
  let parsedEntries = 0
  while (cursor < central.length) {
    if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) {
      throw new UploadSecurityError('invalid_zip_directory', 'ZIP 文件结构无效')
    }
    const flags = central.readUInt16LE(cursor + 8)
    const compressionMethod = central.readUInt16LE(cursor + 10)
    const compressedSize = central.readUInt32LE(cursor + 20)
    const uncompressedSize = central.readUInt32LE(cursor + 24)
    const nameLength = central.readUInt16LE(cursor + 28)
    const extraLength = central.readUInt16LE(cursor + 30)
    const commentLength = central.readUInt16LE(cursor + 32)
    const externalAttributes = central.readUInt32LE(cursor + 38)
    const localOffset = central.readUInt32LE(cursor + 42)
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength
    if (entryEnd > central.length || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new UploadSecurityError('invalid_zip_directory', 'ZIP 文件结构无效')
    }
    if (flags & 0x1) throw new UploadSecurityError('encrypted_archive', '不接受加密压缩包')

    const nameBytes = central.subarray(cursor + 46, cursor + 46 + nameLength)
    const name = (flags & 0x800 ? nameBytes.toString('utf8') : nameBytes.toString('latin1')).replaceAll('\\', '/')
    const pathParts = name.split('/').filter(Boolean)
    const entryExtension = extname(name).toLowerCase()
    const unixMode = externalAttributes >>> 16
    if (!name || name.startsWith('/') || name.includes('\0') || pathParts.includes('..')) {
      throw new UploadSecurityError('unsafe_archive_path', '压缩包包含不安全路径')
    }
    if (pathParts.length > limits.maxDepth) {
      throw new UploadSecurityError('archive_depth_exceeded', '压缩包目录层级超过限制')
    }
    if (archiveExtensions.has(entryExtension) || dangerousExtensions.has(entryExtension)) {
      throw new UploadSecurityError('unsafe_archive_entry', '压缩包包含嵌套压缩包或高风险文件')
    }
    if ((unixMode & 0o170000) === 0o120000) {
      throw new UploadSecurityError('archive_symlink', '压缩包不能包含符号链接')
    }

    const localHeader = Buffer.alloc(30)
    const localRead = await handle.read(localHeader, 0, localHeader.length, localOffset)
    if (localRead.bytesRead !== localHeader.length || localHeader.readUInt32LE(0) !== 0x04034b50) {
      throw new UploadSecurityError('invalid_zip_local_header', 'ZIP 文件结构无效')
    }
    const localFlags = localHeader.readUInt16LE(6)
    const localMethod = localHeader.readUInt16LE(8)
    const localNameLength = localHeader.readUInt16LE(26)
    const localExtraLength = localHeader.readUInt16LE(28)
    const localName = Buffer.alloc(localNameLength)
    const localNameRead = await handle.read(localName, 0, localNameLength, localOffset + 30)
    const localDataEnd = localOffset + 30 + localNameLength + localExtraLength + compressedSize
    if (localNameRead.bytesRead !== localNameLength || !localName.equals(nameBytes)
      || localMethod !== compressionMethod || (localFlags & 0x1) || localDataEnd > centralOffset) {
      throw new UploadSecurityError('zip_entry_mismatch', 'ZIP 文件条目信息不一致')
    }

    totalCompressed += compressedSize
    totalUncompressed += uncompressedSize
    if (totalUncompressed > limits.maxUncompressedBytes) {
      throw new UploadSecurityError('archive_size_exceeded', '压缩包解压后大小超过限制')
    }
    parsedEntries += 1
    cursor = entryEnd
  }

  if (parsedEntries !== entryCount) throw new UploadSecurityError('invalid_zip_directory', 'ZIP 文件结构无效')
  if (totalUncompressed > 0 && totalUncompressed / Math.max(1, totalCompressed) > limits.maxCompressionRatio) {
    throw new UploadSecurityError('archive_ratio_exceeded', '压缩包压缩比异常')
  }
}
