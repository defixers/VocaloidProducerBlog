/**
 * Bilibili CDN 图片地址工具。
 *
 * B 站图床支持在路径末尾追加 `@<宽>w_<高>h_<裁剪>[_锐化].<格式>` 后缀，
 * 由 CDN 实时完成裁剪、缩放和转码，因此前端直接引用 CDN 地址即可，
 * 不需要服务端图片代理，也就没有了 SSRF 面：
 * - 封面：`@672w_378h_1c.webp` / `@672w_378h_1c.avif`
 * - 头像：`@96w_96h_1c_1s.webp`
 *
 * B 站图床通过 Referer 做防盗链，所有 <img> 必须带 `referrerpolicy="no-referrer"`。
 */

const BILIBILI_IMAGE_URL = /^https:\/\/[^/]+\.(?:hdslb|biliimg)\.com\//i

/** 是否为 B 站图床地址。只有这类地址才能追加 `@` 转换后缀。 */
export function isBilibiliImage(value) {
  const https = String(value || '').trim().replace(/^http:\/\//i, 'https://').replace(/^\/\//, 'https://')
  return BILIBILI_IMAGE_URL.test(https)
}

/**
 * 统一成 https、去掉已有的 `@` 后缀。非 B 站地址原样返回。
 * @param {string} value 图床原始地址，可能是 `//i0.hdslb.com/...` 或 `http://...`
 * @returns {string} 可用于追加尺寸后缀的基础地址
 */
export function normalizeBilibiliImage(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const https = raw.replace(/^http:\/\//i, 'https://').replace(/^\/\//, 'https://')
  if (!isBilibiliImage(https)) return https
  return https.replace(/@[^/?#]*(?=$|[?#])/, '')
}

/**
 * 生成响应式封面地址。B 站图床按 `@` 后缀返回对应尺寸，
 * 因此每个宽度都是一条独立 URL，直接用 `w` 描述符交给浏览器挑选。
 * @param {string} value 封面原始地址
 * @param {number[]} widths 需要的宽度档位（按 16:9 裁剪）
 * @returns {{ responsive: boolean, src: string, webp: string, avif: string }}
 */
export function coverImage(value, widths = [480, 672, 960, 1280]) {
  const base = normalizeBilibiliImage(value)
  if (!base || !isBilibiliImage(base)) {
    return { responsive: false, src: base, webp: '', avif: '' }
  }
  const srcset = (format) => widths
    .map((width) => `${base}@${width}w_${Math.round((width * 9) / 16)}h_1c.${format} ${width}w`)
    .join(', ')
  return {
    responsive: true,
    src: `${base}@960w_540h_1c.webp`,
    webp: srcset('webp'),
    avif: srcset('avif'),
  }
}

/**
 * 上传者头像：CDN 侧裁成正方形并锐化。
 * @param {string} value 头像原始地址
 * @param {string} size `@` 后缀中的尺寸与处理参数
 */
export function avatarImage(value, size = '96w_96h_1c_1s') {
  const base = normalizeBilibiliImage(value)
  if (!base || !isBilibiliImage(base)) return base
  return `${base}@${size}.webp`
}
