const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/**
 * 把字节数格式化为自适应单位的可读文本（1024 进制，与后端 UPLOAD_* 配置口径一致）。
 * 1 KB 以下不带小数（B 本身就是整数），其余保留一位小数并去掉多余的 .0。
 * 传入非法值时返回空字符串，便于调用方用 v-if 隐藏整块内容。
 */
export function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return ''
  if (value === 0) return '0 B'
  let size = value
  let unit = 0
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${unit === 0 ? Math.round(size) : Number(size.toFixed(1))} ${UNITS[unit]}`
}

/**
 * 判断「补充说明」是否只是后端自动填进去的大小，而不是作者写的说明。
 *
 * server/index.js 在 meta 为空时会写入 `${Math.ceil(size / 1024)} KB`
 * （见 server/index.js 的资源上传处理），于是存量数据里 meta 与 size 表示同一个值，
 * 列表就会出现「545.8 KB · 546 KB」这样的大小重复。用这条规则把它识别出来跳过，
 * 既不需要清洗存量数据，也不需要改后端。
 */
export const SIZE_ONLY_META = /^\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB)$/i
