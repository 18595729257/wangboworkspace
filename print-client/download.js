// download.js - 文件下载，优先域名，失败自动降级 IP
const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')

const DOMAIN_HOST = 'xinbingcloudprint.top'
const IP_HOST = '39.104.59.201'

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    // 处理相对路径：自动拼接 API_URL 前缀
    const config = require('./config')
    if (url.startsWith('/')) {
      url = config.API_URL.replace(/\/$/, '') + url
    }

    // 关键：HTTP 域名升级为 HTTPS（阿里云 ICP 拦截 HTTP，HTTPS 正常）
    if (url.startsWith('http://' + DOMAIN_HOST)) {
      url = url.replace('http://' + DOMAIN_HOST, 'https://' + DOMAIN_HOST)
    }

    const tryDownload = (downloadUrl, isRetry) => {
      const protocol = downloadUrl.startsWith('https') ? https : http

      console.log(`[下载] URL: ${downloadUrl}`)

      protocol.get(downloadUrl, { timeout: 30000, rejectUnauthorized: false }, (res) => {
        console.log(`[下载] 响应状态: ${res.statusCode}`)
        console.log(`[下载] Content-Type: ${res.headers['content-type']}`)

        // 跟踪重定向
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location
          console.log(`[下载] 重定向到: ${redirectUrl}`)
          return downloadFile(redirectUrl, destPath).then(resolve).catch(reject)
        }

        // 域名返回 403 (ICP 拦截) 或非200，降级到 IP
        if (res.statusCode !== 200) {
          if (!isRetry && downloadUrl.includes(DOMAIN_HOST)) {
            console.log(`[下载] 域名返回 ${res.statusCode}，降级到 IP...`)
            res.resume()
            const ipUrl = downloadUrl
              .replace(`https://${DOMAIN_HOST}`, `http://${IP_HOST}`)
              .replace(`http://${DOMAIN_HOST}`, `http://${IP_HOST}`)
            return tryDownload(ipUrl, true)
          }
          let errorBody = ''
          res.on('data', chunk => errorBody += chunk)
          res.on('end', () => {
            console.error(`[下载] 错误响应: ${errorBody.substring(0, 200)}`)
            reject(new Error(`Download failed: ${res.statusCode}`))
          })
          return
        }

        // 检查 Content-Type，HTML 说明被 ICP 拦截，降级到 IP
        const contentType = res.headers['content-type'] || ''
        if (contentType.includes('text/html') && !isRetry && downloadUrl.includes(DOMAIN_HOST)) {
          console.log('[下载] 检测到 HTML（ICP 拦截），降级到 IP...')
          res.resume()
          const ipUrl = downloadUrl
            .replace(`https://${DOMAIN_HOST}`, `http://${IP_HOST}`)
            .replace(`http://${DOMAIN_HOST}`, `http://${IP_HOST}`)
          return tryDownload(ipUrl, true)
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

          if (stats.size < 1000) {
            const content = fs.readFileSync(destPath, 'utf8')
            console.error(`[下载] 文件过小，内容: ${content.substring(0, 200)}`)
            fs.unlinkSync(destPath)
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
        // 域名连接失败（RST/超时），降级到 IP
        if (!isRetry && downloadUrl.includes(DOMAIN_HOST)) {
          const ipUrl = downloadUrl
            .replace(`https://${DOMAIN_HOST}`, `http://${IP_HOST}`)
            .replace(`http://${DOMAIN_HOST}`, `http://${IP_HOST}`)
          console.log(`[下载] 域名连接失败，降级到 IP: ${ipUrl}`)
          return tryDownload(ipUrl, true)
        }
        reject(err)
      })
    }

    // 优先用域名，失败自动降级 IP
    tryDownload(url, false)
  })
}

module.exports = { downloadFile }
