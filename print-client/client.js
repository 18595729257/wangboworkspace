// client.js - 智能打印客户端 v4.0（简化版）
// 只做一件事：收到 PDF → 下载 → 用 SumatraPDF 打印
// 绝不调用 Word/WPS/COM，绝不报 RPC 错误

const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const config = require('./config')
const printer = require('./printer')
const { downloadFile } = require('./download')

const downloadDir = path.resolve(config.DOWNLOAD_DIR)
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })

// ===== 日志 =====
const logDir = path.resolve(config.LOG_DIR || './logs')
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })

function getLogFile() {
  const d = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  return path.join(logDir, `client-${d}.log`)
}

function cleanOldLogs() {
  try {
    const files = fs.readdirSync(logDir)
    const cutoff = Date.now() - 7 * 86400000
    files.forEach(f => {
      if (!f.startsWith('client-') || !f.endsWith('.log')) return
      if (fs.statSync(path.join(logDir, f)).mtimeMs < cutoff) fs.unlinkSync(path.join(logDir, f))
    })
  } catch (e) {}
}

function writeLog(level, ...args) {
  const ts = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const line = `[${ts}] [${level}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`
  try { fs.appendFileSync(getLogFile(), line) } catch (e) {}
}

const ts = () => new Date().toLocaleTimeString('zh-CN')
const log = (...a) => { console.log(`[${ts()}]`, ...a) }
const err = (...a) => { console.error(`[${ts()}] ❌`, ...a) }
const flog = (...a) => writeLog('INFO', ...a)
const ferr = (...a) => writeLog('ERROR', ...a)

cleanOldLogs()

let localPrinters = []
let ws = null
let wsConnected = false
let pollTimer = null
let reconnectTimer = null
let heartbeatTimer = null
const processingOrders = new Set()

// ===== HTTP 请求工具 =====
function api(method, endpoint, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(config.API_URL + endpoint)
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
      rejectUnauthorized: false,
    }, res => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => { try { resolve(JSON.parse(body)) } catch (e) { reject(new Error('响应解析失败')) } })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
    if (data) req.write(JSON.stringify(data))
    req.end()
  })
}

// ===== WebSocket 连接 =====
function connectWS() {
  const url = config.WS_URL || 'wss://121.43.241.95:3000/ws/printer'
  log(`连接 WebSocket: ${url}`)
  try {
    ws = new (require('ws'))(url, { rejectUnauthorized: false })
  } catch (e) {
    err('WebSocket 库未安装，请运行: npm install ws')
    startPoll()
    return
  }

  ws.on('open', () => {
    wsConnected = true
    log('✅ WebSocket 已连接')
    flog('WS已连接')

    // 注册客户端
    ws.send(JSON.stringify({
      type: 'register',
      clientId: config.CLIENT_ID,
      clientName: require('os').hostname(),
      printers: localPrinters.map(p => ({ name: p.name, status: p.status }))
    }))

    // 心跳（每30秒）
    heartbeatTimer = setInterval(() => {
      if (ws?.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'heartbeat',
          printers: localPrinters.map(p => ({ name: p.name, status: p.status }))
        }))
      }
    }, 30000)
  })

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString())

      if (msg.type === 'print_task' && msg.data) {
        log(`📩 收到打印任务: ${msg.data.length} 个`)
        flog(`收到订单 ${msg.data.length} 个`)
        msg.data.forEach(order => handleOrder(order, msg.targetPrinter))
      }

      if (msg.type === 'registered') {
        log(`✅ 注册成功: ${msg.clientId} (${msg.printerCount}台)`)
      }
    } catch (e) {
      err('消息解析错误:', e.message)
    }
  })

  ws.on('close', (code) => {
    wsConnected = false
    log(`WS 断开 (code=${code})，5秒后重连...`)
    ferr(`WS断开 code=${code}`)
    clearInterval(heartbeatTimer)
    reconnectTimer = setTimeout(connectWS, 5000)
  })

  ws.on('error', e => {
    err('WS 错误:', e.message)
    ferr('WS错误:', e.message)
  })
}

// ===== 轮询降级（WS 不通时用）=====
function startPoll() {
  if (pollTimer) return
  pollTimer = setInterval(poll, config.POLL_INTERVAL)
  poll()
}

async function poll() {
  try {
    const r = await api('GET', `/api/public/printer/pending?clientId=${encodeURIComponent(config.CLIENT_ID)}`)
    if (r.code === 200 && r.data?.length) {
      log(`轮询发现 ${r.data.length} 个待打印`)
      r.data.forEach(o => {
        // 轮询模式下自动找空闲打印机
        const targetPrinter = o.printer || matchPrinter(null)
        if (targetPrinter) {
          handleOrder(o, targetPrinter.name || targetPrinter)
        } else {
          log(`⚠️ 订单 ${o.order_no} - 无可用打印机，跳过`)
        }
      })
    }
  } catch (e) {
    err('轮询失败:', e.message)
  }
}

// ===== 更新订单状态 =====
async function updateStatus(orderNo, status, printerName, error) {
  // 优先走 WebSocket
  if (wsConnected && ws?.readyState === 1) {
    ws.send(JSON.stringify({ type: 'print_status', orderNo, status, printerName, error }))
    log(`状态: ${orderNo} → ${status}`)
    return
  }
  // 降级走 HTTP
  try {
    await api('PUT', `/api/public/order/${orderNo}/print-status`, {
      status,
      clientId: config.CLIENT_ID,
      printerName,
      error
    })
    log(`状态: ${orderNo} → ${status}`)
  } catch (e) {
    err(`状态更新失败: ${orderNo}`)
    ferr('状态更新失败:', orderNo, e.message)
  }
}

