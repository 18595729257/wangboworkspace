// utils/compat.js - 跨平台兼容工具
// 解决 iOS / Android / 鸿蒙 的API差异

// 平台检测（延迟初始化，避免阻塞）
var _platform = ''
function getPlatform() {
  if (_platform) return _platform
  try {
    _platform = (wx.getSystemInfoSync() || {}).platform || ''
  } catch (e) {}
  return _platform
}

function isIOS() { return getPlatform() === 'ios' }
function isAndroid() { return getPlatform() === 'android' }
function isDevTools() { return getPlatform() === 'devtools' }

// 检测API是否可用
function canUse(api) {
  try { return typeof wx[api] === 'function' } catch (e) { return false }
}

// 获取系统信息（兼容写法）
function getSystemInfo() {
  return new Promise(function (resolve) {
    if (canUse('getSystemInfoSync')) {
      resolve(wx.getSystemInfoSync())
    } else {
      resolve({})
    }
  })
}

// 选择图片（兼容所有平台）
function chooseImage(options) {
  return new Promise(function (resolve, reject) {
    // 优先用 chooseMedia（新版）
    if (canUse('chooseMedia')) {
      wx.chooseMedia({
        count: options.count || 1,
        mediaType: ['image'],
        sourceType: options.sourceType || ['album', 'camera'],
        sizeType: ['compressed'],
        success: function (res) {
          var files = res.tempFiles.map(function (f) {
            return {
              path: f.tempFilePath,
              size: f.size,
              name: f.tempFilePath.split('/').pop() || 'image.jpg'
            }
          })
          resolve({ tempFiles: files })
        },
        fail: reject
      })
    } else {
      // 降级用 chooseImage（旧版兼容）
      wx.chooseImage({
        count: options.count || 1,
        sourceType: options.sourceType || ['album', 'camera'],
        sizeType: ['compressed'],
        success: function (res) {
          var files = res.tempFilePaths.map(function (p) {
            return { path: p, size: 0, name: p.split('/').pop() || 'image.jpg' }
          })
          resolve({ tempFiles: files })
        },
        fail: reject
      })
    }
  })
}

// 选择文件（兼容所有平台）
function chooseFile(options) {
  return new Promise(function (resolve, reject) {
    var ext = options.extension || ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png']
    if (canUse('chooseMessageFile')) {
      wx.chooseMessageFile({
        count: options.count || 1,
        type: options.type || 'file',
        extension: ext,
        success: resolve,
        fail: reject
      })
    } else {
      // 极旧版本降级
      reject({ errMsg: '当前微信版本不支持文件选择' })
    }
  })
}

// 获取用户信息（兼容所有平台）
function getUserProfile(desc) {
  return new Promise(function (resolve, reject) {
    if (canUse('getUserProfile')) {
      try {
        wx.getUserProfile({
          desc: desc || '用于完善用户资料',
          success: function (res) { resolve(res.userInfo) },
          fail: function () { reject(null) }
        })
      } catch (e) {
        console.warn('getUserProfile异常:', e)
        reject(null)
      }
    } else {
      reject(null)
    }
  })
}

// 显示安全的Toast
function showToast(title, icon) {
  if (canUse('showToast')) {
    wx.showToast({ title: title, icon: icon || 'none', duration: 2000 })
  }
}

// 显示安全的Loading
function showLoading(title) {
  if (canUse('showLoading')) {
    wx.showLoading({ title: title || '加载中...', mask: true })
  }
}

function hideLoading() {
  if (canUse('hideLoading')) {
    wx.hideLoading()
  }
}

module.exports = {
  getPlatform: getPlatform,
  isIOS: isIOS,
  isAndroid: isAndroid,
  isDevTools: isDevTools,
  canUse: canUse,
  getSystemInfo: getSystemInfo,
  chooseImage: chooseImage,
  chooseFile: chooseFile,
  getUserProfile: getUserProfile,
  showToast: showToast,
  showLoading: showLoading,
  hideLoading: hideLoading
}
