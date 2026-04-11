// src/routes/public.js - 小程序公开接口（升级版：支持多文件 + 封面生成）
require('dotenv').config()
const express = require('express')
const rateLimit = require('express-rate-limit')
const path = require('path')
const fs = require('fs')

const db = require('../db')
const cache = require('../cache')
const { ok, fail, safeFileName, detectPdfPages, normalizeHost, shanghaiNow,
        generateOrderNo, findInBuffer } = require('../utils')

const router = express.Router()

// ===== 文件上传目录 =====
const uploadDir = path.join(__dirname, '../../uploads')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

// ===== 公开接口限流 =====
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10000,
  standardHeaders: true,
  legacyHeaders: false,
})
router.use(publicLimiter)

// ===== 辅助函数：解析 multipart body =====
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
    let bodyEnd = contentArea.length
    if (contentArea[contentArea.length - 2] === 0x0D) bodyEnd -= 2
    if (contentArea[contentArea.length - 1] === 0x0A) bodyEnd -= 1
    const body = contentArea.slice(bodyStart, bodyEnd)

    if (headerStr.includes('name="file"')) {
      const filenameMatch = headerStr.match(/filename="([^"]+)"/i)
      return { filename: filenameMatch?.[1] || 'upload.bin', data: body }
    }
  }
  return null
}

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

    let openid = `temp_${code.substring(0, 20)}_${Date.now()}`

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
        openid = wxRes.openid || openid
      } catch {}
    }

    await db.query('INSERT IGNORE INTO users (openid, created_at, updated_at) VALUES (?, NOW(), NOW())', [openid])
    const user = await db.getOne('SELECT * FROM users WHERE openid = ?', [openid])
    ok(res, user)
  } catch (err) {
    console.error('[Public] Wx login error:', err)
    fail(res, 500, '登录失败')
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

// ===== 【升级v2】POST /api/public/order =====
// 支持 device_id（游客模式）or openid（账号模式），两者都不为空时优先 openid
router.post('/order', async (req, res) => {
  try {
    const {
      openid, deviceId, files: filesJson = '[]', pageCount = 1, copies = 1,
      colorMode = 'bw', paperSize = 'A4', duplex = 'single',
      pointsUsed = 0, orderType = 'print', extraInfo = '', printTag = ''
    } = req.body

    // 解析多文件 JSON
    let files = []
    try {
      files = typeof filesJson === 'string' ? JSON.parse(filesJson) : filesJson
    } catch { files = [] }

    // 兼容旧版：单文件参数
    if (files.length === 0) {
      const { fileName = '', fileUrl = '' } = req.body
      if (fileName && fileUrl) {
        files = [{ name: fileName, url: fileUrl, pageCount: parseInt(pageCount) || 1 }]
      }
    }

    // 必须至少有一个标识（openid 优先，deviceId 次之）
    const effectiveOpenid = openid || null
    const effectiveDeviceId = deviceId || null
    if (!effectiveOpenid && !effectiveDeviceId) return fail(res, 400, '参数不完整（缺少 openid 或 deviceId）')
    if (files.length === 0) return fail(res, 400, '参数不完整（缺少文件）')

    const config = await getConfig()
    if (config.enable_print !== '1') return fail(res, 400, '打印服务暂未开放')

    // 推导打印标签
    let tag = printTag
    if (!tag) {
      if (orderType === 'photo' || orderType === 'photo_print') tag = 'photo'
      else if (orderType === 'idcard' || orderType === 'idcard_copy') tag = 'idcard'
      else tag = 'normal'
    }

    // 计算总页数（双面打印：2页合1张纸，但总页数不变，只影响价格）
    let totalPages = 0
    for (const f of files) {
      totalPages += parseInt(f.pageCount || 1)
    }

    const pricePerPage = colorMode === 'color' ? parseFloat(config.price_color) : parseFloat(config.price_bw)
    // 双面：每2页算1张纸，不足2页按1张
    const sheets = duplex === 'double' ? Math.ceil(totalPages / 2) : totalPages
    const printFee = sheets * copies * pricePerPage
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

      const mainFile = files[0]
      const filesJsonStr = JSON.stringify(files)

      // 存储用：openid 为账号标识，deviceId 为游客设备标识
      const storedOpenid = effectiveOpenid || `guest_${effectiveDeviceId}`
      // 【升级v2】INSERT 必须包含所有列（除 auto_increment id），顺序严格对应数据库表
      // 漏列会导致值错位到其他列，decimal/status 互串就是根因
      await conn.query(
        `INSERT INTO orders (order_no, openid, device_id, file_name, file_url, files,
          order_seq, print_seq, doc_seq_date,
          page_count, copies, color_mode, paper_size, duplex,
          print_fee, service_fee, total_fee, points_used, points_discount, actual_pay,
          status, order_type, print_tag, extra_info, printer_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL, NOW())`,
        [orderNo, storedOpenid, effectiveDeviceId,
          mainFile.name, mainFile.url, filesJsonStr,
          totalPages, copies, colorMode, paperSize, duplex,
          parseFloat(printFee.toFixed(2)), serviceFee, parseFloat(totalFee.toFixed(2)),
          pointsUsed, parseFloat(pointsDiscount.toFixed(2)), parseFloat(actualPay.toFixed(2)),
          orderType, tag, extraInfo]
      )
    })

    // 处理多文件：生成封面（仅文档类打印），同步写 print_seq
    const { processOrderFiles } = require('../services/cover')
    let coverInfo = {}
    try {
      coverInfo = await processOrderFiles(orderNo, files, { copies, colorMode, paperSize })
    } catch (err) {
      console.error('[Public] 处理文件封面失败:', err.message)
    }

    await cache.del('dashboard')

    ok(res, {
      orderNo,
      actualPay: parseFloat(actualPay.toFixed(2)),
      totalPages,
      filesCount: files.length,
      hasCover: coverInfo.needsCover || false,
      printSeq: coverInfo.coverSeq || null,   // 取单号（展示用，如0001）
      orderType,
    })
  } catch (err) {
    console.error('[Public] Create order error:', err)
    fail(res, 500, '创建订单失败')
  }
})