// ===== 匹配打印机 =====
function matchPrinter(targetPrinter) {
  // 有指定名称，找那台
  if (targetPrinter) {
    const p = localPrinters.find(p => p.name === targetPrinter && p.status === 'idle')
    if (p) return p
  }
  // 没指定，找任意空闲的
  return localPrinters.find(p => p.status === 'idle') || null
}

// ===== 判断文件是否是 PDF =====
function isPDF(filePath) {
  try {
    const header = fs.readFileSync(filePath).slice(0, 5).toString()
    return header.startsWith('%PDF')
  } catch (e) {
    return false
  }
}

// ===== 处理一个订单 =====
async function handleOrder(order, targetPrinter) {
  const orderNo = order.order_no || order.orderNo

  // 防重复处理
  if (processingOrders.has(orderNo)) return
  processingOrders.add(orderNo)

  log(`━━━ 订单: ${orderNo} ━━━ 文件: ${order.file_name}${targetPrinter ? ' → ' + targetPrinter : ''}`)

  // 没指定打印机，跳过
  if (!targetPrinter) {
    log('无目标打印机，跳过（等待WS推送）')
    processingOrders.delete(orderNo)
    return
  }

  try {
    // 1. 找打印机
    const matched = matchPrinter(targetPrinter)
    if (!matched) {
      throw new Error(`打印机 "${targetPrinter}" 不可用（可能忙碌或离线）`)
    }
    log(`打印机: ${matched.name}`)
    matched.status = 'busy'

    // 2. 更新状态为打印中
    await updateStatus(orderNo, 'printing', matched.name)

    // 3. 下载文件
    const fileUrl = order.file_url || order.fileUrl
    if (!fileUrl) throw new Error('订单没有文件地址')

    const localFile = path.join(downloadDir, `order_${orderNo}_${Date.now()}.pdf`)
    await downloadFile(fileUrl, localFile)

    // 4. 验证文件
    const fileStat = fs.statSync(localFile)
    if (fileStat.size < 100) {
      throw new Error('文件下载不完整，只有 ' + fileStat.size + ' 字节')
    }
    if (!isPDF(localFile)) {
      throw new Error('文件不是有效的 PDF 格式（服务端可能未转换）。请检查服务端配置。')
    }
    log(`文件验证通过: ${(fileStat.size / 1024).toFixed(0)}KB, 有效PDF`)

    // 5. 打印
    log(`正在打印: ${matched.name} ...`)
    await printer.printFile(localFile, {
      printer: matched.name,
      copies: order.copies || 1,
    })

    // 6. 完成
    await updateStatus(orderNo, 'completed', matched.name)
    matched.status = 'idle'
    log(`✅ ${orderNo} 打印完成`)
    flog(`订单 ${orderNo} 打印完成 [${matched.name}]`)

    // 7. 清理临时文件
    if (!config.KEEP_FILES) {
      try { fs.unlinkSync(localFile) } catch (e) {}
    }

  } catch (e) {
    err(`订单 ${orderNo} 失败: ${e.message}`)
    ferr(`订单 ${orderNo} 失败:`, e.message)
    await updateStatus(orderNo, 'failed', null, e.message)
    // 释放打印机
    const p = localPrinters.find(p => p.status === 'busy')
    if (p) p.status = 'idle'
  } finally {
    processingOrders.delete(orderNo)
  }
}

// ===== 启动 =====
async function start() {
  console.log('')
  console.log('╔══════════════════════════════════════╗')
  console.log('║     智能打印客户端 v4.0              ║')
  console.log('║     PDF专用 · SumatraPDF驱动         ║')
  console.log('╚══════════════════════════════════════╝')
  console.log('')
  log(`API: ${config.API_URL}`)
  log(`ID: ${config.CLIENT_ID}`)

  // 1. 扫描打印机
  localPrinters = printer.getPrinters()
  if (localPrinters.length === 0) {
    log('⚠️  未检测到打印机！')
    log('   请检查打印机是否已连接并开机')
    log('   启动后仍可接收任务')
  } else {
    log(`检测到 ${localPrinters.length} 台打印机:`)
    localPrinters.forEach(p => log(`  ${p.name} (${p.status})`))
  }

  // 2. 同步到云端
  try {
    await api('POST', '/api/public/printer/register', {
      clientId: config.CLIENT_ID,
      clientName: require('os').hostname(),
      printers: localPrinters.map(p => ({ name: p.name }))
    })
    log('✅ 打印机已同步到云端')
    flog(`客户端启动 ${config.CLIENT_ID} 打印机${localPrinters.length}台`)
  } catch (e) {
    err('同步失败:', e.message)
    ferr('启动同步失败:', e.message)
  }

  // 3. 连接 WebSocket + 轮询降级
  connectWS()
  startPoll()
}

process.on('SIGINT', () => { log('退出'); flog('客户端退出'); process.exit(0) })
process.on('SIGTERM', () => { log('退出'); flog('客户端退出'); process.exit(0) })

start()
