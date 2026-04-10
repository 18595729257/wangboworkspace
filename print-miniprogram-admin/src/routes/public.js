// src/routes/public.js - 小程序公开接口
const express = require('express')
const rateLimit = require('express-rate-limit')
const path = require('path')
const fs = require('fs')

const db = require('../db')
const cache = require('../cache')
const { ok, fail, safeFileName, detectPdfPages, normalizeHost, shanghaiNow,
        generateOrderNo, findInBuffer } = require('../utils')

const router = express.Router()

// ===== 公开接口限流 =====
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10000,
  standardHeaders: true,
  legacyHeaders: false,
})
router.use(publicLimiter)

// ===== 文件上传目录 =====
const uploadDir = path.join(__dirname, '../../uploads')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

// ===== GET /api/public/config =====
router.get('/config', async (req, res) => {
  const config = await getConfig()
  const publicKeys = [
    'shop_name', 'price_bw', 'price_color', 'service_fee',
    'enable_points', 'points_earn_rate', 'points_deduct_rate',
    'max_points_discount', 'enable_payment', 'enable_print',
  ]
  const pub = {}
  publicKeys.forEach(k => { if (config[k] !== undefined) pub[k] = config[k] })
  ok(res, pub)
})

// ===== POST /api/public/wx-login =====
router.post('/wx-login', async (req, res) => {
  try {
    const { code } = req.body
    if (!code) return fail(res, 400, '缺少登录code')

    const appid = process.env.WX_APPID || 'wx749cd8c41284e88f'
    const appsecret = process.env.WX_APPSECRET || ''

    let openid = ''

    if (appsecret) {
      try {
        const https = require('https')
        const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appid}&secret=${appsecret}&js_code=${code}&grant_type=authorization_code`
        const wxRes = await new Promise((resolve, reject) => {
          https.get(url, r => {
            let data = ''
            r.on('data', c => data += c)
            r.on('end', () => resolve(JSON.parse(data)))
          }).on('error', reject)
        })
        openid = wxRes.openid || `temp_${code.substring(0, 20)}_${Date.now()}`
      } catch {
        openid = `temp_${code.substring(0, 20)}_${Date.now()}`
      }
    } else {
      openid = `temp_${code.substring(0, 20)}_${Date.now()}`
    }

    await db.query('INSERT IGNORE INTO users (openid, created_at, updated_at) VALUES (?, NOW(), NOW())', [openid])
    const user = await db.getOne('SELECT * FROM users WHERE openid = ?', [openid])
    ok(res, user)
  } catch (err) {
    console.error('[Public] Wx login error:', err)
    fail(res, 500, '登录失败')
  }
})

// ===== POST /api/public/phone =====
router.post('/phone', async (req, res) => {
  try {
    const { code } = req.body
    if (!code) return fail(res, 400, '缺少code')

    const appid = process.env.WX_APPID || 'wx749cd8c41284e88f'
    const appsecret = process.env.WX_APPSECRET || ''
    if (!appsecret) return ok(res, { phoneNumber: '' })

    const https = require('https')

    const tokenRes = await new Promise((resolve, reject) => {
      https.get(
        `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${appsecret}`,
        r => {
          let data = ''
          r.on('data', c => data += c)
          r.on('end', () => resolve(JSON.parse(data)))
        }
      ).on('error', reject)
    })

    if (!tokenRes.access_token) return ok(res, { phoneNumber: '' })

    const postData = JSON.stringify({ code })
    const phoneRes = await new Promise((resolve, reject) => {
      const req2 = https.request(
        `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${tokenRes.access_token}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } },
        r => {
          let data = ''
          r.on('data', c => data += c)
          r.on('end', () => resolve(JSON.parse(data)))
        }
      )
      req2.on('error', reject)
      req2.write(postData)
      req2.end()
    })

    const phoneNumber = phoneRes.phone_info?.phoneNumber || ''
    ok(res, { phoneNumber })
  } catch (err) {
    console.error('[Public] Get phone error:', err)
    ok(res, { phoneNumber: '' })
  }
})

