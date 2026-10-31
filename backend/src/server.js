import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { loadConfig } from './config.js'

const envPath = fileURLToPath(new URL('../.env', import.meta.url))
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)

const config = loadConfig()
const app = createApp(config)
const server = app.listen(config.port, config.host, () => {
  console.log('肥鱼模型社区服务器已启动：http://' + config.host + ':' + config.port)
})

function shutdown(signal) {
  console.log('收到 ' + signal + '，正在停止服务器')
  server.close(() => {
    app.locals.db.close()
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
