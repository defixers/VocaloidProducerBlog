import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim()
}

const info = JSON.parse(await readFile(new URL('../dist/build-info.json', import.meta.url), 'utf8'))
const expectedCommit = String(process.env.DEPLOY_COMMIT || git('rev-parse', 'HEAD')).trim().toLowerCase()

if (info.schema !== 1 || !/^[0-9a-f]{40}$/.test(info.commit)) {
  throw new Error('构建来源文件格式无效。')
}
if (info.dirty) throw new Error('构建产物来自包含未提交修改的工作区，拒绝部署。')
if (info.commit !== expectedCommit) {
  throw new Error(`构建提交 ${info.commit} 与预期提交 ${expectedCommit} 不一致。`)
}

console.log(`构建来源验证通过：${info.commit}`)
