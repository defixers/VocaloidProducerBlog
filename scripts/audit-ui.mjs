import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const outputDir = new URL('../.screenshots/', import.meta.url)
await mkdir(outputDir, { recursive: true })

const cwd = fileURLToPath(new URL('../', import.meta.url))
const api = spawn(process.execPath, ['server/index.js'], { cwd, env: { ...process.env, PORT: '8787' }, stdio: 'ignore' })
const web = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd, stdio: 'ignore' })
let browser

async function waitForServer(url) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Server did not start: ${url}`)
}

try {
  await Promise.all([
    waitForServer('http://127.0.0.1:5173/'),
    waitForServer('http://127.0.0.1:8787/api/health'),
  ])

  browser = await chromium.launch({ executablePath: edgePath, headless: true })
  const results = []

  async function inspect(page, name) {
    await page.waitForLoadState('networkidle')
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
    }))
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, outputDir)), fullPage: true })
    results.push({ name, ...layout, overflow: layout.pageWidth > layout.viewport })
  }

  for (const device of [
    { name: 'desktop', viewport: { width: 1440, height: 1000 }, compactNavigation: false },
    { name: 'tablet', viewport: { width: 1024, height: 768 }, compactNavigation: true },
    { name: 'compact', viewport: { width: 700, height: 900 }, compactNavigation: true },
    { name: 'mobile', viewport: { width: 390, height: 844 }, compactNavigation: true },
  ]) {
    const context = await browser.newContext({ viewport: device.viewport })
    const page = await context.newPage()
    const errors = []
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto('http://127.0.0.1:5173/')
    await inspect(page, `${device.name}-site`)
    const articleActionOverlap = await page.locator('.article-card').evaluateAll((cards) => cards.some((card) => {
      const paragraph = card.querySelector('p')?.getBoundingClientRect()
      const action = card.querySelector('button')?.getBoundingClientRect()
      if (!paragraph || !action) return false
      return paragraph.bottom > action.top && paragraph.top < action.bottom
        && paragraph.right > action.left && paragraph.left < action.right
    }))
    if (articleActionOverlap) throw new Error('Article card action overlaps its summary')

    if (device.viewport.width <= 820) {
      await page.locator('.menu-button').click()
      await page.locator('.mobile-nav button').filter({ hasText: '文章' }).click()
    } else {
      await page.locator('.desktop-nav button').filter({ hasText: '文章' }).click()
    }
    await page.getByRole('heading', { name: '创作档案' }).waitFor()
    const invalidCover = await page.locator('.archive-list img').evaluateAll((images) => images.some((item) => {
      const { width, height } = item.getBoundingClientRect()
      return width / height < 1.7 || width / height > 1.85
    }))
    if (invalidCover) throw new Error('Article archive cover ratio is invalid')
    await inspect(page, `${device.name}-articles`)

    await page.goto('http://127.0.0.1:5173/admin')
    await inspect(page, `${device.name}-login`)
    await page.getByLabel('管理令牌').fill('utopia-dev')
    await page.getByRole('button', { name: '进入后台' }).click()
    await page.getByText('工作概览').waitFor()
    await inspect(page, `${device.name}-overview`)

    await page.getByRole('button', { name: '新建文章' }).click()
    await inspect(page, `${device.name}-editor`)

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(100)
    const stickyLayout = await page.evaluate(() => ({
      topbar: Math.round(document.querySelector('.admin-topbar').getBoundingClientRect().top),
      sidebar: Math.round(document.querySelector('.admin-sidebar').getBoundingClientRect().top),
    }))
    if (stickyLayout.topbar !== 0 || (!device.compactNavigation && stickyLayout.sidebar !== 0)) {
      throw new Error(`Admin navigation is not sticky: ${JSON.stringify(stickyLayout)}`)
    }

    if (device.compactNavigation) await page.getByTitle('打开导航').click()
    await page.getByRole('button', { name: '二创资源' }).click()
    await page.waitForFunction(() => window.scrollY <= 1)
    if (device.compactNavigation) {
      await page.waitForTimeout(250)
      const navigationClosed = await page.evaluate(() => (
        !document.querySelector('.admin-sidebar')?.classList.contains('open')
        && !document.querySelector('.admin-backdrop')
      ))
      if (!navigationClosed) throw new Error('Mobile navigation did not close after selecting a view')
    }
    await inspect(page, `${device.name}-resources`)

    results.push({ name: `${device.name}-errors`, errors })
    await context.close()
  }

  const failures = results.filter((result) => result.overflow || result.errors?.length)
  if (failures.length) throw new Error(`UI audit failed: ${JSON.stringify(failures)}`)
  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser?.close()
  web.kill()
  api.kill()
}
