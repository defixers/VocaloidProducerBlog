import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const windowsCandidates = [
  process.env.BASH_PATH,
  'C:\\Program Files\\Git\\bin\\bash.exe',
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
].filter(Boolean)

const bash = process.platform === 'win32'
  ? windowsCandidates.find((candidate) => existsSync(candidate))
  : process.env.BASH_PATH || 'bash'

if (!bash) {
  console.error('Bash was not found. Install Git for Windows or set BASH_PATH.')
  process.exit(1)
}

for (const script of ['deploy/setup-alinux3-backup.sh', 'deploy/release-gate-alinux3.sh']) {
  const result = spawnSync(bash, ['-n', script], {
    cwd: new URL('..', import.meta.url),
    stdio: 'inherit',
  })
  if (result.error) {
    console.error(`Unable to run Bash: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}
