// pages/index/index.js
const app = getApp()
const api = require('../../utils/api.js')
const compat = require('../../utils/compat.js')

Page({
  data: {
    userInfo: null,
    isLogin: false,
    points: 0,
    printerStatus: 'idle',
    queueCount: 0,
    hasNotify: false,
    noticeText: '营业时间 8:00-22:00 · 支持微信支付',
    // 入口开关配置
    enableUpload: true,
    enableIdcard: true,
    enablePhoto: true,
    enableFactory: true
  },

  onLoad: function () { this.loadData() },
  onShow: function () { this.loadData() },

  loadData: function () {
    if (app.globalData.userInfo) {
      this.setData({
        userInfo: app.globalData.userInfo,
        isLogin: app.globalData.isLogin,
        points: app.globalData.points
      })
    } else {
      this.setData({
        userInfo: null,
        isLogin: false,
        points: 0
      })
    }
    this.loadPrinterStatus()
    this.loadConfig()
  },

  loadPrinterStatus: function () {
    const self = this
    api.getQueueStatus().then(function (res) {
      if (res.code === 200) {
        const data = res.data
        let status = 'idle'
        if (data.printers.offline > 0) status = 'offline'
        else if (data.printers.busy > 0) status = 'busy'
        self.setData({
          printerStatus: status,
          queueCount: data.queue.waiting
        })
      }
    }).catch(function () {})
  },

  loadConfig: function () {
    const self = this
    api.getConfig().then(function (res) {
      if (res.code === 200) {
        const c = res.data
        let notice = '营业时间 8:00-22:00 · 支持微信支付'
        if (c.shop_notice) notice = c.shop_notice
        if (c.shop_name) {
          self.setData({ shopName: c.shop_name })
        }
        // 入口开关配置（字符串'1'或'0'转布尔）
        self.setData({
          noticeText: notice,
          enableUpload: c.enable_upload !== '0',
          enableIdcard: c.enable_idcard !== '0',
          enablePhoto: c.enable_photo !== '0',
          enableFactory: c.enable_factory !== '0'
        })
      }
    }).catch(function () {})
  },

  goToUpload: function () {
    wx.navigateTo({ url: '/pages/upload/upload' })
  },

  goToIdCardCopy: function () {
    wx.navigateTo({ url: '/pages/id-card-copy/id-card-copy' })
  },

  goToPhotoPrint: function () {
    wx.navigateTo({ url: '/pages/photo-print/photo-print' })
  },

  goToFactoryPrint: function () {
    wx.navigateTo({ url: '/pages/upload/upload?service=factory' })
  },

  goToMy: function () {
    wx.switchTab({ url: '/pages/my/my' })
  },

  goToOrders: function () {
    wx.switchTab({ url: '/pages/order-history/order-history' })
  },

  // 点击登录 - 直接调微信授权
  onLogin: function () {
    var self = this

    wx.login({
      success: function (res) {
        if (!res.code) {
          wx.showToast({ title: '登录失败', icon: 'none' })
          return
        }

        // 先用本地openid登录，不阻塞用户
        var localUser = {
          openid: 'local_' + Date.now(),
          nickName: '微信用户',
          avatarUrl: '',
          points: 0
        }
        app.saveLogin(localUser)
        self.setData({
          userInfo: localUser,
          isLogin: true,
          points: 0
        })
        wx.showToast({ title: '登录成功', icon: 'success' })

        // 后台同步openid到服务器
        api.wxLogin(res.code).then(function (r) {
          if (r.code === 200 && r.data && r.data.openid) {
            var userInfo = {
              openid: r.data.openid,
              nickName: r.data.nickname || r.data.nickName || '微信用户',
              avatarUrl: r.data.avatar_url || r.data.avatarUrl || '',
              points: r.data.points || 0
            }
            app.saveLogin(userInfo)
            self.setData({
              userInfo: userInfo,
              points: userInfo.points
            })
          }
        }).catch(function (err) {
          console.error('后台同步openid失败:', err)
        })
      },
      fail: function (err) {
        console.error('wx.login失败:', err)
        wx.showToast({ title: '登录失败', icon: 'none' })
      }
    })
  },

  // 跳转到登录页（完善资料）
  goLoginPage: function () {
    wx.navigateTo({ url: '/pages/login/login' })
  },

  onPullDownRefresh: function () {
    this.loadData()
    wx.stopPullDownRefresh()
  }
})
