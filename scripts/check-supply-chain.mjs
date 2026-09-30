import { readdir, readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
const npmConfig = await readFile(new URL('../.npmrc', import.meta.url), 'utf8')
const nodeVersion = (await readFile(new URL('../.nvmrc', import.meta.url), 'utf8')).trim()
const workflowRoot = new URL('../.github/workflows/', import.meta.url)
const workflowNames = (await readdir(workflowRoot)).filter((name) => /\.ya?ml$/i.test(name)).sort()
const workflows = await Promise.all(workflowNames.map((name) => readFile(new URL(name, workflowRoot), 'utf8')))
const allowedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'Apache-2.0 AND LGPL-3.0-or-later',
  'Apache-2.0 AND LGPL-3.0-or-later AND MIT',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'ISC',
  'LGPL-3.0-or-later',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  '(MPL-2.0 OR Apache-2.0)',
])
const reviewedLicenseOverrides = new Map([
  // These source packages declare MIT, but npm omits it from their lock metadata.
  ['busboy@1.6.0', 'MIT'],
  ['streamsearch@1.1.0', 'MIT'],
])

const violations = []
if (!/^npm@\d+\.\d+\.\d+$/.test(manifest.packageManager || '')) violations.push('packageManager 必须固定到精确 npm 版本')
if (manifest.devEngines?.runtime?.version !== nodeVersion) violations.push('devEngines Node.js 版本必须与 .nvmrc 一致')
if (manifest.devEngines?.packageManager?.version !== manifest.packageManager?.slice(4)) violations.push('devEngines npm 版本必须与 packageManager 一致')
if (!/^registry=https:\/\/registry\.npmjs\.org\/$/m.test(npmConfig)) violations.push('.npmrc 必须固定使用官方 npm registry')
for (const workflow of workflows) {
  for (const match of workflow.matchAll(/uses:\s*[^@\s]+@([^\s#]+)/g)) {
    if (!/^[0-9a-f]{40}$/.test(match[1])) violations.push(`GitHub Action 必须固定到完整提交 SHA，当前为 ${match[1]}`)
  }
}
for (const section of ['dependencies', 'devDependencies']) {
  for (const [name, version] of Object.entries(manifest[section] || {})) {
    if (version === 'latest' || /^[~^*]|[<>=|\s]/.test(version)) {
      violations.push(`${section}.${name} 必须使用精确版本，当前为 ${version}`)
    }
  }
}

const rootLock = lock.packages?.['']
if (!rootLock || lock.lockfileVersion !== 3) violations.push('package-lock.json 必须是有效的 lockfileVersion 3 锁文件')
for (const section of ['dependencies', 'devDependencies']) {
  for (const [name, version] of Object.entries(manifest[section] || {})) {
    if (rootLock?.[section]?.[name] !== version) violations.push(`锁文件中的 ${name} 版本与 package.json 不一致`)
  }
}

for (const [path, entry] of Object.entries(lock.packages || {})) {
  if (!path.startsWith('node_modules/')) continue
  const name = path.split('node_modules/').at(-1)
  const packageId = `${name}@${entry.version}`
  const license = entry.license || reviewedLicenseOverrides.get(packageId)
  if (entry.deprecated) violations.push(`${name}@${entry.version} 已弃用：${entry.deprecated}`)
  if (!license) violations.push(`${packageId} 缺少许可证声明`)
  else if (!allowedLicenses.has(license)) violations.push(`${packageId} 使用未审核许可证：${license}`)
  if (!entry.integrity || !entry.resolved) violations.push(`${name}@${entry.version} 缺少来源或完整性校验`)
  else if (!entry.resolved.startsWith('https://registry.npmjs.org/')) violations.push(`${packageId} 未使用官方 npm registry`)
}

if (violations.length) {
  console.error(`供应链检查失败：\n- ${violations.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log(`供应链检查通过（${Object.keys(lock.packages).length - 1} 个依赖包）。`)
}
