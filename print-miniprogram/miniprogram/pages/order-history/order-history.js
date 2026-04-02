// pages/order-history/order-history.js
const app = getApp()
const api = require('../../utils/api.js')

Page({
  data: {
    orders: [],
    loading: false,
    page: 1,
    pageSize: 10,
    hasMore: true,
    status: '',
    statusText: {
      '': '全部订单', 'pending': '待支付', 'paid': '已支付',
      'printing': '打印中', 'completed': '已完成', 'cancelled': '已取消'
    }
  },

  onLoad: function (options) {
    if (options && options.status) this.setData({ status: options.status })
    // 从globalData读取筛选状态（tabBar跳转时传参）
    if (app.globalData._filterStatus) {
      this.setData({ status: app.globalData._filterStatus })
      app.globalData._filterStatus = ''
    }
    this.loadOrders(true)
  },

  loadOrders: function (refresh) {
    const self = this
    if (this.data.loading) return
    const page = refresh ? 1 : this.data.page
    this.setData({ loading: true })

    const openid = app.globalData.openid
    if (!openid) { this.setData({ loading: false }); return }

    api.getUserOrders(openid, page, this.data.pageSize).then(function (res) {
      if (res.code === 200) {
        let newOrders = res.data.list
        // 前端筛选状态
        if (self.data.status) {
          newOrders = newOrders.filter(function (o) { return o.status === self.data.status })
        }
        const orders = refresh ? newOrders : self.data.orders.concat(newOrders)
        self.setData({
          orders,
          page: page + 1,
          hasMore: res.data.list.length >= self.data.pageSize
        })
      }
    }).finally(function () {
      self.setData({ loading: false })
      wx.stopPullDownRefresh()
    })
  },

  switchStatus: function (e) {
    this.setData({ status: e.currentTarget.dataset.status })
    this.loadOrders(true)
  },

  viewOrder: function (e) {
    wx.navigateTo({ url: `/pages/order-detail/order-detail?orderNo=${e.currentTarget.dataset.orderno}` })
  },

  payOrder: function (e) {
    wx.navigateTo({ url: `/pages/payment/payment?orderNo=${e.currentTarget.dataset.orderno}` })
  },

  cancelOrder: function (e) {
    const self = this
    const orderNo = e.currentTarget.dataset.orderno
    wx.showModal({
      title: '确认取消',
      content: '确定要取消这个订单吗？',
      success: function (res) {
        if (res.confirm) {
          api.cancelOrder(orderNo).then(function (res) {
            if (res.code === 200) {
              wx.showToast({ title: '取消成功', icon: 'success' })
              self.loadOrders(true)
            } else {
              wx.showToast({ title: res.msg || '取消失败', icon: 'none' })
            }
          })
        }
      }
    })
  },

  formatTime: function (dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  },

  getStatusText: function (status) { return this.data.statusText[status] || status },
  getStatusClass: function (status) { return 'tag-' + status },

  onPullDownRefresh: function () { this.loadOrders(true) },
  onReachBottom: function () { if (this.data.hasMore && !this.data.loading) this.loadOrders() }
})
