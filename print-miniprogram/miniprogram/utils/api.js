// utils/api.js - HTTP 请求封装
const { BASE_URL } = require('./config.js')

// 通用请求
function request(url, options = {}) {
  return new Promise(function (resolve, reject) {
    var fullUrl = BASE_URL + url
    console.log('[API请求]', options.method || 'GET', fullUrl)

    var timer = setTimeout(function () {
      console.error('[API超时]', fullUrl)
      reject({ code: 408, msg: '请求超时' })
    }, 10000)

    wx.request({
      url: fullUrl,
      method: options.method || 'GET',
      data: options.data || {},
      timeout: 10000,
      header: {
        'Content-Type': 'application/json',
        ...options.header
      },
      success: function (res) {
        clearTimeout(timer)
        console.log('[API响应]', url, 'status:', res.statusCode)
        if (res.statusCode === 200) {
          resolve(res.data)
        } else {
          console.error('[API错误]', url, res.statusCode, res.data)
          reject({ code: res.statusCode, msg: '请求失败', data: res.data })
        }
      },
      fail: function (err) {
        clearTimeout(timer)
        console.error('[API失败]', url)
        console.error('[API失败] 详情:', JSON.stringify(err))
        console.error('[API失败] BASE_URL:', BASE_URL)
        reject({ code: 500, msg: '网络请求失败', error: err })
      }
    })
  })
}

// GET 请求
function get(url, params) {
  const query = params ? '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : ''
  return request(url + query)
}

// POST 请求
function post(url, data) {
  return request(url, { method: 'POST', data })
}

// PUT 请求
function put(url, data) {
  return request(url, { method: 'PUT', data })
}

// ===== 具体业务接口 =====

// 微信登录（code换openid）
function wxLogin(code) {
  return post('/api/public/wx-login', { code })
}

// 获取用户信息
function getUserInfo(openid) {
  return get(`/api/public/user/${openid}`)
}

// 获取用户订单列表（支持游客+账号模式）
// 优先传 openid（账号），deviceId 补充（游客）
function getUserOrders(openid, page, pageSize, deviceId) {
  if (openid) {
    return get(`/api/public/user/${openid}/orders`, { page, pageSize })
  }
  // 游客模式：通过新接口按 deviceId 查
  if (deviceId) {
    return get(`/api/public/orders/me`, { page, pageSize, deviceId })
  }
  return Promise.reject({ msg: '缺少标识' })
}

// 获取当前用户所有订单（账号用openid，游客用deviceId）
// openid/deviceId 二选一，由调用方根据登录状态决定
function getMyOrders(page, pageSize, deviceId, openid) {
  const params = { page, pageSize }
  if (deviceId) params.deviceId = deviceId
  else if (openid) params.openid = openid
  return get(`/api/public/orders/me`, params)
}

// 同步设备ID到服务端
function syncDeviceId(deviceId) {
  return post('/api/public/device/sync', { deviceId })
}

// 获取公开配置
function getConfig() {
  return get('/api/public/config')
}

// 创建订单
function createOrder(data) {
  return post('/api/public/order', data)
}

// 查询订单
function getOrder(orderNo) {
  return get(`/api/public/order/${orderNo}`)
}

// 取消订单
function cancelOrder(orderNo) {
  return put(`/api/public/order/${orderNo}/cancel`)
}

// 支付回调
function payCallback(orderNo) {
  return post('/api/public/pay-callback', { orderNo })
}

// 获取队列状态
function getQueueStatus() {
  return get('/api/public/queue-status')
}

// 上传文件（使用 wx.uploadFile，支持更大文件，性能更好）
function uploadFile(filePath, name) {
  return new Promise(function (resolve, reject) {
    var uploadUrl = BASE_URL + '/api/public/upload'
    console.log('[上传] 开始(multipart):', uploadUrl)
    console.log('[上传] 文件:', filePath)
    console.log('[上传] 文件名:', name || 'upload.pdf')
    
    wx.uploadFile({
      url: uploadUrl,
      filePath: filePath,
      name: 'file',
      formData: {
        fileName: name || 'upload.pdf',
        fileType: 'application/pdf'
      },
      timeout: 120000,  // 2分钟超时
      success: function (res) {
        console.log('[上传] 响应状态:', res.statusCode)
        if (res.statusCode === 200) {
          try {
            var data = JSON.parse(res.data)
            console.log('[上传] 解析成功:', data.code, data.msg)
            if (data.code === 200) {
              resolve(data)
            } else {
              reject({ msg: data.msg || '上传失败' })
            }
          } catch (e) {
            console.error('[上传] 解析响应失败:', res.data)
            reject({ msg: '服务器响应格式错误' })
          }
        } else {
          console.error('[上传] 状态码错误:', res.statusCode)
          reject({ msg: '上传失败，状态码: ' + res.statusCode })
        }
      },
      fail: function (err) {
        console.error('[上传] 失败:', JSON.stringify(err))
        reject({ msg: '网络错误', error: err })
      }
    })
  })
}

module.exports = {
  request, get, post, put,
  wxLogin, getUserInfo, getUserOrders, getMyOrders, getConfig,
  createOrder, getOrder, cancelOrder, payCallback,
  getQueueStatus, uploadFile, syncDeviceId
}
