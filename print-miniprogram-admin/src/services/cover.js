// src/services/cover.js - 封面生成服务（y=0 为页面顶部）
const PDFDocument = require('pdfkit')
const fs = require('fs')
const path = require('path')
const db = require('../db')
const { shanghaiDate } = require('../utils')

const COVER_DIR = path.join(__dirname, '../../uploads/covers')
if (!fs.existsSync(COVER_DIR)) fs.mkdirSync(COVER_DIR, { recursive: true })

// ===== 中文字体 =====
const FONT_DIR = path.join(__dirname, '../../fonts')
const CN_FONT_REGULAR = path.join(FONT_DIR, 'NotoSansSC-Regular.ttf')
const CN_FONT_BOLD = path.join(FONT_DIR, 'NotoSansSC-Bold.ttf')
const CN_REGULAR = fs.existsSync(CN_FONT_REGULAR) ? 'CN-Regular' : 'Helvetica'
const CN_BOLD = fs.existsSync(CN_FONT_BOLD) ? 'CN-Bold' : CN_REGULAR

function registerFonts(doc) {
  if (fs.existsSync(CN_FONT_REGULAR)) doc.registerFont('CN-Regular', CN_FONT_REGULAR)
  if (fs.existsSync(CN_FONT_BOLD)) doc.registerFont('CN-Bold', CN_FONT_BOLD)
}

// ===== 文档类型检测 =====
const DOC_TYPES = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf']
function isDocumentFile(fileName) {
  return DOC_TYPES.includes((fileName.split('.').pop() || '').toLowerCase())
}

// ===== 获取序号规则配置 =====
async function getSeqRule() {
  try {
    const rows = await db.query("SELECT `value` FROM config WHERE `key` = 'seq_rule' LIMIT 1")
    return rows[0]?.value || 'daily'
  } catch { return 'daily' }
}