// ===== GET /api/public/queue-status =====
router.get('/queue-status', async (req, res) => {
  const [printers, queue] = await Promise.all([
    db.query("SELECT status, COUNT(*) as c FROM printers GROUP BY status"),
    db.query("SELECT status, COUNT(*) as c FROM orders WHERE status IN ('paid','printing') GROUP BY status"),
  ])
  const p = { idle: 0, busy: 0, offline: 0 }
  printers.forEach(r => { p[r.status] = r.c })
  const q = { waiting: 0, printing: 0 }
  queue.forEach(r => { q[r.status === 'paid' ? 'waiting' : 'printing'] = r.c })
  ok(res, { printers: p, queue: q })
})

// ===== POST /api/public/order =====
router.post('/order', async (req, res) => {
  try {
    const {
      openid, fileName, fileUrl = '', pageCount, copies,
      colorMode, paperSize, pointsUsed = 0, orderType = 'print',
      extraInfo = '', printTag = ''
    } = req.body

    if (!openid || !fileName) return fail(res, 400, '参数不完整')

    const config = await getConfig()
    if (config.enable_print !== '1') return fail(res, 400, '打印服务暂未开放')

    // 推导打印标签
    let tag = printTag
    if (!tag) {
      if (orderType === 'photo' || orderType === 'photo_print') tag = 'photo'
      else if (orderType === 'idcard' || orderType === 'idcard_copy') tag = 'idcard'
      else tag = 'normal'
    }

    const pricePerPage = colorMode === 'color' ? parseFloat(config.price_color) : parseFloat(config.price_bw)
    const printFee = pageCount * copies * pricePerPage
    const serviceFee = parseFloat(config.service_fee)
    const totalFee = printFee + serviceFee
    const maxDiscount = Math.min(parseFloat(config.max_points_discount), printFee)
    const pointsDiscount = Math.min(pointsUsed / parseInt(config.points_deduct_rate), maxDiscount)
    const actualPay = Math.max(totalFee - pointsDiscount, 0.01)
    const orderNo = generateOrderNo()

    await db.transaction(async (conn) => {
      await conn.query('INSERT IGNORE INTO users (openid, created_at, updated_at) VALUES (?, NOW(), NOW())', [openid])

      if (pointsUsed > 0) {
        const [userRows] = await conn.query('SELECT * FROM users WHERE openid = ?', [openid])
        const user = userRows?.[0]
        if (user && user.points >= pointsUsed) {
          await conn.query('UPDATE users SET points = points - ?, updated_at = NOW() WHERE openid = ?', [pointsUsed, openid])
          await conn.query(
            `INSERT INTO points_records (user_id, openid, type, points, reason, order_no, created_at) VALUES (?, ?, 'deduct', ?, '订单抵扣', ?, NOW())`,
            [user.id, openid, pointsUsed, orderNo]
          )
        }
      }

      await conn.query(
        `INSERT INTO orders (order_no, openid, file_name, file_url, page_count, copies, color_mode, paper_size,
          print_fee, service_fee, total_fee, points_used, points_discount, actual_pay, status, order_type, print_tag, extra_info, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NOW())`,
        [orderNo, openid, fileName, fileUrl, pageCount, copies, colorMode, paperSize,
          parseFloat(printFee.toFixed(2)), serviceFee, parseFloat(totalFee.toFixed(2)),
          pointsUsed, parseFloat(pointsDiscount.toFixed(2)), parseFloat(actualPay.toFixed(2)),
          orderType, tag, extraInfo]
      )
    })

    await cache.del('dashboard')
    ok(res, { orderNo, actualPay: parseFloat(actualPay.toFixed(2)) })
  } catch (err) {
    console.error('[Public] Create order error:', err)
    fail(res, 500, '创建订单失败')
  }
})

// ===== GET /api/public/order/:orderNo =====
router.get('/order/:orderNo', async (req, res) => {
  const order = await db.getOne('SELECT * FROM orders WHERE order_no = ?', [req.params.orderNo])
  if (!order) return fail(res, 404, '订单不存在')
  ok(res, order)
})

