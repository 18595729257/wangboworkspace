// server.js - 打印管理后台服务端（重构版）
// 所有路由已拆分到 src/routes/，WebSocket 已拆分到 src/services/

require('dotenv').config()

const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const path = require('path')
const http = require('http')

const db = require('./src/db')
const cache = require('./src/cache')
const wsService = require('./src/services/websocket')

// 路由
const authRouter = require('./src/routes/auth')
const dashboardRouter = require('./src/routes/dashboard')
const ordersRouter = require('./src/routes/orders')
const printersRouter = require('./src/routes/printers')
const usersRouter = require('./src/routes/users')
const configRouter = require('./src/routes/config')
const publicRouter = require('./src/routes/public')

const app = express()
const PORT = process.env.PORT || 3000

// ===== 全局中间件 =====
app.set('trust proxy', 1)
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))
app.use(cors())
app.use(express.json({ limit: '5mb' }))

// 结构化日志（生产环境）
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(':method :url :status :res[content-length] :response-time ms - :remote-addr'))
}

// ===== JWT 认证中间件（挂载到 app）=====
// 注意：这里挂载在 /api 上，所以 req.path 是相对于 /api 的路径
app.use('/api', (req, res, next) => {
  // 公开接口放行（req.path 相对于 /api）
  const publicPaths = ['/login', '/entry-types', '/printers/online']
  if (publicPaths.includes(req.path)) return next()
  if (req.path.startsWith('/public/')) return next()

  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ code: 401, msg: '未登录' })

  try {
    const { verifyToken } = require('./src/utils')
    req.admin = verifyToken(token)
    next()
  } catch {
    return res.status(401).json({ code: 401, msg: '登录已过期' })
  }
})

// ===== 路由挂载 =====
// 管理后台接口（需认证）
app.use('/api', authRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/printers', printersRouter)
app.use('/api/users', usersRouter)
app.use('/api/config', configRouter)

// 小程序公开接口（无需认证）
app.use('/api/public', publicRouter)

// ===== 入口类型（管理后台用）=====
app.get('/api/entry-types', (req, res) => {
  res.json({
    code: 200,
    data: [
      { key: 'print', label: '文档打印', icon: '📄' },
      { key: 'idcard', label: '证件复印', icon: '🪪' },
      { key: 'photo', label: '照片打印', icon: '📸' },
      { key: 'factory', label: '工厂发货', icon: '🏭' },
    ]
  })
})

// ===== 健康检查 =====
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1')
    res.json({
      status: 'ok',
      redis: cache.isEnabled(),
      time: new Date().toISOString(),
    })
  } catch {
    res.status(503).json({ status: 'error', time: new Date().toISOString() })
  }
})

// ===== 探活（负载均衡用）=====
app.get('/ready', (req, res) => {
  res.json({ ready: true })
})

// ===== SPA fallback =====
app.use(express.static(path.join(__dirname, 'public')))
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// ===== 全局错误处理 =====
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err)
  res.status(500).json({ code: 500, msg: '服务器内部错误' })
})

// ===== 启动 =====
async function start() {
  try {
    await db.query('SELECT 1')
    console.log('✅ MySQL 连接成功')

    cache.init()

    const server = http.createServer(app).listen(PORT, '127.0.0.1', () => {
      console.log(`\n🖨️  打印管理后台已启动`)
      console.log(`   HTTP:      http://127.0.0.1:${PORT}`)
      console.log(`   WebSocket: ws://127.0.0.1:${PORT}/ws/printer`)
      console.log(`   健康检查:  http://127.0.0.1:${PORT}/health`)
      console.log(`   环境:      ${process.env.NODE_ENV || 'development'}`)
    })

    wsService.init(server)
  } catch (err) {
    console.error('❌ 启动失败:', err.message)
    console.error('   请检查 MySQL 配置和 .env 文件')
    process.exit(1)
  }
}

// 优雅关闭
async function shutdown() {
  console.log('正在关闭...')
  await db.close()
  await cache.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

start()
