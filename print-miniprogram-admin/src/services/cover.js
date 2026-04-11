// src/services/cover.js - 封面生成 + 多文件管理服务
const PDFDocument = require('pdfkit')
const fs = require('fs')
const path = require('path')
const db = require('../db')
const { shanghaiDate } = require('../utils')

const UPLOAD_DIR = path.join(__dirname, '../../uploads')
const COVER_DIR = path.join(__dirname, '../../uploads/covers')

// 确保目录存在
if (!fs.existsSync(COVER_DIR)) fs.mkdirSync(COVER_DIR, { recursive: true })

// ===== 注册中文字体 =====
const FONT_DIR = path.join(__dirname, '../../fonts')
const CN_FONT_REGULAR = path.join(FONT_DIR, 'NotoSansSC-Regular.ttf')
const CN_FONT_BOLD = path.join(FONT_DIR, 'NotoSansSC-Bold.ttf')
const CN_REGULAR = fs.existsSync(CN_FONT_REGULAR) ? 'CN-Regular' : 'Helvetica'
const CN_BOLD = fs.existsSync(CN_FONT_BOLD) ? 'CN-Bold' : (fs.existsSync(CN_FONT_REGULAR) ? 'CN-Regular' : 'Helvetica-Bold')

function registerFonts(doc) {
  if (fs.existsSync(CN_FONT_REGULAR)) {
    doc.registerFont('CN-Regular', CN_FONT_REGULAR)
  }
  if (fs.existsSync(CN_FONT_BOLD)) {
    doc.registerFont('CN-Bold', CN_FONT_BOLD)
  }
}

// ===== 文档类型检测 =====
const DOC_TYPES = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf']

function isDocumentFile(fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase()
  return DOC_TYPES.includes(ext)
}

function getFileExt(fileName) {
  return (fileName.split('.').pop() || '').toLowerCase()
}

// ===== 序号生成（原子操作，用 MySQL 存储过程）=====
async function getNextDocSeq() {
  const today = shanghaiDate()
  const todayDate = new Date(today + 'T00:00:00')

  try {
    // 使用存储过程原子获取序号
    const rows = await db.query(
      'CALL get_next_order_seq(?, @seq)',
      [todayDate]
    )
    // MySQL 存储过程会修改用户变量，SELECT 变量获取
    const seqRow = await db.getOne('SELECT @seq as seq')
    const seq = seqRow?.seq

    if (seq == null) {
      // 存储过程不可用，手动原子操作
      return await getNextDocSeqManual()
    }

    return { date: today, seq, paddedSeq: String(seq).padStart(4, '0') }
  } catch (err) {
    console.error('[Cover] 存储过程获取序号失败:', err.message)
    // 降级：手动原子操作
    return await getNextDocSeqManual()
  }
}

// 手动原子序号（存储过程不可用时的降级方案）
async function getNextDocSeqManual() {
  const today = shanghaiDate()
  const todayDate = new Date(today + 'T00:00:00')

  await db.query(
    'INSERT IGNORE INTO order_sequences (seq_date, current_seq) VALUES (?, 0)',
    [todayDate]
  )

  await db.query(
    'UPDATE order_sequences SET current_seq = current_seq + 1 WHERE seq_date = ?',
    [todayDate]
  )

  const row = await db.getOne(
    'SELECT current_seq FROM order_sequences WHERE seq_date = ?',
    [todayDate]
  )

  return {
    date: today,
    seq: row?.current_seq || 1,
    paddedSeq: String(row?.current_seq || 1).padStart(4, '0')
  }
}