// ===== PUT /api/public/order/:orderNo/cancel =====
router.put('/order/:orderNo/cancel', async (req, res) => {
  try {
    const order = await db.getOne('SELECT * FROM orders WHERE order_no = ?', [req.params.orderNo])
    if (!order) return fail(res, 404, '订单不存在')
    if (order.status !== 'pending') return fail(res, 400, '只能取消待支付的订单')

    if (order.points_used > 0 && order.openid) {
      await db.transaction(async (conn) => {
        await conn.query('UPDATE orders SET status = ? WHERE id = ?', ['cancelled', order.id])
        await conn.query('UPDATE users SET points = points + ?, updated_at = NOW() WHERE openid = ?', [order.points_used, order.openid])
        await conn.query(
          `INSERT INTO points_records (user_id, openid, type, points, reason, order_no, created_at)
           SELECT id, openid, 'earn', ?, '取消订单退还', ?, NOW() FROM users WHERE openid = ?`,
          [order.points_used, order.order_no, order.openid]
        )
      })
    } else {
      await db.query('UPDATE orders SET status = ? WHERE id = ?', ['cancelled', order.id])
    }

    await cache.del('dashboard')
    ok(res, null, '订单已取消')
  } catch (err) {
    console.error('[Public] Cancel order error:', err)
    fail(res, 500, '取消失败')
  }
})

// ===== POST /api/public/pay-callback =====
router.post('/pay-callback', async (req, res) => {
  try {
    const { orderNo } = req.body
    if (!orderNo) return fail(res, 400, '缺少订单号')

    const order = await db.getOne('SELECT * FROM orders WHERE order_no = ?', [orderNo])
    if (!order) return fail(res, 404, '订单不存在')
    if (order.status !== 'pending') return fail(res, 400, '订单状态异常')

    const now = shanghaiNow()

    // 更新支付时间，订单保持 'paid' 状态，直到客户端真正收到任务才改成 printing
    await db.query('UPDATE orders SET status = ?, pay_time = ? WHERE id = ?', ['paid', now, order.id])

    // 推送打印任务（由外部注入）
    // assignAndPushOrder 会更新订单状态为 printing 并分配打印机
    let pushed = false
    if (global.assignAndPushOrder) {
      try {
        const updated = await db.getOne('SELECT * FROM orders WHERE order_no = ?', [orderNo])
        pushed = await global.assignAndPushOrder(updated)
      } catch (e) {
        console.error('[Public] 分配打印任务失败:', e.message)
      }
    }

    // 发放积分
    try {
      const cfg = await getConfig()
      if (cfg.enable_points === '1' && order.openid) {
        const earnRate = parseInt(cfg.points_earn_rate) || 1
        const pointsEarned = Math.floor(parseFloat(order.actual_pay) / earnRate)
        if (pointsEarned > 0) {
          await db.query(
            'UPDATE users SET points = points + ?, total_spent = total_spent + ?, order_count = order_count + 1, updated_at = NOW() WHERE openid = ?',
            [pointsEarned, parseFloat(order.actual_pay), order.openid]
          )
          await db.query(
            "INSERT INTO points_records (user_id, openid, type, points, reason, order_no, created_at) SELECT id, openid, 'earn', ?, ?, ?, NOW() FROM users WHERE openid = ?",
            [pointsEarned, `订单${orderNo}消费奖励`, orderNo, order.openid]
          )
        }
      }
    } catch (pointsErr) {
      console.error('[Public] 积分发放失败:', pointsErr)
    }

    await cache.del('dashboard')
    ok(res, { orderNo, status: 'paid', printerId: null, pushed })

  } catch (err) {
    console.error('[Public] Pay callback error:', err)
    fail(res, 500, '处理失败')
  }
})
// ===== GET /api/public/user/:openid =====

router.get('/user/:openid', async (req, res) => {
  let user = await db.getOne('SELECT * FROM users WHERE openid = ?', [req.params.openid])
  if (!user) {
    await db.insert('INSERT IGNORE INTO users (openid, created_at, updated_at) VALUES (?, NOW(), NOW())', [req.params.openid])
    user = await db.getOne('SELECT * FROM users WHERE openid = ?', [req.params.openid])
  }
  ok(res, user)
})

