// pages/my/my.js
const app = getApp()
const api = require('../../utils/api.js')
const compat = require('../../utils/compat.js')

Page({
  data: {
    userInfo: null,
    isLogin: false,
    points: 0,
    stats: { pending: 0, processing: 0, completed: 0, total: 0 },
    recentPoints: []
  },

  onLoad: function () { this.loadData() },
  onShow: function () { this.loadData() },

  loadData: function () {
    const self = this
    this.setData({
      userInfo: app.globalData.userInfo,
      isLogin: app.globalData.isLogin,
      points: app.globalData.points
    })

    if (app.globalData.isLogin && app.globalData.openid) {
      api.getUserInfo(app.globalData.openid).then(function (res) {
        if (res.code === 200) {
          const user = res.data
          self.setData({
            stats: {
              pending: 0,
              processing: 0,
              completed: user.order_count || 0,
              total: user.order_count || 0
            },
            recentPoints: []
          })
        }
      })
    }
  },

  // 微信一键登录
  onLogin: function () {
    var self = this

    wx.login({
      success: function (res) {
        if (!res.code) {
          wx.showToast({ title: '登录失败', icon: 'none' })
          return
        }

        // 先用本地信息登录，不阻塞用户
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
              isLogin: true,
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

  // 编辑资料
  goLoginPage: function () {
    wx.navigateTo({ url: '/pages/login/login' })
  },

  goToOrders: function (e) {
    var status = e.currentTarget.dataset.status || ''
    // tabBar页面不能传参，用globalData暂存
    if (status) app.globalData._filterStatus = status
    wx.switchTab({ url: '/pages/order-history/order-history' })
  },

  goToPoints: function () {
    if (!this.data.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/points/points' })
  },

  goToUpload: function () {
    wx.navigateTo({ url: '/pages/upload/upload' })
  },

  viewAllPoints: function () {
    wx.navigateTo({ url: '/pages/points/points' })
  },

  onPullDownRefresh: function () {
    this.loadData()
    wx.stopPullDownRefresh()
  },

  // 退出登录
  doLogout: function () {
    var self = this
    wx.showModal({
      title: '确认退出',
      content: '退出后需要重新登录才能使用积分等功能',
      success: function (res) {
        if (res.confirm) {
          app.logout()
          self.setData({
            userInfo: null,
            isLogin: false,
            points: 0
          })
          wx.showToast({ title: '已退出', icon: 'success' })
        }
      }
    })
  },

  // 切换账号
  switchAccount: function () {
    app.logout()
    wx.navigateTo({ url: '/pages/login/login' })
  }
})
