// app.js
const api = require('./utils/api.js')

App({
  onLaunch: function () {
    this.globalData = {
      userInfo: null,
      isLogin: false,
      points: 0,
      openid: ''
    }

    // 从本地存储恢复登录状态
    var saved = wx.getStorageSync('userInfo')
    if (saved) {
      this.globalData.userInfo = saved
      this.globalData.openid = saved.openid || ''
      this.globalData.isLogin = true
      this.globalData.points = saved.points || 0
    }

    // 后台静默同步（不阻塞）
    this.backgroundSync()
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

  // 退出登录
  logout: function () {
    this.globalData.userInfo = null
    this.globalData.isLogin = false
    this.globalData.points = 0
    wx.removeStorageSync('userInfo')
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
