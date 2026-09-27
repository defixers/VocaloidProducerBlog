import { hashAdminPassword } from '../server/security/password.js'

function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('This command requires an interactive terminal.')
  }

  return new Promise((resolve, reject) => {
    let value = ''
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    const finish = (error) => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }

    const onData = (input) => {
      for (const character of input) {
        if (character === '\u0003') return finish(new Error('Cancelled.'))
        if (character === '\r' || character === '\n') return finish()
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1)
        } else if (character >= ' ') {
          value += character
        }
      }
    }

    process.stdin.on('data', onData)
  })
}

const password = await readHidden('Admin password: ')
if (password.length < 12) throw new Error('Admin password must contain at least 12 characters.')
const confirmation = await readHidden('Confirm password: ')
if (password !== confirmation) throw new Error('Passwords do not match.')

console.log(`ADMIN_PASSWORD_HASH=${await hashAdminPassword(password)}`)
