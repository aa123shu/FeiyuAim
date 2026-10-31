import jwt from 'jsonwebtoken'

function bearerToken(req) {
  const value = req.headers.authorization || ''
  return value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}

export function createAuth(config, db) {
  const issueToken = (user) => jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  )

  const findUser = (id) => db.prepare('SELECT id, username, nickname, role, created_at AS createdAt FROM users WHERE id = ?').get(id)
  const readUser = (req) => {
    const token = bearerToken(req)
    if (!token) return null
    try {
      const payload = jwt.verify(token, config.jwtSecret)
      return findUser(payload.sub) || null
    } catch {
      return null
    }
  }

  const optional = (req, _res, next) => {
    req.user = readUser(req)
    next()
  }
  const required = (req, res, next) => {
    req.user = readUser(req)
    if (!req.user) return res.status(401).json({ error: '请先登录' })
    next()
  }
  const admin = (req, res, next) => {
    req.user = readUser(req)
    if (!req.user) return res.status(401).json({ error: '请先登录' })
    if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' })
    next()
  }
  return { issueToken, optional, required, admin }
}