// ===== GET /api/public/order/:orderNo =====
// 【升级v2】返回 print_seq（取单号）、isDocOrder 判断
router.get('/order/:orderNo', async (req, res) => {
  const order = await db.getOne('SELECT * FROM orders WHERE order_no = ?', [req.params.orderNo])
  if (!order) return fail(res, 404, '订单不存在')
  if (order.files) order.files = typeof order.files === 'string' ? JSON.parse(order.files) : order.files
  // 取单号格式化（0001）
  if (order.order_seq) {
    order.printSeq = String(order.order_seq).padStart(4, '0')
  }
  // 是否文档类订单（有封面）
  order.isDocOrder = !!(order.order_seq && order.doc_seq_date)
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

// ===== 【升级3】POST /api/public/pay-callback（触发封面打印）=====
router.post('/pay-callback', async (req, res) => {
  try {
    const { orderNo } = req.body
    if (!orderNo) return fail(res, 400, '缺少订单号')

    const order = await db.getOne('SELECT * FROM orders WHERE order_no = ?', [orderNo])
    if (!order) return fail(res, 404, '订单不存在')
    if (order.status !== 'pending') return fail(res, 400, '订单状态异常')

    const now = shanghaiNow()

    // 更新支付时间，订单保持 paid 状态，等待分配
    await db.query('UPDATE orders SET status = ?, pay_time = ? WHERE id = ?', ['paid', now, order.id])

    // 推送打印任务
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

// ===== GET /api/public/orders/me =====
// 【升级v2】智能订单查询：同时支持 openid（账号） + deviceId（游客）
// 规则：
//   - 有 openid → 查账号订单（精确匹配 openid，排除 guest_ 前缀）
//   - 有 deviceId 无 openid → 查游客订单（精确匹配 device_id）
//   - 两者都没有 → 返回空列表
router.get('/orders/me', async (req, res) => {
  try {
    const { page = 1, pageSize = 20, openid, deviceId } = req.query
    const offset = (parseInt(page) - 1) * parseInt(pageSize)
    const limit = parseInt(pageSize)

    let conditions = []
    let params = []

    // 账号模式：有 openid
    if (openid) {
      conditions.push('openid = ?')
      params.push(openid)
    }
    // 游客模式：无 openid，有 deviceId
    else if (deviceId) {
      conditions.push('device_id = ?')
      params.push(deviceId)
    }
    // 两者都没有，返回空
    else {
      return ok(res, { list: [], total: 0, page: parseInt(page), pageSize: parseInt(pageSize), mode: 'empty' })
    }

    const where = 'WHERE ' + conditions.join(' AND ')
    const [totalRow, orders] = await Promise.all([
      db.getOne(`SELECT COUNT(*) as c FROM orders ${where}`, params),
      db.getPool().query(
        `SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      ).then(([rows]) => rows),
    ])

    // 解析 files JSON，补全 printSeq
    const ordersWithFiles = orders.map(o => {
      const parsed = {
        ...o,
        files: o.files ? (typeof o.files === 'string' ? JSON.parse(o.files) : o.files) : null,
      }
      // 取单号格式化
      if (parsed.order_seq) {
        parsed.printSeq = String(parsed.order_seq).padStart(4, '0')
      }
      // 是否文档类订单
      parsed.isDocOrder = !!(parsed.order_seq && parsed.doc_seq_date)
      return parsed
    })

    ok(res, {
      list: ordersWithFiles,
      total: totalRow.c,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    })
  } catch (err) {
    console.error('[Public] /orders/me error:', err)
    fail(res, 500, '查询失败')
  }
})

// ===== GET /api/public/user/:openid/orders =====
// 【升级v2】兼容旧版路径：仍然按 openid 精确查询（仅账号模式）
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

  const ordersWithFiles = orders.map(o => {
    const parsed = {
      ...o,
      files: o.files ? (typeof o.files === 'string' ? JSON.parse(o.files) : o.files) : null,
    }
    if (parsed.order_seq) {
      parsed.printSeq = String(parsed.order_seq).padStart(4, '0')
    }
    parsed.isDocOrder = !!(parsed.order_seq && parsed.doc_seq_date)
    return parsed
  })

  ok(res, { list: ordersWithFiles, total: totalRow.c, page: parseInt(page), pageSize: parseInt(pageSize) })
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

    // 返回该客户端所有打印机的 enabled 状态
    const printers = await db.query('SELECT name, enabled FROM printers WHERE client_id = ?', [clientId])
    ok(res, { printers }, '注册成功')
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
    // 返回最新的 enabled 状态，让客户端同步
    const printers = await db.query('SELECT name, enabled FROM printers WHERE client_id = ?', [clientId])
    ok(res, { printers }, 'ok')
  } catch (err) {
    fail(res, 500, '心跳失败')
  }
})

// GET /api/public/printer/pending
router.get('/printer/pending', async (req, res) => {
  try {
    const { clientId } = req.query
    let query = "SELECT * FROM orders WHERE status = 'paid' AND (file_url IS NOT NULL AND file_url != '') ORDER BY created_at ASC LIMIT 20"
    let params = []

    // 如果有 clientId，优先返回该客户端打印机的订单
    if (clientId) {
      const ids = (await db.query('SELECT id FROM printers WHERE client_id = ?', [clientId])).map(r => r.id)
      if (ids.length > 0) {
        query = `SELECT * FROM orders WHERE status = 'paid' AND (file_url IS NOT NULL AND file_url != '') AND (printer_id IS NULL OR printer_id IN (?)) ORDER BY created_at ASC LIMIT 20`
        params = [ids]
      }
    }

    const orders = await db.query(query, params)

    // 解析 files JSON，组装完整打印文件列表（封面 + 原文件）
    const { getOrderPrintFiles } = require('../services/cover')
    const ordersWithFiles = await Promise.all(orders.map(async (o) => {
      const files = await getOrderPrintFiles(o)
      return { ...o, printFiles: files }
    }))

    ok(res, ordersWithFiles)
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

    let completedOrder = null
    if (status === 'completed' || status === 'printed') {
      await db.query("UPDATE orders SET status = 'completed', print_end_time = NOW(), updated_at = NOW() WHERE order_no = ?", [orderNo])
      // 查询完整订单信息（含 printSeq）返回给客户端
      completedOrder = await db.getOne('SELECT order_seq, doc_seq_date FROM orders WHERE order_no = ?', [orderNo])
    } else if (status === 'print_failed') {
      await db.query("UPDATE orders SET status = 'print_failed', updated_at = NOW() WHERE order_no = ?", [orderNo])
    } else {
      await db.query('UPDATE orders SET status = ?, updated_at = NOW() WHERE order_no = ?', [status, orderNo])
    }

    console.log(`[打印] 订单 ${orderNo} 状态更新: ${status}${clientId ? ' (客户端: ' + clientId + ')' : ''}${printError ? ' 错误: ' + printError : ''}`)
    ok(res, {
      orderNo,
      printSeq: completedOrder?.order_seq ? String(completedOrder.order_seq).padStart(4, '0') : null,
      isDocOrder: !!(completedOrder?.order_seq && completedOrder?.doc_seq_date),
    }, '更新成功')
  } catch (err) {
    console.error('[Public] 更新打印状态失败:', err)
    fail(res, 500, '更新失败')
  }
})

// ===== 【升级2】POST /api/public/upload - 文件上传接口 =====
// 支持微信小程序 wx.uploadFile 的 multipart/form-data 格式
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
  const maxSize = 50 * 1024 * 1024 // 50MB

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
      let pageCount = 1
      if (ext === '.pdf') {
        pageCount = detectPdfPages(filePath)
      } else if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
        pageCount = 1
      }

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

// ===== POST /api/public/device/sync =====
// 【升级v2】游客设备ID同步（无账号模式下同步设备标识）
router.post('/device/sync', async (req, res) => {
  try {
    const { deviceId } = req.body
    if (!deviceId) return fail(res, 400, '缺少deviceId')
    // 设备同步记录（仅记录，不创建用户）
    console.log(`[Device] 游客设备同步: ${deviceId}`)
    ok(res, { deviceId, synced: true })
  } catch (err) {
    fail(res, 500, '同步失败')
  }
})

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
