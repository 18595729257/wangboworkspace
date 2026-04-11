// client.js - 智能打印客户端 v5.0（升级：多文件打印 + 封面页支持）
// 收到任务后自动按顺序打印所有文件（封面优先）

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

// ===== HTTP 请求工具（优先域名，失败降级 IP）=====
function api(method, endpoint, data) {
  return new Promise((resolve, reject) => {
    const tryRequest = (baseUrl, isRetry) => {
      const u = new URL(baseUrl + endpoint)
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
        res.on('end', () => {
          // 域名返回 403 (ICP 拦截)，降级到 IP
          if (res.statusCode === 403 && !isRetry && config.API_URL_FALLBACK) {
            log('域名返回 403，降级到 IP...')
            return tryRequest(config.API_URL_FALLBACK, true)
          }
          try { resolve(JSON.parse(body)) } catch (e) { reject(new Error('响应解析失败')) }
        })
      })
      req.on('error', (e) => {
        // 域名连接失败（RST/超时），降级到 IP
        if (!isRetry && config.API_URL_FALLBACK) {
          log('域名请求失败，降级到 IP:', e.message)
          return tryRequest(config.API_URL_FALLBACK, true)
        }
        reject(e)
      })
      req.on('timeout', () => {
        req.destroy()
        if (!isRetry && config.API_URL_FALLBACK) {
          log('域名请求超时，降级到 IP')
          return tryRequest(config.API_URL_FALLBACK, true)
        }
        reject(new Error('请求超时'))
      })
      if (data) req.write(JSON.stringify(data))
      req.end()
    }
    tryRequest(config.API_URL, false)
  })
}

// ===== WebSocket 连接（优先域名，失败降级 IP）=====
function connectWS() {
  const url = config.WS_URL || 'wss://xinbingcloudprint.top/ws/printer'
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
        log(`📩 收到打印任务: ${msg.data.length} 个订单`)

        // 【升级2+3】支持多文件打印
        msg.data.forEach(order => {
          // 新版：服务端下发的 printFiles（包含封面+原文件）
          const printFiles = msg.printFiles && msg.printFiles.length > 0
            ? msg.printFiles
            : [{ name: order.file_name, url: order.file_url, isCover: false }]

          handleOrderMultiFiles(order, printFiles, msg.targetPrinter)
        })
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
    // 域名 WS 失败时，下次重连尝试降级 IP
    if (config.WS_URL_FALLBACK && config.WS_URL && !config.WS_URL.includes('39.104.59.201')) {
      log('域名 WS 失败，降级到 IP 重连')
      config.WS_URL = config.WS_URL_FALLBACK
    }
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
    // 同步打印机的 enabled 状态
    const hbRes = await api('POST', '/api/public/printer/heartbeat', { clientId: config.CLIENT_ID })
    if (hbRes && hbRes.data && hbRes.data.printers) {
      hbRes.data.printers.forEach(sp => {
        const local = localPrinters.find(p => p.name === sp.name)
        if (local) local.enabled = sp.enabled !== 0 && sp.enabled !== false
      })
    }

    const r = await api('GET', `/api/public/printer/pending?clientId=${encodeURIComponent(config.CLIENT_ID)}`)
    if (r.code === 200 && r.data?.length) {
      log(`轮询发现 ${r.data.length} 个待打印`)
      r.data.forEach(o => {
        const printFiles = o.printFiles && o.printFiles.length > 0
          ? o.printFiles
          : [{ name: o.file_name, url: o.file_url, isCover: false }]
        handleOrderMultiFiles(o, printFiles, o.printer)
      })
    }
  } catch (e) {
    err('轮询失败:', e.message)
  }
}

