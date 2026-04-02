// pages/points/points.js
const app = getApp()
const api = require('../../utils/api.js')

Page({
  data: {
    points: 0,
    records: [],
    loading: false,
    page: 1,
    pageSize: 20,
    hasMore: true
  },

  onLoad: function () { this.loadPoints(); this.loadRecords() },
  onShow: function () { this.loadPoints() },

  loadPoints: function () {
    const self = this
    const openid = app.globalData.openid
    if (!openid) return

    api.getUserInfo(openid).then(function (res) {
      if (res.code === 200) {
        self.setData({ points: res.data.points })
        app.globalData.points = res.data.points
      }
    })
  },

  loadRecords: function (refresh) {
    const self = this
    if (this.data.loading) return
    const page = refresh ? 1 : this.data.page
    this.setData({ loading: true })

    // 积分记录需要通过用户详情获取
    const openid = app.globalData.openid
    if (!openid) { this.setData({ loading: false }); return }

    api.getUserInfo(openid).then(function (res) {
      if (res.code === 200 && res.data.pointsRecords) {
        const newRecords = res.data.pointsRecords
        const records = refresh ? newRecords : self.data.records.concat(newRecords)
        self.setData({
          records,
          page: page + 1,
          hasMore: newRecords.length >= self.data.pageSize
        })
      }
    }).finally(function () {
      self.setData({ loading: false })
      wx.stopPullDownRefresh()
    })
  },

  formatTime: function (dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  },

  onPullDownRefresh: function () { this.loadPoints(); this.loadRecords(true) },
  onReachBottom: function () { if (this.data.hasMore && !this.data.loading) this.loadRecords() }
})
