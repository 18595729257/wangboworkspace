// pages/login/login.js
var app = getApp()

Page({
  data: {
    avatar: '',
    nickname: '',
    isUpdate: false
  },

  onLoad: function () {
    // 如果已登录，显示当前信息供修改
    if (app.globalData.isLogin && app.globalData.userInfo) {
      this.setData({
        avatar: app.globalData.userInfo.avatarUrl || '',
        nickname: app.globalData.userInfo.nickName || '',
        isUpdate: true
      })
    }
  },

  onAvatar: function (e) {
    if (e.detail && e.detail.avatarUrl) {
      this.setData({ avatar: e.detail.avatarUrl })
    }
  },

  onNick: function (e) {
    this.setData({ nickname: e.detail.value })
  },

  saveProfile: function () {
    var avatar = this.data.avatar
    var nickname = this.data.nickname || '微信用户'

    var userInfo = Object.assign({}, app.globalData.userInfo || {}, {
      nickName: nickname,
      avatarUrl: avatar
    })

    app.saveLogin(userInfo)
    wx.showToast({ title: '保存成功', icon: 'success' })
    setTimeout(function () { wx.navigateBack() }, 800)
  },

  goBack: function () {
    wx.navigateBack()
  }
})
