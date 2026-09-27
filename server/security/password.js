import crypto from 'node:crypto'

const parameters = { memory: 65536, passes: 3, parallelism: 1, tagLength: 32 }
const hashPattern = /^\$argon2id\$v=19\$m=65536,t=3,p=1\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/

function derive(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.argon2('argon2id', {
      message: Buffer.from(password, 'utf8'),
      nonce: salt,
      ...parameters,
    }, (error, result) => {
      if (error) reject(error)
      else resolve(Buffer.from(result))
    })
  })
}

export async function hashAdminPassword(password) {
  if (typeof password !== 'string' || !password) throw new Error('Admin password cannot be empty')
  const salt = crypto.randomBytes(16)
  const hash = await derive(password, salt)
  return `$argon2id$v=19$m=65536,t=3,p=1$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verifyAdminPassword(encodedHash, password) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 1024) return false
  const match = String(encodedHash || '').match(hashPattern)
  if (!match) return false

  const salt = Buffer.from(match[1], 'base64url')
  const expected = Buffer.from(match[2], 'base64url')
  if (salt.length !== 16 || expected.length !== parameters.tagLength) return false

  const actual = await derive(password, salt)
  return crypto.timingSafeEqual(actual, expected)
}

export function isAdminPasswordHash(value) {
  return hashPattern.test(String(value || ''))
}
