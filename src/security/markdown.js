import DOMPurify from 'dompurify'
import { marked } from 'marked'

const allowedTags = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'em', 'del',
  'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'a', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

function isSafeLink(value) {
  const href = value.trim()
  if (!href || /[\u0000-\u001f\u007f\\]/.test(href) || href.startsWith('//')) return false
  if (href.startsWith('#') || href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) return true
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(href).protocol)
  } catch {
    return !href.includes(':')
  }
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!node.hasAttribute?.('href')) return
  const href = node.getAttribute('href') || ''
  if (!isSafeLink(href)) {
    node.removeAttribute('href')
    node.removeAttribute('target')
    node.removeAttribute('rel')
    return
  }
  if (/^https?:/i.test(href)) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  } else {
    node.removeAttribute('target')
    node.removeAttribute('rel')
  }
})

export function renderMarkdown(source) {
  return DOMPurify.sanitize(marked.parse(String(source || '')), {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
  })
}
