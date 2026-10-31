import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/LZKhy剪辑视频/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')

const root = path.dirname(fileURLToPath(import.meta.url))
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const frontendUrl = process.env.FRONTEND_URL || 'http://127.0.0.1:5173/'
const sizes = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function readLayout(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      if (!element) return null
      const value = element.getBoundingClientRect()
      return { left: value.left, right: value.right, width: value.width }
    }

    return {
      viewport: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      nav: rect(document.querySelector('.mobile-bottom-nav')),
      navButtons: [...document.querySelectorAll('.mobile-bottom-nav button')].map(rect),
      heading: rect(document.querySelector('.feed-heading')),
      rows: [...document.querySelectorAll('.model-row')].map(rect),
    }
  })
}

function verifyLayout(layout, expectedNavItems, label) {
  const tolerance = 1
  assert(layout.documentWidth <= layout.viewport + tolerance, `${label}: document overflow ${layout.documentWidth}/${layout.viewport}`)
  assert(layout.bodyWidth <= layout.viewport + tolerance, `${label}: body overflow ${layout.bodyWidth}/${layout.viewport}`)

  if (expectedNavItems) {
    assert(layout.navButtons.length === expectedNavItems, `${label}: expected ${expectedNavItems} nav items, found ${layout.navButtons.length}`)
    for (const [index, button] of layout.navButtons.entries()) {
      assert(button.left >= -tolerance && button.right <= layout.viewport + tolerance, `${label}: nav item ${index + 1} is clipped`)
    }
  }

  for (const [index, row] of layout.rows.entries()) {
    assert(row.left >= -tolerance && row.right <= layout.viewport + tolerance, `${label}: model row ${index + 1} is clipped`)
  }
}

const browser = await chromium.launch({ executablePath: edgePath, headless: true })

try {
  for (const size of sizes) {
    const context = await browser.newContext({
      viewport: size,
      screen: size,
      deviceScaleFactor: 1,
      isMobile: size.width <= 720,
      hasTouch: size.width <= 720,
    })
    const page = await context.newPage()
    await page.goto(frontendUrl, { waitUntil: 'networkidle' })

    const anonymousLayout = await readLayout(page)
    verifyLayout(anonymousLayout, size.width <= 720 ? 3 : 0, `${size.width}x${size.height} anonymous`)
    await page.screenshot({ path: path.join(root, 'testshots', `device-${size.width}x${size.height}.png`) })

    if (size.width <= 720) {
      const response = await page.request.post('http://127.0.0.1:8787/api/auth/login', {
        data: { username: 'admin', password: 'admin12345' },
      })
      assert(response.ok(), 'default local admin login failed')
      const session = await response.json()
      await page.evaluate((token) => localStorage.setItem('feiyu-community-token-v1', token), session.token)
      await page.reload({ waitUntil: 'networkidle' })
      const adminLayout = await readLayout(page)
      verifyLayout(adminLayout, 4, `${size.width}x${size.height} admin`)
    }

    console.log(`${size.width}x${size.height}: PASS`)
    await context.close()
  }
} finally {
  await browser.close()
}
