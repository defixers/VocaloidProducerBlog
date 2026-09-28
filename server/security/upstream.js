import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'

const blockedAddresses = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4],
]) blockedAddresses.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10],
  ['ff00::', 8], ['2001:db8::', 32],
]) blockedAddresses.addSubnet(network, prefix, 'ipv6')

export class UpstreamSecurityError extends Error {
  constructor(code) {
    super(code)
    this.name = 'UpstreamSecurityError'
    this.code = code
  }
}

export function isPublicAddress(address) {
  const family = isIP(address)
  if (!family) return false
  if (family === 6 && /^::ffff:/i.test(address)) return false
  return !blockedAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

export function validateUpstreamUrl(value, allowedHosts) {
  let url
  try {
    url = new URL(String(value || ''))
  } catch {
    throw new UpstreamSecurityError('invalid_upstream_url')
  }
  const hostname = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.port || url.username || url.password || isIP(hostname)
    || !allowedHosts.has(hostname)) {
    throw new UpstreamSecurityError('invalid_upstream_url')
  }
  url.hash = ''
  return url
}

async function resolvePublicAddresses(hostname, resolveHost) {
  let addresses
  try {
    addresses = await resolveHost(hostname, { all: true, verbatim: true })
  } catch {
    throw new UpstreamSecurityError('upstream_dns_failed')
  }
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address))) {
    throw new UpstreamSecurityError('upstream_address_blocked')
  }
  return addresses
}

function requestBuffer(url, addresses, options) {
  return new Promise((resolve, reject) => {
    const signal = AbortSignal.timeout(options.timeoutMs)
    const request = options.requestImpl(url, {
      method: 'GET',
      headers: options.headers,
      signal,
      servername: url.hostname,
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions?.all) return callback(null, addresses)
        callback(null, addresses[0].address, addresses[0].family)
      },
    }, (response) => {
      const contentLength = Number(response.headers['content-length'] || 0)
      if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
        response.destroy()
        request.destroy()
        return reject(new UpstreamSecurityError('upstream_response_too_large'))
      }

      const chunks = []
      let size = 0
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > options.maxBytes) {
          response.destroy()
          request.destroy(new UpstreamSecurityError('upstream_response_too_large'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks, size),
      }))
      response.on('error', reject)
    })
    request.on('error', (error) => {
      if (error instanceof UpstreamSecurityError) return reject(error)
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || signal.aborted) {
        return reject(new UpstreamSecurityError('upstream_timeout'))
      }
      reject(new UpstreamSecurityError('upstream_request_failed'))
    })
    request.end()
  })
}

export async function fetchUpstreamBuffer(value, {
  allowedHosts,
  headers = {},
  maxBytes,
  maxRedirects = 3,
  timeoutMs,
  resolveHost = lookup,
  requestImpl = httpsRequest,
}) {
  let url = validateUpstreamUrl(value, allowedHosts)
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const addresses = await resolvePublicAddresses(url.hostname, resolveHost)
    const response = await requestBuffer(url, addresses, { headers, maxBytes, timeoutMs, requestImpl })
    if (![301, 302, 303, 307, 308].includes(response.status)) return { ...response, url }
    if (redirect === maxRedirects) throw new UpstreamSecurityError('upstream_redirect_limit')
    const location = response.headers.location
    if (!location) throw new UpstreamSecurityError('upstream_redirect_invalid')
    url = validateUpstreamUrl(new URL(location, url).href, allowedHosts)
  }
  throw new UpstreamSecurityError('upstream_redirect_limit')
}
