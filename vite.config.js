import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execFileSync } from 'node:child_process'

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim()
}

function buildIdentity() {
  const configuredCommit = String(process.env.BUILD_COMMIT || '').trim().toLowerCase()
  if (configuredCommit && !/^[0-9a-f]{40}$/.test(configuredCommit)) {
    throw new Error('BUILD_COMMIT must be a full 40-character Git SHA.')
  }
  const commit = git('rev-parse', 'HEAD').toLowerCase()
  if (configuredCommit && configuredCommit !== commit) {
    throw new Error(`BUILD_COMMIT ${configuredCommit} does not match HEAD ${commit}.`)
  }
  const dirty = Boolean(git('status', '--porcelain'))
  return { schema: 1, commit, dirty }
}

function buildIdentityPlugin() {
  const identity = buildIdentity()
  return {
    name: 'build-identity',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.json',
        source: `${JSON.stringify(identity, null, 2)}\n`,
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), buildIdentityPlugin()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
