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

// 获取用户订单列表
function getUserOrders(openid, page, pageSize) {
  return get(`/api/public/user/${openid}/orders`, { page, pageSize })
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

// 上传文件
function uploadFile(filePath, name) {
  return new Promise(function (resolve, reject) {
    var uploadUrl = BASE_URL + '/api/public/upload'
    console.log('[上传] 开始:', uploadUrl)
    console.log('[上传] 文件:', filePath)
    wx.uploadFile({
      url: uploadUrl,
      filePath: filePath,
      name: 'file',
      header: { 'Content-Type': 'multipart/form-data' },
      success: function (res) {
        console.log('[上传] 响应:', res.statusCode, res.data)
        try {
          var data = JSON.parse(res.data)
          if (data.code === 200) resolve(data)
          else reject(data)
        } catch (e) { reject({ msg: '上传失败' }) }
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
  wxLogin, getUserInfo, getUserOrders, getConfig,
  createOrder, getOrder, cancelOrder, payCallback,
  getQueueStatus, uploadFile
}
