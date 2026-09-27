import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const staged = process.argv.includes('--staged')
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
const output = staged
  ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z')
  : git('ls-files', '-z')
const files = output.split('\0').filter(Boolean)

const forbiddenPaths = [
  { name: 'environment file', pattern: /(^|\/)\.env(?:\..+)?$/i, allow: /(^|\/)\.env\.example$/i },
  { name: 'dependency directory', pattern: /(^|\/)node_modules\//i },
  { name: 'browser or audit output', pattern: /(^|\/)\.screenshots?\//i },
  { name: 'uploaded file', pattern: /(^|\/)server\/uploads\/(?!\.gitkeep$)/i },
  { name: 'private key or certificate bundle', pattern: /\.(?:key|pem|p12|pfx)$/i },
  { name: 'browser or application database', pattern: /(^|\/)(?:Cookies|Login Data|History|Web Data|[^/]+\.(?:sqlite|sqlite3|db))$/i },
]

const secretPatterns = [
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub token', pattern: /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/ },
]

function containsPopulatedEnvironmentValue(content, key) {
  const match = content.match(new RegExp(`^${key}\\s*=([^\\r\\n]*)`, 'mi'))
  if (!match) return false
  const value = match[1].trim().replace(/^(['"])(.*)\1$/, '$2')
  return Boolean(value) && !/^(?:<|replace|your|change)/i.test(value)
}

const violations = []

for (const file of files) {
  const normalized = file.replaceAll('\\', '/')
  for (const rule of forbiddenPaths) {
    if (rule.pattern.test(normalized) && !rule.allow?.test(normalized)) {
      violations.push(`${normalized}: ${rule.name}`)
    }
  }

  let content
  try {
    content = staged
      ? execFileSync('git', ['show', `:${file}`], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 })
      : readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const rule of secretPatterns) {
    if (rule.pattern.test(content)) violations.push(`${normalized}: ${rule.name}`)
  }
  if (containsPopulatedEnvironmentValue(content, 'BILIBILI_COOKIE')) {
    violations.push(`${normalized}: populated Bilibili cookie`)
  }
  if (containsPopulatedEnvironmentValue(content, 'ADMIN_TOKEN')) {
    violations.push(`${normalized}: populated admin token`)
  }
}

if (violations.length) {
  console.error('Sensitive content check failed:')
  for (const violation of [...new Set(violations)]) console.error(`- ${violation}`)
  process.exit(1)
}

console.log(`Sensitive content check passed (${files.length} files checked).`)