// ===== 更新订单状态 =====
async function updateStatus(orderNo, status, printerName, error) {
  if (wsConnected && ws?.readyState === 1) {
    ws.send(JSON.stringify({ type: 'print_status', orderNo, status, printerName, error }))
    log(`状态: ${orderNo} → ${status}`)
    return
  }
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
  if (targetPrinter) {
    const p = localPrinters.find(p => p.name === targetPrinter && p.status === 'idle' && p.enabled !== false)
    if (p) return p
  }
  return localPrinters.find(p => p.status === 'idle' && p.enabled !== false) || null
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

// ===== 【核心升级】处理多文件订单 =====
async function handleOrderMultiFiles(order, printFiles, targetPrinter) {
  const orderNo = order.order_no || order.orderNo

  if (processingOrders.has(orderNo)) return
  processingOrders.add(orderNo)

  const hasCover = printFiles.some(f => f.isCover)
  const totalFiles = printFiles.length

  log(`━━━ 订单: ${orderNo} ━━━ 文件数: ${totalFiles}${hasCover ? ' (含封面)' : ''}`)

  if (!targetPrinter) {
    log('无目标打印机，跳过（等待WS推送）')
    processingOrders.delete(orderNo)
    return
  }

  let matched = null
  let failedFiles = []
  try {
    matched = matchPrinter(targetPrinter)
    if (!matched) throw new Error(`打印机 "${targetPrinter}" 不可用（可能忙碌或离线）`)

    log(`打印机: ${matched.name}，共 ${totalFiles} 个文件`)
    matched.status = 'busy'
    await updateStatus(orderNo, 'printing', matched.name)

    // 按顺序打印所有文件
    for (let i = 0; i < printFiles.length; i++) {
      const pf = printFiles[i]
      const fileName = pf.name || `文件${i + 1}`
      const fileUrl = pf.url
      const isCover = pf.isCover || false

      log(`[${i + 1}/${totalFiles}] ${isCover ? '📄 封面' : '📄'} ${fileName}`)

      if (!fileUrl) {
        log(`  ⚠️ 文件 ${fileName} 无URL，跳过`)
        continue
      }

      // 下载文件
      const localFile = path.join(downloadDir, `order_${orderNo}_${i}_${Date.now()}.pdf`)
      await downloadFile(fileUrl, localFile)

      // 验证 PDF
      const fileStat = fs.statSync(localFile)
      if (fileStat.size < 100) {
        log(`  ⚠️ 文件过小 (${fileStat.size}B)，跳过`)
        if (!config.KEEP_FILES) try { fs.unlinkSync(localFile) } catch {}
        continue
      }
      if (!isPDF(localFile)) {
        log(`  ⚠️ 文件不是PDF，尝试直接打印`)
        // 非PDF文件（如图片）也尝试打印
      }

      log(`  ${isCover ? '封面' : '文件'}: ${(fileStat.size / 1024).toFixed(0)}KB`)

      // 打印
      try {
        await printer.printFile(localFile, {
          printer: matched.name,
          copies: order.copies || 1,
          duplex: order.duplex || 'single',
          orderNo: orderNo,
          pageCount: pf.pageCount || 0,
        })
        log(`  ✅ 打印成功`)
      } catch (printErr) {
        log(`  ⚠️ 打印失败: ${printErr.message}`)
        failedFiles.push({ name: fileName, err: printErr.message })
      }

      // 清理临时文件
      if (!config.KEEP_FILES) {
        try { fs.unlinkSync(localFile) } catch (e) {}
      }
    }

    // 根据打印结果决定最终状态
    if (failedFiles.length > 0) {
      const errSummary = failedFiles.map(f => f.name + ': ' + f.err).join('; ')
      await updateStatus(orderNo, 'print_failed', matched.name, errSummary)
      matched.status = 'idle'
      log('X ' + orderNo + ' 有 ' + failedFiles.length + ' 个文件打印失败: ' + errSummary)
      flog('X ' + orderNo + ' 部分失败 [' + matched.name + ']')
    } else {
      await updateStatus(orderNo, 'completed', matched.name)
      matched.status = 'idle'
      log('check ' + orderNo + ' 全部打印完成 (' + totalFiles + ' 个文件)')
      flog('X ' + orderNo + ' 完成 [' + matched.name + '] ' + totalFiles + '个文件')
    }

  } catch (e) {
    err(`订单 ${orderNo} 处理失败: ${e.message}`)
    ferr(`订单 ${orderNo} 失败:`, e.message)
    await updateStatus(orderNo, 'failed', matched?.name || null, e.message)
    if (matched) matched.status = 'idle'
  } finally {
    processingOrders.delete(orderNo)
  }
}

// ===== 启动 =====
async function start() {
  console.log('')
  console.log('╔══════════════════════════════════════════╗')
  console.log('║     智能打印客户端 v5.0                ║')
  console.log('║     多文件 · 封面优先 · 自动排序       ║')
  console.log('╚══════════════════════════════════════════╝')
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
    const regRes = await api('POST', '/api/public/printer/register', {
      clientId: config.CLIENT_ID,
      clientName: require('os').hostname(),
      printers: localPrinters.map(p => ({ name: p.name }))
    })
    // 从服务端获取 enabled 配置，同步到本地
    if (regRes && regRes.data && regRes.data.printers) {
      regRes.data.printers.forEach(sp => {
        const local = localPrinters.find(p => p.name === sp.name)
        if (local) {
          local.enabled = sp.enabled !== 0 && sp.enabled !== false
          if (!local.enabled) log(`  ⛔ 打印机 "${sp.name}" 已在管理端禁用`)
        }
      })
    }
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
