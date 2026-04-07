# PDF 调试笔记

## 问题现状

### 症状
订单 P202604070937314041 下载的 PDF 文件只有 13 字节，而不是实际的 PDF 文件。

### 调试步骤

#### 1. 检查 download.js 日志输出

在 print-client 端，现在使用了增强的 `download.js` 模块。日志会显示：

- 请求URL
- 响应状态码
- 响应头（Content-Type, Content-Length）
- 响应内容（前200字节，会被解码显示）

查看日志以确认：
1. 完整的请求URL是什么
2. 响应状态码是否为 200
3. 响应头中的 Content-Type 是什么（应该是 application/pdf）
4. 响应内容是什么（13 字节的内容）

#### 2. 在服务器上检查 uploads 目录

```bash
ssh root@39.104.59.201
ls -lh /root/print-miniprogram-admin/uploads/
```

如果目录不存在或为空，说明：
- 上传目录从未被创建
- 或者上传失败但错误被忽略

#### 3. 手动访问 PDF URL

在 print-client 的下载日志或服务器日志中找到 PDF URL，手动访问：

```bash
curl -v "https://xinbingcloudprint.top/uploads/xxx.pdf"
```

检查响应：
- HTTP 状态码
- 响应内容类型
- 响应内容大小

#### 4. 检查订单上传请求

在服务器日志中查找上传相关日志：

```bash
ssh root@39.104.59.201
grep "UPLOAD" /root/print-miniprogram-admin/logs/*.log | grep "P202604070937314041"
```

查看：
- 是否成功保存文件
- 文件路径是什么
- 返回的 URL 是什么

### 已知信息

1. **上传路由**：`POST /api/public/upload`
   - 保存文件到 `print-miniprogram-admin/uploads/`
   - 返回格式：`https://xinbingcloudprint.top/uploads/{filename}`

2. **静态文件服务**：
   - `server.js` 第 795 行：`app.use('/uploads', express.static(uploadDir))`

3. **可能的问题**：
   - `uploadDir` 目录不存在，上传时写入失败
   - 静态文件服务找不到文件，返回 404 页面（13 字节的 HTML 错误页面）

### 修复方案

#### 方案 1：确保 uploads 目录存在（推荐）

在服务器启动时创建目录（已实施）。

#### 方案 2：添加目录监控和错误记录

如果目录创建失败，记录详细日志，方便排查。

### 下一步

等待下次打印时查看 download.js 的日志输出，确认 13 字节内容是什么。
