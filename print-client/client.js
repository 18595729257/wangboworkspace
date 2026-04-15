// client.js - 智能打印客户端 v6.0（升级：多打印机并行 + 多文件打印）
// 架构：每台打印机独立任务队列，并行执行，互不阻塞

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

// ===== 全局状态 =====
let localPrinters = []           // 本地打印机列表
let ws = null
let wsConnected = false
let pollTimer = null
let reconnectTimer = null
let heartbeatTimer = null
const processingOrders = new Set()  // 全局订单去重
const printerQueues = new Map()     // 打印机名 -> 任务队列
const printerWorkers = new Map()    // 打印机名 -> 是否正在工作

// ===== HTTP 请求工具 =====
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
          if (res.statusCode === 403 && !isRetry && config.API_URL_FALLBACK) {
            log('域名返回 403，降级到 IP...')
            return tryRequest(config.API_URL_FALLBACK, true)
          }
          try { 
            resolve(JSON.parse(body)) 
          } catch (e) { 
            reject(new Error('响应解析失败'))
          }
        })
      })
      req.on('error', (e) => {
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

// ===== WebSocket =====
function connectWS() {
  if (ws?.readyState === 1) return
  const WebSocket = require('ws')
  const u = new URL(config.API_URL)
  const wsUrl = `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/ws/printer?clientId=${encodeURIComponent(config.CLIENT_ID)}`
  log('连接 WebSocket:', wsUrl.replace(/\?.*$/, ''))
  ws = new WebSocket(wsUrl, { rejectUnauthorized: false })
  ws.on('open', () => {
    log('WebSocket 已连接')
    wsConnected = true
    ws.send(JSON.stringify({ type: 'register', clientId: config.CLIENT_ID, printers: localPrinters.map(p => ({ name: p.name, status: p.status })) }))
  })
  ws.on('message', data => {
    try {
      const msg = JSON.parse(data)
      if (msg.type === 'print_task') {
        const order = Array.isArray(msg.data) ? msg.data[0] : msg.data
        if (!order) { err('WS消息无订单数据'); return }
        const printFiles = msg.printFiles?.length > 0
          ? msg.printFiles
          : [{ name: order.file_name, url: order.file_url, isCover: false }]
        const targetPrinter = msg.targetPrinter || order.printer
        assignTaskToPrinter(order, printFiles, targetPrinter)
      }
    } catch (e) { err('WS消息解析失败:', e.message) }
  })
  ws.on('close', () => { wsConnected = false; log('WebSocket 断开，5秒后重连...'); setTimeout(connectWS, 5000) })
  ws.on('error', e => { err('WebSocket 错误:', e.message); wsConnected = false })
}

// ===== 轮询 =====
async function poll() {
  try {
    // 获取待打印任务
    const r = await api('GET', `/api/public/printer/pending?clientId=${encodeURIComponent(config.CLIENT_ID)}`)
    if (r.code === 200 && r.data?.length) {
      log(`轮询发现 ${r.data.length} 个待打印任务`)
      r.data.forEach(o => {
        const printFiles = o.printFiles?.length > 0
          ? o.printFiles
          : [{ name: o.file_name, url: o.file_url, isCover: false }]
        // 优先用服务端分配的打印机，否则用轮询分配的
        const targetPrinter = o.targetPrinter || o.printer || null
        if (targetPrinter) {
          assignTaskToPrinter(o, printFiles, targetPrinter)
        } else {
          log(`⚠️ 订单 ${o.order_no} 无目标打印机，跳过`)
        }
      })
    }
  } catch (e) { err('轮询失败:', e.message) }
}

// ===== 更新订单状态 =====
async function updateStatus(orderNo, status, printerName, error, totalPages) {
  const payload = { type: 'print_status', orderNo, status, printerName, error }
  if (totalPages && totalPages > 0) payload.totalPages = totalPages
  if (wsConnected && ws?.readyState === 1) {
    ws.send(JSON.stringify(payload))
    log(`状态: ${orderNo} → ${status} (${totalPages || '?'}页)`)
    return
  }
  try {
    await api('PUT', `/api/public/order/${orderNo}/print-status`, {
      status, clientId: config.CLIENT_ID, printerName, error,
      ...(totalPages && totalPages > 0 ? { totalPages } : {})
    })
    log(`状态: ${orderNo} → ${status} (${totalPages || '?'}页)`)
  } catch (e) { err(`状态更新失败: ${orderNo}`); ferr('状态更新失败:', orderNo, e.message) }
}

// ===== 获取指定打印机 =====
// 服务端已分配好打印机，客户端只负责找到本地对应的打印机执行
function getTargetPrinter(printerName) {
  // 直接按名称匹配，不检查启用状态（服务端已筛选）
  const p = localPrinters.find(p => p.name === printerName)
  if (p) {
    p.status = 'busy'  // 标记为忙碌
    return p
  }
  // 如果没找到指定打印机，尝试找任意空闲打印机（降级）
  return localPrinters.find(p => p.status === 'idle') || null
}

// ===== 判断PDF =====
function isPDF(filePath) {
  try {
    const header = fs.readFileSync(filePath).slice(0, 5).toString()
    return header.startsWith('%PDF')
  } catch (e) { return false }
}

// ===== 【核心】分配任务到打印机队列 =====
function assignTaskToPrinter(order, printFiles, targetPrinter) {
  const orderNo = order.order_no || order.orderNo
  if (processingOrders.has(orderNo)) return
  processingOrders.add(orderNo)

  const printerName = targetPrinter || 'default'
  
  // 初始化打印机队列
  if (!printerQueues.has(printerName)) {
    printerQueues.set(printerName, [])
  }
  
  // 添加任务到队列
  const queue = printerQueues.get(printerName)
  queue.push({ order, printFiles, targetPrinter, orderNo })
  
  log(`任务 ${orderNo} 分配到打印机队列: ${printerName} (队列长度: ${queue.length})`)
  
  // 启动该打印机的工作线程（如果未运行）
  if (!printerWorkers.get(printerName)) {
    startPrinterWorker(printerName)
  }
}

// ===== 【核心】打印机工作线程（独立并行）=====
async function startPrinterWorker(printerName) {
  if (printerWorkers.get(printerName)) return  // 已在运行
  printerWorkers.set(printerName, true)
  
  log(`打印机 ${printerName} 工作线程启动`)
  
  while (true) {
    const queue = printerQueues.get(printerName)
    if (!queue || queue.length === 0) {
      // 队列为空，退出工作线程
      break
    }
    
    // 取出一个任务
    const task = queue.shift()
    await executePrintTask(task)
  }
  
  printerWorkers.set(printerName, false)
  log(`打印机 ${printerName} 工作线程结束`)
}

// ===== 执行单个打印任务 =====
async function executePrintTask({ order, printFiles, targetPrinter, orderNo }) {
  const hasCover = printFiles.some(f => f.isCover)
  const totalFiles = printFiles.length
  
  log(`━━━ 开始打印订单: ${orderNo} ━━━ 文件数: ${totalFiles}${hasCover ? ' (含封面)' : ''}`)
  
  // 使用服务端指定的打印机
  const matched = getTargetPrinter(targetPrinter)
  if (!matched) {
    log(`❌ 本地无此打印机: ${targetPrinter || 'default'}`)
    await updateStatus(orderNo, 'failed', null, '本地无指定打印机')
    processingOrders.delete(orderNo)
    return
  }
  
  log(`使用打印机: ${matched.name} (服务端指定: ${targetPrinter})`)
  await updateStatus(orderNo, 'printing', matched.name)
  
  const failedFiles = []
  
  try {
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
      
      // 下载，保持原文件扩展名
      const originalExt = (pf.name || 'file.pdf').replace(/.*(\.[^.]+)$/, '$1')
      const localFile = path.join(downloadDir, `order_${orderNo}_${i}_${Date.now()}${originalExt}`)
      try {
        await downloadFile(fileUrl, localFile)
      } catch (e) {
        log(`  ❌ 下载失败: ${e.message}`)
        failedFiles.push({ name: fileName, err: '下载失败: ' + e.message })
        continue
      }
      
      // 验证
      const fileStat = fs.statSync(localFile)
      if (fileStat.size < 100) {
        log(`  ⚠️ 文件过小，跳过`)
        if (!config.KEEP_FILES) try { fs.unlinkSync(localFile) } catch {}
        continue
      }
      
      // 打印
      try {
        await printer.printFile(localFile, {
          printer: matched.name,
          copies: order.copies || 1,
          duplex: order.duplex || 'single',
          orderNo,
          pageCount: pf.pageCount || 0
        })
        log(`  ✅ 打印成功`)
      } catch (printErr) {
        log(`  ❌ 打印失败: ${printErr.message}`)
        failedFiles.push({ name: fileName, err: printErr.message })
      }
      
      // 清理
      if (!config.KEEP_FILES) {
        try { fs.unlinkSync(localFile) } catch {}
      }
    }
    
    // 计算总页数（用于按页数分配策略）
      let orderTotalPages = 0
      for (const pf of printFiles) {
        orderTotalPages += pf.pageCount || 1
      }
    
    // 更新最终状态
    if (failedFiles.length > 0) {
      const errSummary = failedFiles.map(f => f.name + ': ' + f.err).join('; ')
      await updateStatus(orderNo, 'print_failed', matched.name, errSummary, orderTotalPages)
      log(`❌ ${orderNo} 部分失败: ${errSummary}`)
      flog(`订单 ${orderNo} 部分失败 [${matched.name}]`)
    } else {
      await updateStatus(orderNo, 'completed', matched.name, null, orderTotalPages)
      log(`✅ ${orderNo} 全部完成`)
      flog(`订单 ${orderNo} 完成 [${matched.name}]`)
    }
    
  } catch (e) {
    err(`订单 ${orderNo} 异常:`, e.message)
    await updateStatus(orderNo, 'failed', matched?.name, e.message)(orderNo, 'failed', matched?.name, e.message)
  } finally {
    matched.status = 'idle'
    processingOrders.delete(orderNo)
  }
}

// ===== 启动 =====
async function start() {
  console.log('')
  console.log('╔══════════════════════════════════════════╗')
  console.log('║     智能打印客户端 v6.0                ║')
  console.log('║     多打印机并行 · 多文件打印          ║')
  console.log('╚══════════════════════════════════════════╝')
  console.log('')
  log(`API: ${config.API_URL}`)
  log(`ID: ${config.CLIENT_ID}`)
  
  // 初始化打印机
  localPrinters = await printer.getPrinters()
  log(`发现 ${localPrinters.length} 台打印机:`)
  localPrinters.forEach(p => log(`  - ${p.name} (${p.isDefault ? '默认' : ''})`))
  
  // 连接WebSocket
  connectWS()
  
  // 启动轮询
  pollTimer = setInterval(poll, 5000)
  poll()
  
  // 心跳
  heartbeatTimer = setInterval(async () => {
    try {
      await api('POST', '/api/public/printer/heartbeat', {
        clientId: config.CLIENT_ID,
        printers: localPrinters.map(p => ({ name: p.name, status: p.status, enabled: p.enabled !== false }))
      })
    } catch (e) {}
  }, 30000)
}

start().catch(e => { err('启动失败:', e.message); process.exit(1) })

// 优雅退出
process.on('SIGINT', () => {
  log('\n正在退出...')
  if (pollTimer) clearInterval(pollTimer)
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  if (ws) ws.close()
  process.exit(0)
})
