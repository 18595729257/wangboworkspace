// app.js - 【升级v2】：支持游客模式 + 设备标识
const api = require('./utils/api.js')

App({
  onLaunch: function () {
    this.globalData = {
      userInfo: null,
      isLogin: false,
      points: 0,
      openid: '',
      deviceId: ''    // 游客设备唯一标识
    }

    // 初始化游客设备标识（不变，随小程序实例）
    this.initDeviceId()

    // 从本地存储恢复登录状态
    var saved = wx.getStorageSync('userInfo')
    if (saved && saved.openid) {
      this.globalData.userInfo = saved
      this.globalData.openid = saved.openid || ''
      this.globalData.isLogin = true
      this.globalData.points = saved.points || 0
    }

    // 后台静默同步（不阻塞）
    this.backgroundSync()
  },

  // 初始化设备唯一标识（游客模式用，必须用微信真实设备ID保证跨会话稳定）
  initDeviceId: function () {
    var self = this
    // 优先用微信真实设备标识，跨编译/重启稳定
    try {
      var deviceInfo = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()
      var deviceId = deviceInfo.deviceId || deviceInfo.openid || deviceInfo.uid || null
      if (deviceId) {
        this.globalData.deviceId = deviceId
        wx.setStorageSync('deviceId', deviceId)
        api.syncDeviceId(deviceId).catch(function () {})
        return
      }
    } catch (e) {}
    // 兜底：旧版微信或模拟器，用随机ID（注意：模拟器每次重编会变，仅开发测试用）
    var stored = wx.getStorageSync('deviceId')
    if (stored) {
      this.globalData.deviceId = stored
      return
    }
    var deviceId = 'dev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    wx.setStorageSync('deviceId', deviceId)
    this.globalData.deviceId = deviceId
    api.syncDeviceId(deviceId).catch(function () {})
  },

  // 获取当前订单归属标识
  // 规则：已登录 → openid，未登录 → deviceId
  getOrderIdentity: function () {
    if (this.globalData.isLogin && this.globalData.openid) {
      return { openid: this.globalData.openid, deviceId: this.globalData.deviceId || null }
    }
    return { openid: null, deviceId: this.globalData.deviceId || null }
  },

  // 后台同步（不阻塞页面）
  backgroundSync: function () {
    var self = this
    wx.login({
      success: function (res) {
        if (res.code) {
          api.wxLogin(res.code).then(function (r) {
            if (r.code === 200 && r.data) {
              // 如果用户已经退出登录，不恢复状态
              if (!self.globalData.isLogin && !wx.getStorageSync('userInfo')) return
              self.globalData.openid = r.data.openid
              // 映射服务端字段到本地格式
              var mapped = {
                openid: r.data.openid,
                nickName: r.data.nickname || r.data.nickName || '微信用户',
                avatarUrl: r.data.avatar_url || r.data.avatarUrl || '',
                points: r.data.points || 0
              }
              // 保留本地头像昵称（用户可能自己改过）
              if (self.globalData.userInfo) {
                mapped.nickName = self.globalData.userInfo.nickName || mapped.nickName
                mapped.avatarUrl = self.globalData.userInfo.avatarUrl || mapped.avatarUrl
              }
              self.globalData.userInfo = mapped
              self.globalData.points = mapped.points
              self.globalData.isLogin = true
              wx.setStorageSync('userInfo', mapped)
            }
          }).catch(function () {})
        }
      },
      fail: function (err) {
        console.warn('backgroundSync wx.login 失败:', err)
      }
    })
  },

  // 保存登录信息
  saveLogin: function (userInfo) {
    this.globalData.userInfo = userInfo
    this.globalData.isLogin = true
    this.globalData.points = userInfo.points || 0
    this.globalData.openid = userInfo.openid || this.globalData.openid
    wx.setStorageSync('userInfo', userInfo)
  },

  // 退出登录（保留 deviceId，不影响游客订单）
  logout: function () {
    this.globalData.userInfo = null
    this.globalData.isLogin = false
    this.globalData.points = 0
    // 注意：不清除 deviceId（游客订单仍可查）
    // 可选：清除 userInfo 但保留 deviceId
    // wx.removeStorageSync('userInfo')  // 若要清除可放开
  },

  // 刷新积分
  refreshPoints: function () {
    var self = this
    var openid = this.globalData.openid
    if (!openid) return
    api.getUserInfo(openid).then(function (res) {
      if (res.code === 200) {
        self.globalData.points = res.data.points || 0
      }
    }).catch(function () {})
  }
})