// ===== 序号生成（hourly，按小时自增，原子操作）=====
async function getNextDocSeq() {
  const today = shanghaiDate()
  // 直接使用上海日期字符串
  const todayStr = today  // "2026-04-15"
  const currentHour = new Date().getHours()
  const seqRule = await getSeqRule()

  // 使用事务保证原子性，先检查表结构是否有小时字段
  try {
    const tableInfo = await db.query('DESCRIBE order_sequences')
    const hasHourField = tableInfo.some(col => col.Field === 'current_seq_hour')
    
    if (seqRule === 'hourly') {
      if (!hasHourField) {
        // 表没有小时计数字段，先添加
        try {
          await db.query('ALTER TABLE order_sequences ADD COLUMN current_hour TINYINT DEFAULT -1 AFTER current_seq')
          await db.query('ALTER TABLE order_sequences ADD COLUMN current_seq_hour INT DEFAULT 0 AFTER current_hour')
        } catch (e) {
          console.log('[Cover] 添加小时字段失败，可能已存在:', e.message)
        }
      }
      
      // 原子操作：使用事务确保同一小时内序号自增
      const conn = await db.getPool().getConnection()
      try {
        await conn.beginTransaction()
        
        // 检查今天当前小时的记录是否存在 - 使用DATE()函数避免时区问题
        const [rows] = await conn.query(
          'SELECT current_seq_hour FROM order_sequences WHERE DATE(seq_date) = ? AND current_hour = ?',
          [todayStr, currentHour]
        )
        
        let seq
        if (rows.length === 0) {
          // 新小时，插入初始记录
          await conn.query(
            'INSERT INTO order_sequences (seq_date, current_hour, current_seq_hour) VALUES (?, ?, 1)',
            [todayStr, currentHour]
          )
          seq = 1
        } else {
          // 当前小时序号+1
          await conn.query(
            'UPDATE order_sequences SET current_seq_hour = current_seq_hour + 1 WHERE DATE(seq_date) = ? AND current_hour = ?',
            [todayStr, currentHour]
          )
          const [updated] = await conn.query(
            'SELECT current_seq_hour as seq FROM order_sequences WHERE DATE(seq_date) = ? AND current_hour = ?',
            [todayStr, currentHour]
          )
          seq = updated[0]?.seq || 1
        }
        
        await conn.commit()
        return { 
          date: today, 
          seq, 
          hour: currentHour, 
          displaySeq: String(currentHour).padStart(2, '0') + '-' + String(seq).padStart(2, '0') 
        }
      } catch (err) {
        await conn.rollback()
        throw err
      } finally {
        conn.release()
      }
    }
    
    // daily 模式
    if (!hasHourField) {
      try {
        await db.query('ALTER TABLE order_sequences ADD COLUMN current_hour TINYINT DEFAULT -1 AFTER current_seq')
        await db.query('ALTER TABLE order_sequences ADD COLUMN current_seq_hour INT DEFAULT 0 AFTER current_hour')
      } catch (e) {}
    }
    
    const conn = await db.getPool().getConnection()
    try {
      await conn.beginTransaction()
      await conn.query('INSERT IGNORE INTO order_sequences (seq_date, current_seq) VALUES (?, 0)', [todayDate])
      await conn.query('UPDATE order_sequences SET current_seq = current_seq + 1 WHERE seq_date = ?', [todayDate])
      const [rows] = await conn.query('SELECT current_seq FROM order_sequences WHERE seq_date = ?', [todayDate])
      await conn.commit()
      const row = rows[0]
      return { date: today, seq: row?.current_seq || 1, displaySeq: String(row?.current_seq || 1).padStart(4, '0') }
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  } catch (err) {
    console.error('[Cover] 序号生成失败:', err.message)
    // 降级处理：使用内存锁+随机数（仅用于开发环境）
    const fallbackHour = new Date().getHours()
    const randSeq = Math.floor(Math.random() * 90) + 1
    return { 
      date: today, 
      seq: randSeq, 
      hour: fallbackHour, 
      displaySeq: String(fallbackHour).padStart(2, '0') + '-' + String(randSeq).padStart(2, '0') 
    }
  }
}

// ===== 生成封面 PDF（严格3行格式）=====
// 第1行：取单号（大号、加粗、大写）- 左上角横向排列
// 第2行：新兵云印（居中）
// 第3行：打印信息（文件名、页数、单双面）
async function generateCover(orderNo, seq, displaySeq, dateStr, options = {}) {
  const { fileNames = [], totalPages = 0, copies = 1, duplex } = options

  return new Promise((resolve, reject) => {
    const coverFileName = `cover_${orderNo}_${Date.now()}.pdf`
    const coverPath = path.join(COVER_DIR, coverFileName)

    const doc = new PDFDocument({ size: 'A4', margin: 0 })  // A4: 595×842
    registerFonts(doc)
    const stream = fs.createWriteStream(coverPath)
    doc.pipe(stream)

    const W = doc.page.width   // 595
    const H = doc.page.height  // 842

    // 白色背景
    doc.rect(0, 0, W, H).fill('#ffffff')

    // ===== 严格3行格式 =====    
    const LEFT_MARGIN = 30      // 左边距
    const TOP_MARGIN = 80      // 上边距（居中调整）
    const LINE_HEIGHT = 50     // 行高
    
    // 取单号显示：第1行（大号、加粗、大写）
    let y = TOP_MARGIN
    doc.fontSize(32).fillColor('#000000').font(CN_BOLD)
    const seqText = displaySeq ? displaySeq.toUpperCase() : ''
    doc.text(seqText, LEFT_MARGIN, y, { lineBreak: false })

    // 第2行：新兵云印（左对齐）
    y += LINE_HEIGHT
    const SHOP_NAME = '新兵云印'
    doc.fontSize(28).fillColor('#000000').font(CN_BOLD)
    doc.text(SHOP_NAME, LEFT_MARGIN, y, { lineBreak: false })

    // 第3行：打印信息（文件名、页数、单双面）
    y += LINE_HEIGHT
    doc.fontSize(16).fillColor('#333333').font(CN_REGULAR)
    
    // 组合打印信息：文件名(简化) + 页数 + 单双面
    const mainFileName = fileNames.length > 0 ? fileNames[0] : '未命名'
    const shortName = mainFileName.length > 15 ? mainFileName.substring(0, 12) + '...' : mainFileName
    const printMode = duplex === 'double' ? '双面' : '单面'
    const printInfo = `${shortName} | ${totalPages}页 | ${printMode}打印`
    
    // 左对齐显示
    doc.text(printInfo, LEFT_MARGIN, y, { lineBreak: false })

    doc.end()
    stream.on('finish', () => resolve(`/uploads/covers/${coverFileName}`))
    stream.on('error', err => { console.error('[Cover] 生成失败:', err); reject(err) })
  })
}

// ===== 处理订单文件 + 生成封面 =====
async function processOrderFiles(orderNo, files, options = {}) {
  const { copies = 1, colorMode = 'bw', paperSize = 'A4', duplex } = options
  const hasDoc = files.some(f => isDocumentFile(f.name || ''))
  let docSeq = null, coverUrl = null, totalPages = 0

  for (const f of files) totalPages += parseInt(f.pageCount || 1)

  if (hasDoc) {
    try {
      const seqInfo = await getNextDocSeq()
      docSeq = seqInfo

      const todayStr = new Date().toLocaleDateString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit', timeHour12: false,
        timeZone: 'Asia/Shanghai'
      }).replace(/\//g, '年').replace(',', '').replace(' ', ' ') + ' ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' })

      coverUrl = await generateCover(orderNo, seqInfo.seq, seqInfo.displaySeq, todayStr, {
        fileNames: files.map(f => f.name), totalPages, copies, colorMode, paperSize, duplex
      })

      console.log(`[Cover] 订单 ${orderNo} 封面: ${seqInfo.displaySeq} -> ${coverUrl}`)

      await db.query(
        'UPDATE orders SET order_seq = ?, doc_seq_date = ?, print_seq = ?, total_pages = ?, updated_at = NOW() WHERE order_no = ?',
        [seqInfo.seq, seqInfo.date, seqInfo.displaySeq, totalPages, orderNo]
      )
    } catch (err) {
      console.error('[Cover] 封面生成失败:', err)
    }
  }

  return { needsCover: hasDoc, coverUrl, coverSeq: docSeq?.displaySeq || null, totalPages, docFilesCount: files.filter(f => isDocumentFile(f.name || '')).length }
}

// ===== 获取订单所有打印文件（含封面）=====
async function getOrderPrintFiles(order) {
  const files = order.files
    ? (typeof order.files === 'string' ? JSON.parse(order.files) : order.files)
    : (order.file_url ? [{ name: order.file_name, url: order.file_url }] : [])

  const printFiles = []

  if (order.print_seq) {
    const covers = fs.readdirSync(COVER_DIR).filter(f => f.startsWith(`cover_${order.order_no}_`))
    if (covers.length > 0) {
      printFiles.push({ name: `封面_${order.print_seq}.pdf`, url: `/uploads/covers/${covers[0]}`, isCover: true, pageCount: 1 })
    }
  }

  for (const file of files) {
    printFiles.push({ name: file.name, url: file.url, isCover: false, pageCount: parseInt(file.pageCount || file.pages || 1) })
  }

  return printFiles
}

module.exports = { isDocumentFile, getFileExt: (n) => (n.split('.').pop() || '').toLowerCase(), getNextDocSeq, generateCover, processOrderFiles, getOrderPrintFiles, COVER_DIR }