// ===== GET /api/public/user/:openid/orders =====
router.get('/user/:openid/orders', async (req, res) => {
  const { page = 1, pageSize = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(pageSize)
  const limit = parseInt(pageSize)

  const [totalRow, orders] = await Promise.all([
    db.getOne('SELECT COUNT(*) as c FROM orders WHERE openid = ?', [req.params.openid]),
    db.getPool().query(
      'SELECT * FROM orders WHERE openid = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [req.params.openid, limit, offset]
    ).then(([rows]) => rows),
  ])

  ok(res, { list: orders, total: totalRow.c, page: parseInt(page), pageSize: parseInt(pageSize) })
})

// ===== 打印机客户端接口 =====

// POST /api/public/printer/register
router.post('/printer/register', async (req, res) => {
  try {
    const { clientId, clientName, printers: clientPrinters } = req.body
    if (!clientId) return fail(res, 400, '缺少clientId')

    if (clientPrinters?.length > 0) {
      for (const p of clientPrinters) {
        const existing = await db.getOne(
          'SELECT id FROM printers WHERE name = ? AND client_id = ?', [p.name, clientId]
        )
        if (existing) {
          await db.query(
            'UPDATE printers SET status = ?, last_heartbeat = NOW(), updated_at = NOW() WHERE id = ?',
            ['idle', existing.id]
          )
        } else {
          await db.query(
            'INSERT INTO printers (name, port, description, client_id, status, last_heartbeat, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW(), NOW())',
            [p.name, p.name, `${clientName || clientId} 的打印机`, clientId, 'idle']
          )
        }
      }
    }

    await db.query(
      "UPDATE printers SET status = 'offline', updated_at = NOW() WHERE client_id != ? AND last_heartbeat < DATE_SUB(NOW(), INTERVAL 5 MINUTE) AND status != 'offline'",
      [clientId]
    )

    ok(res, null, '注册成功')
  } catch (err) {
    console.error('[Public] 打印机注册失败:', err)
    fail(res, 500, '注册失败')
  }
})

// POST /api/public/printer/heartbeat
router.post('/printer/heartbeat', async (req, res) => {
  try {
    const { clientId } = req.body
    if (!clientId) return fail(res, 400, '缺少clientId')
    await db.query('UPDATE printers SET last_heartbeat = NOW(), updated_at = NOW() WHERE client_id = ?', [clientId])
    ok(res, null, 'ok')
  } catch (err) {
    fail(res, 500, '心跳失败')
  }
})

// GET /api/public/printer/pending
router.get('/printer/pending', async (req, res) => {
  try {
    const orders = await db.query(
      "SELECT * FROM orders WHERE status = 'paid' AND (file_url IS NOT NULL AND file_url != '') ORDER BY created_at ASC LIMIT 10"
    )
    ok(res, orders)
  } catch (err) {
    console.error('[Public] 获取待打印订单失败:', err)
    fail(res, 500, '获取失败')
  }
})

// PUT /api/public/order/:orderNo/print-status
router.put('/order/:orderNo/print-status', async (req, res) => {
  try {
    const { orderNo } = req.params
    const { status, clientId, error: printError } = req.body

    const order = await db.getOne('SELECT * FROM orders WHERE order_no = ?', [orderNo])
    if (!order) return fail(res, 404, '订单不存在')

    const validStatuses = ['printing', 'printed', 'completed', 'print_failed']
    if (!validStatuses.includes(status)) return fail(res, 400, '无效的状态')

    let sql, params
    if (status === 'completed' || status === 'printed') {
      sql = "UPDATE orders SET status = 'completed', print_end_time = NOW(), updated_at = NOW() WHERE order_no = ?"
      params = [orderNo]
    } else if (status === 'print_failed') {
      sql = "UPDATE orders SET status = 'print_failed', updated_at = NOW() WHERE order_no = ?"
      params = [orderNo]
    } else {
      sql = 'UPDATE orders SET status = ?, updated_at = NOW() WHERE order_no = ?'
      params = [status, orderNo]
    }

    await db.query(sql, params)
    console.log(`[打印] 订单 ${orderNo} 状态更新: ${status}${clientId ? ' (客户端: ' + clientId + ')' : ''}${printError ? ' 错误: ' + printError : ''}`)
    ok(res, null, '更新成功')
  } catch (err) {
    console.error('[Public] 更新打印状态失败:', err)
    fail(res, 500, '更新失败')
  }
})

// ===== 文件上传（手动 multipart 解析）=====

// 在 Buffer 中查找子 Buffer
function indexOf(buf, subbuf, start = 0) {
  for (let i = start; i <= buf.length - subbuf.length; i++) {
    let match = true
    for (let j = 0; j < subbuf.length; j++) {
      if (buf[i + j] !== subbuf[j]) { match = false; break }
    }
    if (match) return i
  }
  return -1
}

// 解析 multipart body
function parseMultipart(buf, boundary) {
  const boundaryBuf = Buffer.from('--' + boundary)
  let boundaries = []
  let pos = 0
  while (true) {
    pos = indexOf(buf, boundaryBuf, pos)
    if (pos === -1) break
    boundaries.push(pos)
    pos += boundaryBuf.length
  }
  if (boundaries.length < 3) return null

  for (let i = 0; i < boundaries.length - 1; i++) {
    let dataStart = boundaries[i] + boundaryBuf.length
    if (buf[dataStart] === 0x0D && buf[dataStart + 1] === 0x0A) dataStart += 2

    const contentArea = buf.slice(dataStart, boundaries[i + 1])
    const headerEnd = indexOf(contentArea, Buffer.from('\r\n\r\n'), 0)
    if (headerEnd === -1) continue

    const headerStr = contentArea.slice(0, headerEnd).toString('utf8')
    const bodyStart = headerEnd + 4
    const bodyEnd = contentArea.length - (contentArea[contentArea.length - 2] === 0x0D ? 2 : 0)
    const body = contentArea.slice(bodyStart, bodyEnd)

    if (headerStr.includes('name="file"')) {
      const filenameMatch = headerStr.match(/filename="([^"]+)"/i)
      return { filename: filenameMatch?.[1] || 'upload.bin', data: body }
    }
  }
  return null
}

