// pages/order-detail/order-detail.js
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
      this.loadOrderDetail()
    }
  },

  onShow: function () { this.loadOrderDetail() },

  onUnload: function () {
    if (this.data.pollingTimer) clearInterval(this.data.pollingTimer)
  },

  loadOrderDetail: function () {
    const self = this
    api.getOrder(this.data.orderNo).then(function (res) {
      if (res.code === 200) {
        self.setData({ orderInfo: res.data })
        if (res.data.status === 'printing' && !self.data.pollingTimer) {
          self.startPolling()
        }
      } else {
        wx.showToast({ title: res.msg || '加载失败', icon: 'none' })
      }
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
          }
        }
      })
    }, 5000)
    this.setData({ pollingTimer: timer })
  },

  payOrder: function () {
    wx.navigateTo({ url: `/pages/payment/payment?orderNo=${this.data.orderNo}` })
  },

  cancelOrder: function () {
    const self = this
    wx.showModal({
      title: '确认取消',
      content: '确定要取消这个订单吗？',
      success: function (res) {
        if (res.confirm) {
          api.cancelOrder(self.data.orderNo).then(function (res) {
            if (res.code === 200) {
              wx.showToast({ title: '取消成功', icon: 'success' })
              self.loadOrderDetail()
            } else {
              wx.showToast({ title: res.msg || '取消失败', icon: 'none' })
            }
          })
        }
      }
    })
  },

  formatTime: function (dateStr) {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
  },

  goBack: function () { wx.navigateBack() }
})
