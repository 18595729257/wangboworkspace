// printer.js - 简化版打印机模块
// 只做两件事：1. 扫描打印机 2. 用 SumatraPDF 打印 PDF
// 绝不调用 Word/WPS/COM，永不报 RPC 错误

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
  } catch (e) {
    console.error('扫描打印机失败:', e.message)
    return []
  }
}

// Windows：用 PowerShell 查打印机列表
function getWindowsPrinters() {
  try {
    // 用 base64 编码输出，避免 PowerShell 中文编码问题
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
  } catch (e) {
    console.error('Windows 打印机扫描失败:', e.message)
    return []
  }
}

// macOS
function getMacPrinters() {
  try {
    const output = execSync('lpstat -p -d 2>/dev/null', { encoding: 'utf8' })
    const printers = []
    output.split('\n').forEach(line => {
      const match = line.match(/^printer\s+(\S+)/)
      if (match) printers.push({ name: match[1], status: line.includes('idle') ? 'idle' : 'busy', isDefault: false })
    })
    return printers
  } catch (e) { return [] }
}

// Linux
function getLinuxPrinters() {
  try {
    const output = execSync('lpstat -p 2>/dev/null', { encoding: 'utf8' })
    const printers = []
    output.split('\n').forEach(line => {
      const match = line.match(/^printer (\S+)/)
      if (match) printers.push({ name: match[1], status: line.includes('enabled') ? 'idle' : 'offline', isDefault: false })
    })
    return printers
  } catch (e) { return [] }
}

// ===== 2. 找 SumatraPDF =====
function findSumatraPDF() {
  const possiblePaths = [
    'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe',
    'C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe',
    (process.env.LOCALAPPDATA || '') + '\\SumatraPDF\\SumatraPDF.exe',
    (process.env.USERPROFILE || '') + '\\SumatraPDF\\SumatraPDF.exe',
    // 当前目录下
    path.join(__dirname, 'SumatraPDF.exe'),
    path.join(__dirname, 'SumatraPDF-3.5.2-64.exe'),
  ]
  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) {
      console.log('找到 SumatraPDF:', p)
      return p
    }
  }
  // 试试 PATH 里有没有
  try {
    const found = execSync('where SumatraPDF.exe', { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0]
    if (found && fs.existsSync(found)) {
      console.log('找到 SumatraPDF (PATH):', found)
      return found
    }
  } catch (e) {}
  return null
}

// ===== 3. 打印 PDF 文件 =====
// 这是唯一的打印入口，只接受 PDF 文件
function printFile(filePath, options = {}) {
  return new Promise((resolve, reject) => {
    // 基本检查
    if (!fs.existsSync(filePath)) {
      return reject(new Error('文件不存在: ' + filePath))
    }

    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.pdf') {
      return reject(new Error('只支持打印 PDF 文件。当前文件: ' + ext + '。请确保服务端已将 Office 文件转为 PDF。'))
    }

    const printerName = options.printer || ''
    const copies = parseInt(options.copies) || 1

    if (!printerName) {
      return reject(new Error('未指定打印机名称'))
    }

    // 验证文件是有效 PDF
    try {
      const header = fs.readFileSync(filePath).slice(0, 5).toString()
      if (!header.startsWith('%PDF')) {
        return reject(new Error('文件不是有效的 PDF 格式，文件头: ' + JSON.stringify(header)))
      }
    } catch (e) {
      return reject(new Error('无法读取文件: ' + e.message))
    }

    const fileSize = fs.statSync(filePath).size
    console.log(`准备打印: ${path.basename(filePath)} (${(fileSize / 1024).toFixed(0)}KB) → ${printerName} × ${copies}份`)

    if (platform === 'win32') {
      printWithSumatra(filePath, printerName, copies, resolve, reject)
    } else if (platform === 'darwin') {
      printWithLp(filePath, printerName, copies, resolve, reject)
    } else {
      printWithLp(filePath, printerName, copies, resolve, reject)
    }
  })
}

// Windows：用 SumatraPDF 打印
function printWithSumatra(filePath, printerName, copies, resolve, reject) {
  const sumatra = findSumatraPDF()
  if (!sumatra) {
    return reject(new Error(
      '找不到 SumatraPDF！\n' +
      '请下载安装: https://www.sumatrapdfreader.org/download-free-pdf-viewer\n' +
      '安装后重启打印客户端即可。'
    ))
  }

  // 用 SumatraPDF 命令行打印
  // -print-to "打印机名"  指定打印机
  // -exit-on-print        打印完自动退出
  // -silent               不弹窗口
  let cmd = `"${sumatra}" -print-to "${printerName}" -exit-on-print -silent "${filePath}"`

  // 多份打印：执行多次
  if (copies > 1) {
    cmd = Array(copies).fill(cmd).join(' && ')
  }

  console.log('执行打印命令...')
  exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
    if (error) {
      console.error('SumatraPDF 打印失败:', error.message)
      return reject(new Error('打印失败: ' + error.message))
    }
    console.log('✅ 打印成功:', path.basename(filePath))
    resolve({ success: true, file: filePath })
  })
}

// macOS / Linux：用 lp 命令打印
function printWithLp(filePath, printerName, copies, resolve, reject) {
  let cmd = `lp -n ${copies} -d "${printerName}" "${filePath}"`
  console.log('执行 lp 打印...')
  exec(cmd, { timeout: 120000 }, (error) => {
    if (error) {
      console.error('lp 打印失败:', error.message)
      return reject(new Error('打印失败: ' + error.message))
    }
    console.log('✅ 打印成功:', path.basename(filePath))
    resolve({ success: true, file: filePath })
  })
}

module.exports = { getPrinters, printFile }
