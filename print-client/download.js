// download.js - 改进的下载函数，带详细日志，支持域名被拦截时降级到 IP 直连
const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')

const CORRECT_DOMAIN = 'xinbingcloudprint.top'
const SERVER_IP = '39.104.59.201'

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    // 优先使用域名，如果域名被拦截（返回 HTML），降级到 IP 直连
    const tryDownload = (downloadUrl) => {
      const protocol = downloadUrl.startsWith('https') ? https : http

      console.log(`[下载] URL: ${downloadUrl}`)

      protocol.get(downloadUrl, { timeout: 30000, rejectUnauthorized: false }, (res) => {
        console.log(`[下载] 响应状态: ${res.statusCode}`)
        console.log(`[下载] Content-Type: ${res.headers['content-type']}`)
        console.log(`[下载] Content-Length: ${res.headers['content-length']}`)

        // 跟踪重定向
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location
          console.log(`[下载] 重定向到: ${redirectUrl}`)
          return downloadFile(redirectUrl, destPath).then(resolve).catch(reject)
        }

        if (res.statusCode !== 200) {
          let errorBody = ''
          res.on('data', chunk => errorBody += chunk)
          res.on('end', () => {
            console.error(`[下载] 错误响应: ${errorBody}`)
            reject(new Error(`Download failed: ${res.statusCode}`))
          })
          return
        }

        // 检查 Content-Type，如果是 HTML 说明被 ICP 拦截，直接降级到 IP
        const contentType = res.headers['content-type'] || ''
        if (contentType.includes('text/html')) {
          console.error('[下载] ⚠️ 检测到 HTML 响应（Content-Type: text/html），域名被拦截，降级到 IP 直连...')
          // 降级：使用 IP 直接下载（不检查内容，只要是 HTML 就降级）
          const ipUrl = url.replace(`https://${CORRECT_DOMAIN}`, `https://${SERVER_IP}`)
            .replace(`http://${CORRECT_DOMAIN}`, `https://${SERVER_IP}`)
          return tryDownload(ipUrl)
        }

        const file = fs.createWriteStream(destPath)
        let downloadedBytes = 0

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length
          if (downloadedBytes === chunk.length) {
            console.log(`[下载] 开始下载...`)
          }
        })

        res.pipe(file)

        file.on('finish', () => {
          const stats = fs.statSync(destPath)
          console.log(`[下载] 完成: ${stats.size} 字节`)
          console.log(`[下载] 文件: ${destPath}`)

          // 检查下载的文件内容
          if (stats.size < 1000) {
            const content = fs.readFileSync(destPath, 'utf8')
            console.error(`[下载] ⚠️ 文件过小，内容: ${content.substring(0, 200)}`)
            fs.unlinkSync(destPath) // 删除无效文件
            reject(new Error(`文件过小 (${stats.size} 字节)`))
          } else {
            resolve(stats.size)
          }
        })

        file.on('error', (err) => {
          console.error('[下载] 写入失败:', err)
          fs.unlink(destPath, () => {})
          reject(err)
        })
      }).on('error', (err) => {
        console.error('[下载] 网络错误:', err.message)
        reject(err)
      })
    }

    // 优先使用域名，IP 用于降级
    const safeUrl = url
      .replace('39.104.59.201', CORRECT_DOMAIN)
      .replace('xinbingprint.top', CORRECT_DOMAIN)
    
    tryDownload(safeUrl)
  })
}

module.exports = { downloadFile }
