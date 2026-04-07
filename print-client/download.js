// download.js - 改进的下载函数，带详细日志
const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    // 如果 URL 使用的是 IP 地址，自动替换为域名，避免 SSL 证书验证失败
    const correctDomain = 'xinbingcloudprint.top';
    const safeUrl = url.replace('39.104.59.201', correctDomain).replace('xinbingprint.top', correctDomain);
    const protocol = safeUrl.startsWith('https') ? https : http

    console.log(`[下载] URL: ${url}`)
    if (safeUrl !== url) {
      console.log(`[下载] 已自动替换为正确域名: ${safeUrl}`)
    }
    console.log(`[下载] 保存到: ${destPath}`)

    protocol.get(safeUrl, { timeout: 30000 }, (res) => {
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
        // 读取错误响应体
        let errorBody = ''
        res.on('data', chunk => errorBody += chunk)
        res.on('end', () => {
          console.error(`[下载] 错误响应: ${errorBody}`)
          reject(new Error(`Download failed: ${res.statusCode}`))
        })
        return
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
          console.error(`[下载] ⚠️ 文件过小，内容: ${content}`)
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
  })
}

module.exports = { downloadFile }
