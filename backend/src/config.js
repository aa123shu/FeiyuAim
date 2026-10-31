import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides }
  const isProduction = env.NODE_ENV === 'production'
  const jwtSecret = env.JWT_SECRET || 'fatfish-local-development-secret-change-before-deploy'
  const adminPassword = env.ADMIN_PASSWORD || 'admin12345'

  if (isProduction && jwtSecret.includes('development-secret')) throw new Error('生产环境必须设置 JWT_SECRET')
  if (isProduction && adminPassword === 'admin12345') throw new Error('生产环境必须设置 ADMIN_PASSWORD')
  if (isProduction && !env.CORS_ORIGINS) throw new Error('生产环境必须设置 CORS_ORIGINS')

  return {
    root,
    host: env.HOST || '127.0.0.1',
    port: positiveInteger(env.PORT, 8787),
    dbPath: path.resolve(env.DB_PATH || path.join(root, 'data', 'community.sqlite')),
    uploadDir: path.resolve(env.UPLOAD_DIR || path.join(root, 'uploads')),
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '30d',
    adminUsername: (env.ADMIN_USERNAME || 'admin').trim().toLowerCase(),
    adminPassword,
    adminNickname: (env.ADMIN_NICKNAME || '社区管理员').trim(),
    maxUploadBytes: positiveInteger(env.MAX_UPLOAD_MB, 100) * 1024 * 1024,
    minFreeBytes: positiveInteger(env.MIN_FREE_MB, 2048) * 1024 * 1024,
    corsOrigins: (env.CORS_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173,null')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  }
}
