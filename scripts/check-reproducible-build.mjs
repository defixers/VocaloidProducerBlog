import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const rootPath = fileURLToPath(root)
const viteEntry = join(rootPath, 'node_modules', 'vite', 'bin', 'vite.js')
const secondOutput = await mkdtemp(join(tmpdir(), 'utopia-build-'))

function build(output) {
  execFileSync(process.execPath, [viteEntry, 'build', '--outDir', output, '--emptyOutDir'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
}

async function hashes(directory) {
  const result = {}
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await visit(path)
      else result[relative(directory, path).replaceAll('\\', '/')] = createHash('sha256').update(await readFile(path)).digest('hex')
    }
  }
  await visit(directory)
  return result
}

try {
  const firstOutput = join(rootPath, 'dist')
  build(firstOutput)
  build(secondOutput)
  const first = await hashes(firstOutput)
  const second = await hashes(secondOutput)
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('相同提交的两次构建产物不一致。')
  console.log(`可复现构建验证通过（${Object.keys(first).length} 个文件）。`)
} finally {
  await rm(secondOutput, { recursive: true, force: true })
}
