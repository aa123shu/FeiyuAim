import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import multer from 'multer'
import { createAuth } from './auth.js'
import { openDatabase } from './db.js'

const allowedExtensions = new Set(['.onnx', '.pt', '.tflite', '.engine', '.bin', '.param', '.json', '.zip', '.model'])
const categories = new Set(['识别模型', '触控模型', '推理配置', '其他'])
const MODEL_SELECT = [
  'SELECT m.id, m.title, m.summary, m.description, m.category, m.framework, m.version,',
  'm.tags_json AS tagsJson, m.author_id AS authorId, u.nickname AS authorName,',
  'm.status, m.file_name AS fileName, m.stored_name AS storedName,',
  'm.file_size AS fileSize, m.file_type AS fileType, m.sha256, m.downloads,',
  'm.created_at AS createdAt, m.reviewed_at AS reviewedAt,',
  '(SELECT COUNT(*) FROM favorites f WHERE f.model_id = m.id) AS favoriteCount',
  'FROM models m JOIN users u ON u.id = m.author_id',
].join(' ')

function now() {
  return new Date().toISOString()
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex').toUpperCase()))
  })
}

function cleanText(value, maxLength, required = true) {
  const result = String(value ?? '').trim()
  if (required && !result) throw new Error('必填字段不能为空')
  if (result.length > maxLength) throw new Error('字段长度不能超过 ' + maxLength)
  return result
}

function repairFilename(value) {
  const name = path.basename(String(value || 'model.onnx')).replace(/[\u0000\r\n]/g, '_')
  // Some multipart clients send UTF-8 bytes while the parser exposes them as
  // Latin-1. Repair that legacy form, but keep normal Unicode filenames as-is.
  if (![...name].every((character) => character.codePointAt(0) <= 0xff)) return name
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8')
    return decoded.includes('\uFFFD') ? name : decoded
  } catch {
    return name
  }
}

function parseTags(value) {
  return [...new Set(String(value || '').split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 6)
}

function safeJson(value, fallback = []) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function publicUser(row) {
  if (!row) return null
  return { id: row.id, username: row.username, nickname: row.nickname, role: row.role, createdAt: row.createdAt }
}

function modelFromRow(row, favoriteIds = new Set()) {
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    description: row.description,
    category: row.category,
    framework: row.framework,
    version: row.version,
    tags: safeJson(row.tagsJson),
    authorId: row.authorId,
    authorName: row.authorName,
    status: row.status,
    fileName: repairFilename(row.fileName),
    fileSize: row.fileSize,
    fileType: row.fileType,
    sha256: row.sha256,
    downloads: row.downloads,
    favoriteCount: row.favoriteCount || 0,
    isFavorited: favoriteIds.has(row.id),
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt || null,
  }
}

function favoriteIds(db, userId) {
  if (!userId) return new Set()
  return new Set(db.prepare('SELECT model_id AS modelId FROM favorites WHERE user_id = ?').all(userId).map((row) => row.modelId))
}

function canViewModel(model, user) {
  return Boolean(model && (model.status === 'approved' || user?.role === 'admin' || model.authorId === user?.id))
}

