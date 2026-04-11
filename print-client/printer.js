// printer.js - 简化版打印机模块
const { execSync, exec } = require('child_process')
const os = require('os')
const path = require('path')
const fs = require('fs')

const platform = os.platform()

// ===== 1. 扫描系统打印机 =====
function getPrinters() {
  try {
    if (platform === 'win32') return getWindowsPrinters()
    else if (platform === 'darwin') return getMacPrinters()
    else return getLinuxPrinters()
  } catch (e) { return [] }
}

function getWindowsPrinters() {
  try {
    const psScript = '$enc=[System.Text.Encoding]::UTF8;$data=Get-WmiObject -Class Win32_Printer|Select-Object Name,PrinterStatus,Default,DetectedErrorState|ConvertTo-Json -Compress;$bytes=$enc.GetBytes($data);[Convert]::ToBase64String($bytes)'
    const b64 = execSync(
      `chcp 65001 >nul & powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(psScript, 'utf16le').toString('base64')}`,
      { encoding: 'ascii', timeout: 15000 }
    ).trim()
    const jsonStr = Buffer.from(b64, 'base64').toString('utf8')
    let printers = JSON.parse(jsonStr)
    if (!Array.isArray(printers)) printers = [printers]
    return printers.map(p => ({
      name: p.Name,
      status: p.DetectedErrorState === 7 ? 'offline' : 'idle',
      isDefault: p.Default === true,
    }))
  } catch (e) { return [] }
}

function getMacPrinters() {
  try {
    const output = execSync('lpstat -p -d 2>/dev/null', { encoding: 'utf8' })
    return output.split('\n').map(line => {
      const m = line.match(/^printer\s+(\S+)/)
      return m ? { name: m[1], status: line.includes('idle') ? 'idle' : 'busy', isDefault: false } : null
    }).filter(Boolean)
  } catch (e) { return [] }
}

function getLinuxPrinters() {
  try {
    const output = execSync('lpstat -p 2>/dev/null', { encoding: 'utf8' })
    return output.split('\n').map(line => {
      const m = line.match(/^printer (\S+)/)
      return m ? { name: m[1], status: line.includes('enabled') ? 'idle' : 'offline', isDefault: false } : null
    }).filter(Boolean)
  } catch (e) { return [] }
}

// ===== 2. 找 SumatraPDF =====
function findSumatraPDF() {
  const paths = [
    'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
    'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
    (process.env.LOCALAPPDATA || '') + '\\SumatraPDF\\SumatraPDF.exe',
    (process.env.USERPROFILE || '') + '\\SumatraPDF\\SumatraPDF.exe',
    path.join(__dirname, 'SumatraPDF.exe'),
    path.join(__dirname, 'SumatraPDF-3.5.2-64.exe'),
  ]
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p
  }
  try {
    const found = execSync('where SumatraPDF.exe', { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0]
    if (found && fs.existsSync(found)) return found
  } catch (e) {}
  return null
}

