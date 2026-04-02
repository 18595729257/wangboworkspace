// pages/payment/payment.js
const app = getApp()
const api = require('../../utils/api.js')

Page({
  data: {
    orderNo: '',
    orderInfo: null,
    loading: false,
    pollingTimer: null
  },

  onLoad: function (options) {
    if (options.orderNo) {
      this.setData({ orderNo: options.orderNo })
      this.loadOrderInfo()
    }
  },

  onUnload: function () {
    if (this.data.pollingTimer) clearInterval(this.data.pollingTimer)
  },

  loadOrderInfo: function () {
    const self = this
    api.getOrder(this.data.orderNo).then(function (res) {
      if (res.code === 200) {
        self.setData({ orderInfo: res.data })
      } else {
        wx.showToast({ title: res.msg || '加载失败', icon: 'none' })
      }
    })
  },

  startPay: function () {
    const self = this
    if (!this.data.orderInfo) return

    this.setData({ loading: true })

    // 调用支付回调（模拟支付成功）
    api.payCallback(this.data.orderNo).then(function (res) {
      if (res.code === 200) {
        wx.showToast({ title: '支付成功', icon: 'success' })
        self.loadOrderInfo()
        self.startPolling()
        app.refreshPoints()
      }
    }).catch(function () {
      wx.showToast({ title: '支付失败', icon: 'none' })
    }).finally(function () {
      self.setData({ loading: false })
    })
  },

  startPolling: function () {
    const self = this
    const timer = setInterval(function () {
      api.getOrder(self.data.orderNo).then(function (res) {
        if (res.code === 200) {
          self.setData({ orderInfo: res.data })
          if (res.data.status === 'completed') {
            clearInterval(timer)
            self.setData({ pollingTimer: null })
            wx.showToast({ title: '打印完成', icon: 'success' })
          }
        }
      })
    }, 5000)
    this.setData({ pollingTimer: timer })
  },

  viewQueue: function () {
    wx.showModal({ title: '打印队列', content: '您的订单已加入打印队列，请耐心等待', showCancel: false })
  },

  goHome: function () {
    wx.switchTab({ url: '/pages/index/index' })
  }
})