export function createApp(config) {
  const db = openDatabase(config)
  const auth = createAuth(config, db)
  const app = express()
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: '操作过于频繁，请稍后再试' },
  })
  const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 8,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: '注册请求过于频繁，请稍后再试' },
  })
  const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: '上传请求过于频繁，请稍后再试' },
  })

  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(cors({
    origin(origin, callback) {
      const allowed = !origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)
        || (origin === 'null' && config.corsOrigins.includes('null'))
      callback(allowed ? null : new Error('不允许的跨域来源'), allowed)
    },
  }))
  app.use(express.json({ limit: '1mb' }))

  const storage = multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, config.uploadDir),
    filename: (_req, file, callback) => callback(null, randomUUID() + path.extname(repairFilename(file.originalname)).toLowerCase()),
  })
  const upload = multer({
    storage,
    limits: { fileSize: config.maxUploadBytes, files: 1 },
    fileFilter: (_req, file, callback) => {
      const extension = path.extname(repairFilename(file.originalname)).toLowerCase()
      const allowed = allowedExtensions.has(extension)
      callback(allowed ? null : new Error('不支持的模型文件格式'), allowed)
    },
  })

  function getModelRow(id) {
    return db.prepare(MODEL_SELECT + ' WHERE m.id = ?').get(id)
  }

  app.get('/api/health', (_req, res) => {
    const row = db.prepare('SELECT COUNT(*) AS users FROM users').get()
    res.json({ ok: true, service: 'fatfish-model-community', version: '1.0.0', users: row.users, time: now() })
  })

  app.post('/api/auth/register', registerLimiter, async (req, res) => {
    try {
      const username = cleanText(req.body?.username, 40).toLowerCase()
      const password = String(req.body?.password || '')
      const nickname = cleanText(req.body?.nickname, 40)
      if (!/^[a-z0-9_.-]{3,40}$/i.test(username)) return res.status(400).json({ error: '账号只能包含字母、数字、点、横线或下划线，长度 3-40 位' })
      if (password.length < 8 || password.length > 128) return res.status(400).json({ error: '密码长度必须为 8-128 位' })
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: '该账号已经注册' })

      const user = { id: randomUUID(), username, nickname, role: 'user', createdAt: now() }
      db.prepare("INSERT INTO users (id, username, password_hash, nickname, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)")
        .run(user.id, username, await bcrypt.hash(password, 12), nickname, user.createdAt)
      res.status(201).json({ token: auth.issueToken(user), user })
    } catch (error) {
      res.status(400).json({ error: error.message || '注册失败' })
    }
  })

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase()
    const password = String(req.body?.password || '')
    const row = db.prepare('SELECT id, username, password_hash AS passwordHash, nickname, role, created_at AS createdAt FROM users WHERE username = ?').get(username)
    if (!row || !(await bcrypt.compare(password, row.passwordHash))) return res.status(401).json({ error: '账号或密码不正确' })
    const user = publicUser(row)
    res.json({ token: auth.issueToken(user), user })
  })

  app.get('/api/auth/me', auth.required, (req, res) => res.json({ user: req.user }))

  app.get('/api/stats', (_req, res) => {
    const stats = db.prepare([
      'SELECT',
      '(SELECT COUNT(*) FROM users) AS users,',
      "(SELECT COUNT(*) FROM models WHERE status = 'approved') AS approvedModels,",
      '(SELECT COALESCE(SUM(downloads), 0) FROM models) AS downloads',
    ].join(' ')).get()
    res.json(stats)
  })

  app.get('/api/models', auth.optional, (req, res) => {
    const where = []
    const params = []
    const mine = req.query.mine === '1'
    const favoritesOnly = req.query.favorites === '1'
    const requestedStatus = String(req.query.status || '')

    if (mine) {
      if (!req.user) return res.status(401).json({ error: '请先登录' })
      where.push('m.author_id = ?')
      params.push(req.user.id)
    } else if (req.user?.role === 'admin' && ['pending', 'approved', 'rejected'].includes(requestedStatus)) {
      where.push('m.status = ?')
      params.push(requestedStatus)
    } else {
      where.push("m.status = 'approved'")
    }

    if (favoritesOnly) {
      if (!req.user) return res.status(401).json({ error: '请先登录' })
      where.push('EXISTS(SELECT 1 FROM favorites fx WHERE fx.model_id = m.id AND fx.user_id = ?)')
      params.push(req.user.id)
    }
    if (req.query.category && req.query.category !== '全部') {
      where.push('m.category = ?')
      params.push(String(req.query.category))
    }
    if (req.query.q) {
      where.push('(m.title LIKE ? OR m.summary LIKE ? OR m.framework LIKE ? OR m.tags_json LIKE ? OR u.nickname LIKE ?)')
      const query = '%' + String(req.query.q).slice(0, 80) + '%'
      params.push(query, query, query, query, query)
    }

    const rows = db.prepare(MODEL_SELECT + ' WHERE ' + where.join(' AND ') + ' ORDER BY m.created_at DESC LIMIT 200').all(...params)
    const favorites = favoriteIds(db, req.user?.id)
    res.json({ models: rows.map((row) => modelFromRow(row, favorites)) })
  })

  app.get('/api/models/:id', auth.optional, (req, res) => {
    const model = modelFromRow(getModelRow(req.params.id), favoriteIds(db, req.user?.id))
    if (!canViewModel(model, req.user)) return res.status(404).json({ error: '模型不存在' })
    res.json({ model })
  })

  app.post('/api/models', auth.required, uploadLimiter, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请选择模型文件' })
    try {
      const disk = fs.statfsSync(config.uploadDir)
      const freeBytes = disk.bavail * disk.bsize
      if (freeBytes < config.minFreeBytes + req.file.size) {
        fs.rmSync(req.file.path, { force: true })
        return res.status(507).json({ error: '服务器存储空间不足，暂时不能接收新模型' })
      }
      const category = categories.has(req.body.category) ? req.body.category : '其他'
      const model = {
        id: randomUUID(),
        title: cleanText(req.body.title, 80),
        summary: cleanText(req.body.summary, 160),
        description: cleanText(req.body.description || req.body.summary, 5000),
        category,
        framework: cleanText(req.body.framework || '其他', 30),
        version: cleanText(req.body.version || '1.0.0', 30),
        tags: parseTags(req.body.tags),
        authorId: req.user.id,
        authorName: req.user.nickname,
        status: 'pending',
        fileName: repairFilename(req.file.originalname),
        fileSize: req.file.size,
        fileType: req.file.mimetype || 'application/octet-stream',
        sha256: await hashFile(req.file.path),
        downloads: 0,
        favoriteCount: 0,
        isFavorited: false,
        createdAt: now(),
        reviewedAt: null,
      }
      const sql = [
        'INSERT INTO models (id, title, summary, description, category, framework, version, tags_json,',
        'author_id, status, file_name, stored_name, file_size, file_type, sha256, created_at)',
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)",
      ].join(' ')
      db.prepare(sql).run(model.id, model.title, model.summary, model.description, model.category, model.framework,
        model.version, JSON.stringify(model.tags), req.user.id, model.fileName, req.file.filename,
        model.fileSize, model.fileType, model.sha256, model.createdAt)
      res.status(201).json({ model })
    } catch (error) {
      fs.rmSync(req.file.path, { force: true })
      res.status(400).json({ error: error.message || '上传失败' })
    }
  })

  app.patch('/api/admin/models/:id/review', auth.admin, (req, res) => {
    const status = String(req.body?.status || '')
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: '审核状态无效' })
    const result = db.prepare('UPDATE models SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?')
      .run(status, now(), req.user.id, req.params.id)
    if (!result.changes) return res.status(404).json({ error: '模型不存在' })
    res.json({ model: modelFromRow(getModelRow(req.params.id), favoriteIds(db, req.user.id)) })
  })

  app.get('/api/models/:id/comments', auth.optional, (req, res) => {
    const model = modelFromRow(getModelRow(req.params.id))
    if (!canViewModel(model, req.user)) return res.status(404).json({ error: '模型不存在' })
    const comments = db.prepare([
      'SELECT c.id, c.model_id AS modelId, c.user_id AS userId, u.nickname AS authorName,',
      'c.content, c.created_at AS createdAt FROM comments c JOIN users u ON u.id = c.user_id',
      'WHERE c.model_id = ? ORDER BY c.created_at ASC',
    ].join(' ')).all(req.params.id)
    res.json({ comments })
  })

  app.post('/api/models/:id/comments', auth.required, (req, res) => {
    const model = modelFromRow(getModelRow(req.params.id))
    if (!canViewModel(model, req.user)) return res.status(404).json({ error: '模型不存在' })
    try {
      const comment = { id: randomUUID(), modelId: req.params.id, userId: req.user.id, authorName: req.user.nickname, content: cleanText(req.body?.content, 1000), createdAt: now() }
      db.prepare('INSERT INTO comments (id, model_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(comment.id, comment.modelId, comment.userId, comment.content, comment.createdAt)
      res.status(201).json({ comment })
    } catch (error) {
      res.status(400).json({ error: error.message || '评论失败' })
    }
  })

  app.put('/api/models/:id/favorite', auth.required, (req, res) => {
    const model = modelFromRow(getModelRow(req.params.id))
    if (!canViewModel(model, req.user)) return res.status(404).json({ error: '模型不存在' })
    db.prepare('INSERT OR IGNORE INTO favorites (model_id, user_id, created_at) VALUES (?, ?, ?)').run(req.params.id, req.user.id, now())
    const count = db.prepare('SELECT COUNT(*) AS count FROM favorites WHERE model_id = ?').get(req.params.id).count
    res.json({ favorited: true, favoriteCount: count })
  })

  app.delete('/api/models/:id/favorite', auth.required, (req, res) => {
    db.prepare('DELETE FROM favorites WHERE model_id = ? AND user_id = ?').run(req.params.id, req.user.id)
    const count = db.prepare('SELECT COUNT(*) AS count FROM favorites WHERE model_id = ?').get(req.params.id).count
    res.json({ favorited: false, favoriteCount: count })
  })

  app.post('/api/models/:id/reports', auth.required, (req, res) => {
    const model = modelFromRow(getModelRow(req.params.id))
    if (!canViewModel(model, req.user)) return res.status(404).json({ error: '模型不存在' })
    try {
      const report = { id: randomUUID(), modelId: req.params.id, userId: req.user.id, reason: cleanText(req.body?.reason, 1000), status: 'open', createdAt: now() }
      db.prepare('INSERT INTO reports (id, model_id, user_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(report.id, report.modelId, report.userId, report.reason, report.status, report.createdAt)
      res.status(201).json({ report })
    } catch (error) {
      res.status(400).json({ error: error.message || '举报失败' })
    }
  })

  app.get('/api/admin/reports', auth.admin, (_req, res) => {
    const reports = db.prepare([
      'SELECT r.id, r.model_id AS modelId, m.title AS modelTitle, r.user_id AS userId,',
      'u.nickname AS reporterName, r.reason, r.status, r.created_at AS createdAt, r.resolved_at AS resolvedAt',
      'FROM reports r JOIN models m ON m.id = r.model_id JOIN users u ON u.id = r.user_id',
      "ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC",
    ].join(' ')).all()
    res.json({ reports })
  })

  app.patch('/api/admin/reports/:id', auth.admin, (req, res) => {
    const status = String(req.body?.status || '')
    if (!['resolved', 'dismissed'].includes(status)) return res.status(400).json({ error: '处理状态无效' })
    const result = db.prepare('UPDATE reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?')
      .run(status, now(), req.user.id, req.params.id)
    if (!result.changes) return res.status(404).json({ error: '举报不存在' })
    res.json({ ok: true })
  })

  app.get('/api/models/:id/download', auth.optional, (req, res) => {
    const row = getModelRow(req.params.id)
    const model = modelFromRow(row)
    if (!model || model.status !== 'approved') return res.status(404).json({ error: '模型不存在或尚未通过审核' })
    const filePath = path.join(config.uploadDir, row.storedName)
    if (!fs.existsSync(filePath)) return res.status(410).json({ error: '模型文件已丢失，请联系管理员' })

    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('UPDATE models SET downloads = downloads + 1 WHERE id = ?').run(req.params.id)
      db.prepare('INSERT INTO downloads (id, model_id, user_id, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), req.params.id, req.user?.id || null, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 300), now())
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    res.setHeader('Content-Type', model.fileType)
    res.setHeader('Content-Length', model.fileSize)
    res.setHeader('X-Model-SHA256', model.sha256)
    res.download(filePath, model.fileName)
  })

  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: '模型文件不能超过 ' + Math.round(config.maxUploadBytes / 1024 / 1024) + 'MB' })
    }
    res.status(400).json({ error: error.message || '请求处理失败' })
  })

  app.locals.db = db
  return app
}