// ===== 3. 获取 PDF 页数 =====
function getPdfPageCount(filePath) {
  try {
    if (platform === 'win32') {
      // Windows: 用 PowerShell 读取 PDF 二进制搜索 /Count
      // 用 UTF-16LE 编码脚本避免中文路径和乱码问题
      const script = `
        $bytes = [System.IO.File]::ReadAllBytes($args[0])
        $text = [System.Text.Encoding]::GetEncoding('latin1').GetString($bytes)
        if ($text -match '/Count\\s+(\\d+)') { $matches[1] } else { '0' }
      `
      const b64 = Buffer.from(script, 'utf16le').toString('base64')
      const out = execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${b64} "${filePath}"`,
        { encoding: 'utf8', timeout: 30000 }
      ).trim()
      const count = parseInt(out.split('\n').pop())
      return count > 0 ? count : 0
    } else {
      // macOS/Linux: 用 strings 命令
      const out = execSync(`strings "${filePath}" | grep -m1 '/Count ' | grep -oP '/Count \\K\\d+'`, {
        encoding: 'utf8', timeout: 30000
      }).trim()
      return parseInt(out) || 0
    }
  } catch (e) {
    return 0
  }
}

// ===== 4. 打印文件 =====
function printFile(filePath, options = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return reject(new Error('文件不存在: ' + filePath))

    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.pdf') return reject(new Error('只支持 PDF，当前: ' + ext))

    const printer = options.printer || ''
    const copies = parseInt(options.copies) || 1
    const duplex = options.duplex || 'single'
    const orderNo = options.orderNo || ''
    const pageCount = parseInt(options.pageCount) || 0  // 服务端提供的页数优先

    if (!printer) return reject(new Error('未指定打印机'))

    try {
      const header = fs.readFileSync(filePath).slice(0, 5).toString()
      if (!header.startsWith('%PDF')) return reject(new Error('不是有效 PDF'))
    } catch (e) { return reject(new Error('无法读取: ' + e.message)) }

    const fileSize = fs.statSync(filePath).size

    // 优先用服务端提供的页数，服务端没有再本地解析
    const totalPages = pageCount > 0 ? pageCount : getPdfPageCount(filePath)
    const sheetCount = duplex === 'double' ? Math.ceil(totalPages / 2) : totalPages
    const totalSheets = sheetCount * copies

    console.log(`准备打印: ${path.basename(filePath)} (${(fileSize / 1024).toFixed(0)}KB) -> ${printer}`)
    process.stdout.write('  ' + totalPages + ' 页, ' + (duplex === 'double' ? '双面' : '单面') + ', ' + copies + ' 份, 共 ' + totalSheets + ' 张\n')

    const startTime = Date.now()

    if (platform === 'win32') {
      _printSumatra(filePath, printer, copies, duplex, totalPages, orderNo, startTime, resolve, reject)
    } else {
      _printLp(filePath, printer, copies, duplex, totalPages, orderNo, startTime, resolve, reject)
    }
  })
}

// ===== 5. 进度条（单行动态刷新）=====
let _timer = null

function startProgress(orderNo, totalPages, startTime) {
  let last = -1
  _timer = setInterval(() => {
    const sec = Math.floor((Date.now() - startTime) / 1000)
    const estPages = Math.min(Math.floor(sec / 3), totalPages)
    const pct = totalPages > 0 ? Math.min(Math.round(estPages / totalPages * 100), 99) : 0
    if (pct === last) return
    last = pct
    const barLen = 18
    const filled = Math.round(barLen * pct / 100)
    const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barLen - filled)
    const min = Math.floor(sec / 60)
    const ss = sec % 60
    const ts = min > 0 ? min + '分' + ss + '秒' : ss + '秒'
    const label = orderNo ? ' [' + orderNo + ']' : ''
    process.stdout.write('\r' + label + ' \u23F3 |' + bar + '| ' + String(pct).padStart(3) + '% ~' + estPages + '/' + totalPages + '页 ' + ts + '   ')
  }, 2000)
}

function endProgress() {
  if (_timer) { clearInterval(_timer); _timer = null }
  process.stdout.write('\r' + ' '.repeat(90) + '\n')
}

// ===== 6. SumatraPDF（Windows）=====
function _printSumatra(filePath, printer, copies, duplex, totalPages, orderNo, startTime, resolve, reject) {
  const exe = findSumatraPDF()
  if (!exe) return reject(new Error(
    '找不到 SumatraPDF！\n请下载: https://www.sumatrapdfreader.org/download-free-pdf-viewer\n安装后重启客户端。'
  ))

  let s = duplex === 'double' ? ' -print-settings dupx' : ''
  let cmd = '"' + exe + '" -print-to "' + printer + '"' + s + ' -exit-on-print -silent "' + filePath + '"'
  if (copies > 1) cmd = Array(copies).fill(cmd).join(' && ')

  process.stdout.write('\r执行打印命令...')
  startProgress(orderNo, totalPages * copies, startTime)

  exec(cmd, { timeout: 600000 }, (error, stdout, stderr) => {
    endProgress()
    const sec = Math.floor((Date.now() - startTime) / 1000)
    const min = Math.floor(sec / 60)
    const ts = min > 0 ? min + '分' + (sec % 60) + '秒' : sec + '秒'
    if (error) {
      // 检查是否是虚拟打印机问题（Windows Microsoft Print to PDF）
      const isVirtualPrinter = printer && (
        printer.includes('Microsoft Print to PDF') ||
        printer.includes('Microsoft XPS Document Writer') ||
        printer.includes('Fax')
      )
      const errMsg = (stderr || error.message || '').trim()
      let hint = ''
      if (isVirtualPrinter) {
        if (errMsg.includes('Unsupported') || errMsg.includes('encrypted') || errMsg.includes('damaged')) {
          hint = '\n  💡 提示：PDF 可能受加密或损坏，请检查文件能否用浏览器打开'
        } else {
          hint = '\n  💡 提示：虚拟打印机需要 Windows 10 以上系统，请确认已安装并设为默认'
        }
      }
      process.stdout.write('\r\u274C 打印失败 (' + ts + '): ' + error.message + hint + '\n')
      return reject(new Error('打印失败: ' + error.message))
    }
    process.stdout.write('\r\u2705 打印成功: ' + path.basename(filePath) + ' (' + totalPages + '页, ' + ts + ')\n')
    resolve({ success: true, file: filePath, pages: totalPages })
  })
}

// ===== 7. lp（macOS/Linux）=====
function _printLp(filePath, printer, copies, duplex, totalPages, orderNo, startTime, resolve, reject) {
  const opt = duplex === 'double' ? ' -o sides=two-sided-long-edge' : ' -o sides=one-sided'
  const cmd = 'lp -n ' + copies + ' -d "' + printer + '"' + opt + ' "' + filePath + '"'
  process.stdout.write('\r执行打印命令...')
  startProgress(orderNo, totalPages * copies, startTime)

  exec(cmd, { timeout: 600000 }, (error) => {
    endProgress()
    const sec = Math.floor((Date.now() - startTime) / 1000)
    const min = Math.floor(sec / 60)
    const ts = min > 0 ? min + '分' + (sec % 60) + '秒' : sec + '秒'
    if (error) {
      process.stdout.write('\r\u274C 打印失败 (' + ts + '): ' + error.message + '\n')
      return reject(new Error('打印失败: ' + error.message))
    }
    process.stdout.write('\r\u2705 打印成功: ' + path.basename(filePath) + ' (' + totalPages + '页, ' + ts + ')\n')
    resolve({ success: true, file: filePath, pages: totalPages })
  })
}

module.exports = { getPrinters, printFile }