// POST /api/public/upload
router.post('/upload', (req, res) => {
  const startTime = Date.now()
  const contentType = req.headers['content-type'] || ''

  if (!contentType.includes('multipart/form-data')) {
    return fail(res, 400, '请使用 multipart/form-data 上传')
  }

  const boundaryMatch = contentType.match(/boundary=(.+)/i)
  if (!boundaryMatch) return fail(res, 400, '请求格式错误（缺少boundary）')

  const boundary = boundaryMatch[1].trim()
  const chunks = []
  let totalSize = 0
  const maxSize = 50 * 1024 * 1024

  req.on('data', chunk => {
    totalSize += chunk.length
    if (totalSize > maxSize) { req.destroy(); return }
    chunks.push(chunk)
  })

  req.on('end', () => {
    if (totalSize > maxSize) return

    try {
      const bodyBuf = Buffer.concat(chunks)
      const result = parseMultipart(bodyBuf, boundary)
      if (!result) return fail(res, 400, '文件解析失败')

      const fileName = safeFileName(result.filename)
      const filePath = path.join(uploadDir, fileName)
      fs.writeFileSync(filePath, result.data)

      const ext = path.extname(result.filename).toLowerCase()
      const pageCount = ext === '.pdf' ? detectPdfPages(filePath) : 1

      const { proto, host } = normalizeHost(req)
      const fileUrl = `${proto}://${host}/uploads/${fileName}`

      console.log(`[UPLOAD] ${result.filename}, ${result.data.length}B, ${pageCount}页, ${Date.now() - startTime}ms`)
      ok(res, { url: fileUrl, name: result.filename, size: result.data.length, pageCount })
    } catch (err) {
      console.error('[UPLOAD] 处理失败:', err.message)
      fail(res, 500, '文件处理失败: ' + err.message)
    }
  })

  req.on('error', err => {
    console.error('[UPLOAD] 请求错误:', err.message)
    fail(res, 500, '上传中断')
  })
})

// 静态文件访问
router.use('/uploads', express.static(uploadDir))

// ===== 辅助：获取配置（带缓存）=====
async function getConfig() {
  let config = await cache.get('config')
  if (config) return config
  const rows = await db.query('SELECT `key`, `value` FROM config')
  config = {}
  rows.forEach(r => { config[r.key] = r.value })
  await cache.set('config', config, 3600)
  return config
}

module.exports = router