// ===== 生成封面 PDF =====
async function generateCover(orderNo, seq, dateStr, options = {}) {
  const {
    fileNames = [],
    totalPages = 0,
    copies = 1,
    colorMode = 'bw',
    paperSize = 'A4'
  } = options

  return new Promise((resolve, reject) => {
    const coverFileName = `cover_${orderNo}_${Date.now()}.pdf`
    const coverPath = path.join(COVER_DIR, coverFileName)

    // A4: 595.28 x 841.89, A3: 841.89 x 1190.55
    const pageSize = paperSize === 'A3' ? 'A3' : 'A4'
    const doc = new PDFDocument({ size: pageSize, margin: 40 })
    registerFonts(doc)

    const stream = fs.createWriteStream(coverPath)
    doc.pipe(stream)

    // 背景
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#ffffff')

    // 顶部装饰线
    doc.strokeColor('#4A90D9')
      .lineWidth(3)
      .moveTo(40, 60)
      .lineTo(doc.page.width - 40, 60)
      .stroke()

    // 标题
    doc.fontSize(36)
      .fillColor('#333333')
      .font(CN_BOLD)
      .text('新兵云印', 40, 100, { align: 'center' })

    // 分隔线
    doc.strokeColor('#4A90D9')
      .lineWidth(1)
      .moveTo(80, 150)
      .lineTo(doc.page.width - 80, 150)
      .stroke()

    // 序号（大字居中）
    doc.fontSize(72)
      .fillColor('#4A90D9')
      .font(CN_BOLD)
      .text(seq, 0, 180, { align: 'center', width: doc.page.width })

    // 日期
    doc.fontSize(16)
      .fillColor('#666666')
      .font(CN_REGULAR)
      .text(dateStr, 0, 290, { align: 'center', width: doc.page.width })

    // 信息区块
    const boxY = 340
    const boxH = 180
    const boxX = 80
    const boxW = doc.page.width - 160

    // 信息框背景
    doc.roundedRect(boxX, boxY, boxW, boxH, 8)
      .fillAndStroke('#F5F9FF', '#4A90D9')

    const infoY = boxY + 25
    const lineH = 32
    const labelX = boxX + 20
    const valueX = boxX + 160

    doc.fillColor('#333333').font(CN_BOLD).fontSize(12)

    // 订单号
    doc.text('订单号', labelX, infoY, { lineBreak: false })
    doc.fillColor('#4A90D9').font(CN_REGULAR).fontSize(14)
    doc.text(orderNo, valueX, infoY - 1)

    doc.fillColor('#333333').font(CN_BOLD).fontSize(12)

    // 日期
    doc.text('打印日期', labelX, infoY + lineH, { lineBreak: false })
    doc.fillColor('#4A90D9').font(CN_REGULAR).fontSize(14)
    doc.text(dateStr, valueX, infoY + lineH - 1)

    // 文件数
    doc.fillColor('#333333').font(CN_BOLD).fontSize(12)
    doc.text('文件数量', labelX, infoY + lineH * 2, { lineBreak: false })
    doc.fillColor('#4A90D9').font(CN_REGULAR).fontSize(14)
    doc.text(`${fileNames.length} 个文件`, valueX, infoY + lineH * 2 - 1)

    // 总页数
    doc.fillColor('#333333').font(CN_BOLD).fontSize(12)
    doc.text('总 页 数', labelX, infoY + lineH * 3, { lineBreak: false })
    doc.fillColor('#4A90D9').font(CN_REGULAR).fontSize(14)
    doc.text(`${totalPages} 页 × ${copies} 份`, valueX, infoY + lineH * 3 - 1)

    // 底部装饰
    doc.strokeColor('#4A90D9')
      .lineWidth(2)
      .moveTo(40, 750)
      .lineTo(doc.page.width - 40, 750)
      .stroke()

    // 底部文字
    doc.fontSize(10)
      .fillColor('#999999')
      .font(CN_REGULAR)
      .text('此页为打印封面，请与文档一并打印', 40, 760, { align: 'center', width: doc.page.width - 80, lineBreak: false })

    doc.end()

    stream.on('finish', () => {
      resolve(`/uploads/covers/${coverFileName}`)
    })

    stream.on('error', (err) => {
      console.error('[Cover] 生成封面失败:', err)
      reject(err)
    })
  })
}

// ===== 处理多文件订单（上传后调用）=====
// 返回处理结果：{ needsCover, coverUrl, files, totalPages, docSeq }
async function processOrderFiles(orderNo, files, options = {}) {
  const { copies = 1, colorMode = 'bw', paperSize = 'A4' } = options

  // 1. 判断是否需要封面（只要有一个文档文件就需要封面）
  const hasDoc = files.some(f => isDocumentFile(f.name || ''))
  const docFiles = files.filter(f => isDocumentFile(f.name || ''))

  let docSeq = null
  let coverUrl = null
  let totalPages = 0

  // 2. 计算总页数
  for (const file of files) {
    totalPages += parseInt(file.pageCount || 1)
  }

  // 3. 如果有文档类文件，生成封面
  if (hasDoc) {
    try {
      const seqInfo = await getNextDocSeq()
      docSeq = seqInfo

      const todayStr = new Date().toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Shanghai'
      })

      coverUrl = await generateCover(
        orderNo,
        seqInfo.paddedSeq,
        todayStr,
        {
          fileNames: files.map(f => f.name),
          totalPages,
          copies,
          colorMode,
          paperSize
        }
      )

      console.log(`[Cover] 订单 ${orderNo} 生成封面: 序号=${seqInfo.paddedSeq}, 封面=${coverUrl}`)

      // 更新订单的序号字段（order_seq + print_seq）
      await db.query(
        'UPDATE orders SET order_seq = ?, doc_seq_date = ?, print_seq = ?, updated_at = NOW() WHERE order_no = ?',
        [seqInfo.seq, seqInfo.date, seqInfo.paddedSeq, orderNo]
      )
    } catch (err) {
      console.error('[Cover] 生成封面失败:', err)
      // 封面失败不影响订单创建
    }
  }

  return {
    needsCover: hasDoc,
    coverUrl,
    coverSeq: docSeq?.paddedSeq || null,
    totalPages,
    docFilesCount: docFiles.length
  }
}

// ===== 获取订单的所有打印文件（包含封面）=====
// 返回相对路径，由客户端拼接完整 URL
async function getOrderPrintFiles(order) {
  const files = order.files
    ? (typeof order.files === 'string' ? JSON.parse(order.files) : order.files)
    : (order.file_url ? [{ name: order.file_name, url: order.file_url }] : [])

  const printFiles = []

  // 如果有封面，封面在最前面
  if (order.order_seq && order.doc_seq_date) {
    // 封面文件名规律
    const coverFiles = fs.readdirSync(COVER_DIR).filter(f => f.startsWith(`cover_${order.order_no}_`))
    if (coverFiles.length > 0) {
      printFiles.push({
        name: `封面_${order.order_seq}.pdf`,
        url: `/uploads/covers/${coverFiles[0]}`,
        isCover: true,
        orderSeq: order.order_seq,
        pageCount: 1
      })
    }
  }

  // 添加原文件
  for (const file of files) {
    printFiles.push({
      name: file.name,
      url: file.url,
      isCover: false,
      pageCount: parseInt(file.pageCount || file.pages || 1)
    })
  }

  return printFiles
}

module.exports = {
  isDocumentFile,
  getFileExt,
  getNextDocSeq,
  generateCover,
  processOrderFiles,
  getOrderPrintFiles,
  UPLOAD_DIR,
  COVER_DIR
}
