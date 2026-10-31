import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fatfish-community-'))
const config = loadConfig({
  NODE_ENV: 'test',
  DB_PATH: path.join(tempRoot, 'community.sqlite'),
  UPLOAD_DIR: path.join(tempRoot, 'uploads'),
  JWT_SECRET: 'integration-test-secret-long-enough',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'admin-test-password',
  ADMIN_NICKNAME: '测试管理员',
  CORS_ORIGINS: '*',
  MAX_UPLOAD_MB: '5',
})
const app = createApp(config)
const server = await new Promise((resolve) => {
  const value = app.listen(0, '127.0.0.1', () => resolve(value))
})
const address = server.address()
const base = 'http://127.0.0.1:' + address.port + '/api'

async function json(pathname, options = {}) {
  const response = await fetch(base + pathname, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  })
  const body = await response.json()
  return { response, body }
}

test.after(() => {
  server.close()
  app.locals.db.close()
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

test('双账号上传、审核、共享、评论、收藏、举报和下载', async () => {
  const health = await json('/health')
  assert.equal(health.response.status, 200)
  assert.equal(health.body.ok, true)

  const registerA = await json('/auth/register', { method: 'POST', body: { username: 'uploader', password: 'password-A1', nickname: '上传者' } })
  const registerB = await json('/auth/register', { method: 'POST', body: { username: 'downloader', password: 'password-B1', nickname: '下载者' } })
  assert.equal(registerA.response.status, 201)
  assert.equal(registerB.response.status, 201)

  const weakPassword = await json('/auth/register', { method: 'POST', body: { username: 'weakuser', password: 'short', nickname: '弱密码账号' } })
  assert.equal(weakPassword.response.status, 400)
  const duplicate = await json('/auth/register', { method: 'POST', body: { username: 'UPLOADER', password: 'password-A1', nickname: '重复账号' } })
  assert.equal(duplicate.response.status, 409)

  const adminLogin = await json('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin-test-password' } })
  assert.equal(adminLogin.response.status, 200)

  const form = new FormData()
  form.set('title', '测试共享模型')
  form.set('summary', '用于验证跨用户共享')
  form.set('description', '集成测试模型')
  form.set('category', '识别模型')
  form.set('framework', 'ONNX')
  form.set('version', '1.0.0')
  form.set('tags', '测试,共享')
  form.set('file', new Blob(['fatfish-model-content'], { type: 'application/octet-stream' }), '瓦紫(3).onnx')
  const upload = await fetch(base + '/models', { method: 'POST', headers: { authorization: 'Bearer ' + registerA.body.token }, body: form })
  const uploaded = await upload.json()
  assert.equal(upload.status, 201)
  assert.equal(uploaded.model.status, 'pending')
  assert.equal(uploaded.model.fileName, '瓦紫(3).onnx')

  const forbiddenReview = await json('/admin/models/' + uploaded.model.id + '/review', {
    method: 'PATCH',
    headers: { authorization: 'Bearer ' + registerB.body.token },
    body: { status: 'approved' },
  })
  assert.equal(forbiddenReview.response.status, 403)

  const pendingDownload = await fetch(base + '/models/' + uploaded.model.id + '/download')
  assert.equal(pendingDownload.status, 404)

  const ownerList = await json('/models?mine=1', { headers: { authorization: 'Bearer ' + registerA.body.token } })
  assert.equal(ownerList.body.models.length, 1)

  const hiddenList = await json('/models')
  assert.equal(hiddenList.body.models.length, 0)

  const pending = await json('/models?status=pending', { headers: { authorization: 'Bearer ' + adminLogin.body.token } })
  assert.equal(pending.body.models.length, 1)

  const review = await json('/admin/models/' + uploaded.model.id + '/review', {
    method: 'PATCH',
    headers: { authorization: 'Bearer ' + adminLogin.body.token },
    body: { status: 'approved' },
  })
  assert.equal(review.body.model.status, 'approved')

  const visibleList = await json('/models?q=共享')
  assert.equal(visibleList.body.models.length, 1)

  const favorite = await json('/models/' + uploaded.model.id + '/favorite', {
    method: 'PUT',
    headers: { authorization: 'Bearer ' + registerB.body.token },
  })
  assert.equal(favorite.body.favorited, true)
  const duplicateFavorite = await json('/models/' + uploaded.model.id + '/favorite', {
    method: 'PUT',
    headers: { authorization: 'Bearer ' + registerB.body.token },
  })
  assert.equal(duplicateFavorite.body.favoriteCount, 1)

  const comment = await json('/models/' + uploaded.model.id + '/comments', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + registerB.body.token },
    body: { content: '第二个账号可以正常评论' },
  })
  assert.equal(comment.response.status, 201)

  const report = await json('/models/' + uploaded.model.id + '/reports', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + registerB.body.token },
    body: { reason: '集成测试举报' },
  })
  assert.equal(report.response.status, 201)

  const download = await fetch(base + '/models/' + uploaded.model.id + '/download', { headers: { authorization: 'Bearer ' + registerB.body.token } })
  assert.equal(download.status, 200)
  assert.equal(await download.text(), 'fatfish-model-content')
  assert.match(download.headers.get('x-model-sha256'), /^[A-F0-9]{64}$/)

  const comments = await json('/models/' + uploaded.model.id + '/comments')
  assert.equal(comments.body.comments.length, 1)
  assert.equal(comments.body.comments[0].authorName, '下载者')

  const favoriteList = await json('/models?favorites=1', { headers: { authorization: 'Bearer ' + registerB.body.token } })
  assert.equal(favoriteList.body.models.length, 1)
  assert.equal(favoriteList.body.models[0].downloads, 1)

  const reports = await json('/admin/reports', { headers: { authorization: 'Bearer ' + adminLogin.body.token } })
  assert.equal(reports.body.reports.length, 1)
})
