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

    const printer = options.printer || ''
    const copies = parseInt(options.copies) || 1
    const duplex = options.duplex || 'single'
    const orderNo = options.orderNo || ''
    const pageCount = parseInt(options.pageCount) || 0  // 服务端提供的页数优先

    if (!printer) return reject(new Error('未指定打印机'))

    const ext = path.extname(filePath).toLowerCase()
    const isPdf = ext === '.pdf'
    if (isPdf) {
      try {
        const header = fs.readFileSync(filePath).slice(0, 5).toString()
        if (!header.startsWith('%PDF')) return reject(new Error('PDF 文件无效'))
      } catch (e) { return reject(new Error('无法读取文件: ' + e.message)) }
    }

    const fileSize = fs.statSync(filePath).size

    // 优先用服务端提供的页数，服务端没有再本地解析
    const totalPages = pageCount > 0 ? pageCount : getPdfPageCount(filePath)
    const sheetCount = duplex === 'double' ? Math.ceil(totalPages / 2) : totalPages
    const totalSheets = sheetCount * copies

    console.log(`准备打印: ${path.basename(filePath)} (${(fileSize / 1024).toFixed(0)}KB) -> ${printer}`)
    process.stdout.write('  ' + totalPages + ' 页, ' + (duplex === 'double' ? '双面' : '单面') + ', ' + copies + ' 份, 共 ' + totalSheets + ' 张\n')

    const startTime = Date.now()

    if (platform === 'win32') {
      if (isPdf) {
        // PDF 用 SumatraPDF
        _printSumatra(filePath, printer, copies, duplex, totalPages, orderNo, startTime, resolve, reject)
      } else {
        // Office 文件用 COM 直接打印（快），失败自动降级为 LibreOffice 转 PDF
        _printOfficeCOM(filePath, printer, copies, duplex, totalPages, orderNo, startTime, resolve, reject)
      }
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

// ===== 6. Office COM 直接打印（Windows，非 PDF 文件）=====
// 用 Word/Excel/PPT 的 COM 对象后台静默打印，无需转 PDF，速度最快
// COM 失败时自动降级为 LibreOffice → PDF → SumatraPDF
function _printOfficeCOM(filePath, printer, copies, duplex, totalPages, orderNo, startTime, resolve, reject) {
  const ext = path.extname(filePath).toLowerCase()
  const totalSheets = duplex === 'double' ? Math.ceil(totalPages / 2) : totalPages

  process.stdout.write('\r执行打印命令 (WPS/Office COM)...')
  startProgress(orderNo, totalSheets * copies, startTime)

  const psScript = _buildCOMScript(ext, filePath, printer, copies)
  if (psScript.startsWith('error:')) {
    endProgress()
    process.stdout.write('\r\u274C ' + psScript.substring(6) + '，降级为 LibreOffice...\n')
    return _printLibreOffice(filePath, printer, copies, duplex, totalPages, orderNo, startTime, resolve, reject)
  }

  // 用 UTF-16LE 编码 PowerShell 脚本，支持中文打印机名
  const b64 = Buffer.from(psScript, 'utf16le').toString('base64')
  const cmd = 'chcp 65001 >nul & powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + b64

  exec(cmd, { timeout: 600000 }, (error, stdout, stderr) => {
    endProgress()
    const sec = Math.floor((Date.now() - startTime) / 1000)
    const min = Math.floor(sec / 60)
    const ts = min > 0 ? min + '分' + (sec % 60) + '秒' : sec + '秒'
    const output = (stdout || '').trim()

    if (error || output.startsWith('error:')) {
      const errMsg = output.startsWith('error:') ? output.substring(6).trim() : (error?.message || '未知错误')
      process.stdout.write('\r\u274C COM打印失败 (' + ts + '): ' + errMsg + '\n')
      process.stdout.write('\r↩ 降级为 LibreOffice 转 PDF 打印...\n')
      // 降级到 LibreOffice 方案（重新开始计时）
      const fallbackStart = Date.now()
      _printLibreOffice(filePath, printer, copies, duplex, totalPages, orderNo, fallbackStart, resolve, reject)
    } else {
      process.stdout.write('\r\u2705 打印成功: ' + path.basename(filePath) + ' (' + ext + ', ' + ts + ')\n')
      resolve({ success: true, file: filePath, pages: totalPages })
    }
  })
}

// 生成 COM 打印的 PowerShell 脚本
function _buildCOMScript(ext, filePath, printer, copies) {
  const escPath = filePath.replace(/'/g, "''")
  const escPrinter = printer.replace(/'/g, "''")
  const cleanup = `
      if ($doc) { try { $doc.Close($false) } catch {} }
      if ($app) { try { $app.Quit() } catch {} }
      if ($doc) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($doc) | Out-Null }
      if ($app) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($app) | Out-Null }
      [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()`

  if (ext === '.docx' || ext === '.doc') {
    return `
$ErrorActionPreference = 'Stop'
$app = $null; $doc = $null
try {
  try { $app = New-Object -ComObject KWps.Application } catch {}
  if (-not $app) { try { $app = New-Object -ComObject Word.Application } catch {} }
  if (-not $app) { throw 'WPS/Word COM 不可用' }
  $app.Visible = $false
  $app.DisplayAlerts = 0
  $doc = $app.Documents.Open('${escPath}', $false, $true, $false)
  if (-not $doc) { throw '打开文档失败' }
  $app.ActivePrinter = '${escPrinter}'
  $doc.PrintOut($false, $false, 0, '', '', '', 0, ${copies})
  while ($app.BackgroundPrintingStatus -gt 0) { Start-Sleep -Milliseconds 500 }
  $doc.Close($false)
  $app.Quit()
  Write-Output 'ok'
} catch {
  Write-Output ('error:' + $_.Exception.Message)${cleanup}
} finally {${cleanup}}`
  } else if (ext === '.xlsx' || ext === '.xls') {
    return `
$ErrorActionPreference = 'Stop'
$app = $null; $wb = $null
try {
  try { $app = New-Object -ComObject Ket.Application } catch {}
  if (-not $app) { try { $app = New-Object -ComObject Excel.Application } catch {} }
  if (-not $app) { throw 'WPS表格/Excel COM 不可用' }
  $app.Visible = $false
  $app.DisplayAlerts = $false
  $wb = $app.Workbooks.Open('${escPath}', $false, $true)
  if (-not $wb) { throw '打开工作簿失败' }
  $app.ActivePrinter = '${escPrinter}'
  $wb.PrintOut(1, $wb.Sheets.Count, ${copies}, $false)
  $wb.Close($false)
  $app.Quit()
  Write-Output 'ok'
} catch {
  Write-Output ('error:' + $_.Exception.Message)
  if ($wb) { try { $wb.Close($false) } catch {} }
  if ($app) { try { $app.Quit() } catch {} }
  if ($wb) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null }
  if ($app) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($app) | Out-Null }
  [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()
} finally {
  if ($wb) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null }
  if ($app) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($app) | Out-Null }
  [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()
}`
  } else if (ext === '.pptx' || ext === '.ppt') {
    return `
$ErrorActionPreference = 'Stop'
$app = $null; $pres = $null
try {
  try { $app = New-Object -ComObject Kwpp.Application } catch {}
  if (-not $app) { try { $app = New-Object -ComObject PowerPoint.Application } catch {} }
  if (-not $app) { throw 'WPS演示/PPT COM 不可用' }
  $app.Visible = 1
  $app.DisplayAlerts = 1
  $pres = $app.Presentations.Open('${escPath}')
  $pres.PrintOut(1, -1, '', ${copies})
  $pres.Close()
  $app.Quit()
  Write-Output 'ok'
} catch {
  Write-Output ('error:' + $_.Exception.Message)
  if ($pres) { try { $pres.Close() } catch {} }
  if ($app) { try { $app.Quit() } catch {} }
  if ($pres) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($pres) | Out-Null }
  if ($app) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($app) | Out-Null }
  [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()
} finally {
  if ($pres) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($pres) | Out-Null }
  if ($app) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($app) | Out-Null }
  [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()
}`
  }
  return 'error:不支持的文件格式: ' + ext
}

// ===== 7. SumatraPDF（Windows PDF）=====
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

// ===== 8. Windows LibreOffice 打印（非 PDF，COM 降级方案）=====
// LibreOffice 不支持直接打印到打印机，需要先转 PDF，再用 SumatraPDF 打印
// 整个过程后台自动完成，用户无感知
function _printLibreOffice(filePath, printer, copies, duplex, totalPages, orderNo, startTime, resolve, reject) {
  const ext = path.extname(filePath).toLowerCase()
  const loExe = findLibreOffice()
  if (!loExe) {
    return reject(new Error(
      '找不到 LibreOffice！\n' +
      '请下载: https://www.libreoffice.org/download/download-libreoffice/\n' +
      '安装后重启客户端。'
    ))
  }

  const sumatra = findSumatraPDF()
  if (!sumatra) {
    return reject(new Error(
      '找不到 SumatraPDF！\n请下载: https://www.sumatrapdfreader.org/download-free-pdf-viewer'
    ))
  }

  // 临时目录用 C:\temp 避开中文用户名路径（LibreOffice 不支持非 ASCII 路径）
  const tmpDir = path.join('C:\\temp', 'print-lo-' + Date.now())
  if (!fs.existsSync('C:\\temp')) fs.mkdirSync('C:\\temp', { recursive: true })
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

  const duplexSwitch = duplex === 'double' ? ' -print-settings dupx' : ''
  const totalSheets = duplex === 'double' ? Math.ceil(totalPages / 2) : totalPages

  process.stdout.write('\r[1/2] LibreOffice 转PDF...')
  startProgress(orderNo, totalSheets * copies, startTime)

  // 第一步：LibreOffice 转 PDF
  const loCmd = '"' + loExe + '" --headless --convert-to pdf --outdir "' + tmpDir + '" "' + filePath + '"'
  // 备选：最简命令
  const loCmdSimple = '"' + loExe + '" --headless --convert-to pdf --outdir "' + tmpDir + '" "' + filePath + '"'

  exec(loCmd, { timeout: 120000 }, (loError, loStdout, loStderr) => {
    // 错误时打印 stdout + stderr 帮助诊断
    if (loError) {
      endProgress()
      const loStd = (loStdout || '').trim()
      const loErr = (loStderr || '').trim()
      const diag = loStd || loErr || loError.message
      process.stdout.write('\r\u274C LibreOffice 转换失败 (' + ext + '): ' + diag + '\n')
      // 尝试备选最简命令
      process.stdout.write('\r↩ 尝试备选命令...\n')
      exec(loCmdSimple, { timeout: 120000 }, (loError2, loStdout2, loStderr2) => {
        if (loError2) {
          endProgress()
          const diag2 = ((loStdout2 || '') + (loStderr2 || '')).trim() || loError2.message
          return reject(new Error('LibreOffice 转换失败: ' + diag2))
        }
        // 备选成功，继续找PDF并打印
        return findPdfAndPrint()
      })
      return
    }

    // 找 PDF 并打印（SumatraPDF）
    function findPdfAndPrint() {
      let pdfFile = null
      try {
        const files = fs.readdirSync(tmpDir)
        pdfFile = files.find(f => f.toLowerCase().endsWith('.pdf'))
        if (pdfFile) pdfFile = path.join(tmpDir, pdfFile)
      } catch {}

      if (!pdfFile || !fs.existsSync(pdfFile)) {
        endProgress()
        process.stdout.write('\r\u274C 未找到生成的 PDF\n')
        return reject(new Error('LibreOffice 未生成 PDF'))
      }

      process.stdout.write('\r[2/2] SumatraPDF 打印...')

      let sumatraCmd = '"' + sumatra + '" -print-to "' + printer + '"' + duplexSwitch + ' -exit-on-print -silent "' + pdfFile + '"'
      if (copies > 1) sumatraCmd = Array(copies).fill(sumatraCmd).join(' && ')

      exec(sumatraCmd, { timeout: 600000 }, (err) => {
        endProgress()
        const sec = Math.floor((Date.now() - startTime) / 1000)
        const min = Math.floor(sec / 60)
        const ts = min > 0 ? min + '分' + (sec % 60) + '秒' : sec + '秒'

        try { fs.unlinkSync(pdfFile) } catch {}
        try { fs.rmdirSync(tmpDir) } catch {}

        if (err) {
          process.stdout.write('\r\u274C 打印失败 (' + ts + '): ' + err.message + '\n')
          reject(new Error('打印失败: ' + err.message))
        } else {
          process.stdout.write('\r\u2705 打印成功: ' + path.basename(filePath) + ' (' + ext + ', ' + ts + ')\n')
          resolve({ success: true, file: filePath, pages: totalPages })
        }
      })
    }

    findPdfAndPrint()
  })
}

// ===== 9. 查找 LibreOffice =====
function findLibreOffice() {
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const candidates = [
    path.join(programFiles, 'LibreOffice', 'program', 'soffice.exe'),
    path.join(programFiles, 'LibreOffice', 'program', 'soffice'),
    path.join(programFilesX86, 'LibreOffice', 'program', 'soffice.exe'),
    path.join(programFilesX86, 'LibreOffice', 'program', 'soffice'),
    path.join(process.env.LOCALAPPDATA || '', 'LibreOffice', 'program', 'soffice.exe'),
    path.join(process.env.USERPROFILE || '', 'LibreOffice', 'program', 'soffice.exe'),
    path.join(__dirname, 'soffice.exe'),
    path.join(__dirname, 'soffice'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  try {
    const found = execSync('where soffice.exe 2>nul', { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0]
    if (found && fs.existsSync(found)) return found
  } catch {}
  return null
}

// ===== 10. 兼容旧函数名 =====
function _printDefault(filePath, printer, copies, duplex, totalPages, orderNo, startTime, resolve, reject) {
  // 直接透传到 LibreOffice 方案
  _printLibreOffice(filePath, printer, copies, duplex, totalPages, orderNo, startTime, resolve, reject)
}

// ===== 11. lp（macOS/Linux）=====
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
