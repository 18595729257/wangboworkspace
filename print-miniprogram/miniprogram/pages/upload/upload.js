// pages/upload/upload.js
const app = getApp()
const api = require('../../utils/api.js')
const compat = require('../../utils/compat.js')

Page({
  data: {
    selectedFile: null,
    pageCount: 1,
    copies: 1,
    colorMode: 'bw',
    paperSize: 'A4',
    printFee: '0.00',
    serviceFee: '0.10',
    totalFee: '0.00',
    priceBw: 0.1,
    priceColor: 0.5,
    serviceFeeVal: 0.1,
    pointsDeductRate: 100,
    maxPointsDiscount: 5,
    isLogin: false,
    userPoints: 0,
    usePoints: false,
    pointsToUse: 0,
    pointsDiscount: '0.00',
    actualPay: '0.00',
    loading: false,
    showFilePicker: false
  },

  onLoad: function () { this.checkLogin(); this.loadConfig() },
  onShow: function () { this.checkLogin(); this.calculatePrice() },

  checkLogin: function () {
    this.setData({
      isLogin: app.globalData.isLogin,
      userPoints: app.globalData.points || 0
    })
  },

  // 快速登录
  quickLogin: function () {
    var self = this
    wx.login({
      success: function (res) {
        if (!res.code) return
        var userInfo = {
          openid: 'local_' + Date.now(),
          nickName: '微信用户',
          avatarUrl: '',
          points: 0
        }
        app.saveLogin(userInfo)
        self.setData({ isLogin: true, userPoints: 0 })
        wx.showToast({ title: '登录成功', icon: 'success' })
        // 后台同步
        api.wxLogin(res.code).then(function (r) {
          if (r.code === 200 && r.data && r.data.openid) {
            userInfo.openid = r.data.openid
            userInfo.points = r.data.points || 0
            app.saveLogin(userInfo)
            self.setData({ userPoints: userInfo.points })
          }
        }).catch(function () {})
      }
    })
  },

  // 从服务器加载价格配置
  loadConfig: function () {
    const self = this
    api.getConfig().then(function (res) {
      if (res.code === 200) {
        var c = res.data
        self.setData({
          priceBw: parseFloat(c.price_bw) || 0.1,
          priceColor: parseFloat(c.price_color) || 0.5,
          serviceFeeVal: parseFloat(c.service_fee) || 0.1,
          pointsDeductRate: parseInt(c.points_deduct_rate) || 100,
          maxPointsDiscount: parseFloat(c.max_points_discount) || 5
        })
        self.calculatePrice()
      }
    }).catch(function () {})
  },

  chooseFile: function () {
    this.setData({ showFilePicker: true })
  },

  hideFilePicker: function () {
    this.setData({ showFilePicker: false })
  },

  // 设置已选文件
  setSelectedFile: function (file) {
    this.setData({
      selectedFile: {
        name: file.name,
        path: file.path,
        size: file.size,
        sizeText: (file.size / 1024).toFixed(1) + ' KB'
      },
      showFilePicker: false
    })
    this.estimatePageCount(file.name)
  },

  // 选择本地文件
  chooseLocalFile: function () {
    const self = this
    compat.chooseFile({ count: 1, type: 'file' }).then(function (res) {
      self.setSelectedFile(res.tempFiles[0])
    }).catch(function () {
      compat.showToast('文件选择失败')
    })
  },

  // 选择微信聊天文件
  chooseChatFile: function () {
    const self = this
    compat.chooseFile({ count: 1, type: 'file' }).then(function (res) {
      self.setSelectedFile(res.tempFiles[0])
    }).catch(function () {
      compat.showToast('文件选择失败')
    })
  },

  // 选择手机相册图片
  chooseAlbumImage: function () {
    const self = this
    compat.chooseImage({ count: 1, sourceType: ['album', 'camera'] }).then(function (res) {
      var file = res.tempFiles[0]
      self.setSelectedFile({
        name: file.name || '图片.jpg',
        path: file.path,
        size: file.size || 0
      })
    }).catch(function () {
      compat.showToast('图片选择失败')
    })
  },

  estimatePageCount: function (fileName) {
    const ext = fileName.split('.').pop().toLowerCase()
    let pageCount = 1
    // 图片固定1页，其他格式让用户手动输入
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) pageCount = 1
    else pageCount = 1 // PDF/Word等由服务端上传后返回真实页数，这里先设1
    this.setData({ pageCount })
    this.calculatePrice()
  },

  setPageCount: function (e) {
    this.setData({ pageCount: Math.max(1, parseInt(e.detail.value) || 1) })
    this.calculatePrice()
  },

  setCopies: function (e) {
    this.setData({ copies: Math.max(1, parseInt(e.detail.value) || 1) })
    this.calculatePrice()
  },

  setColorMode: function (e) {
    this.setData({ colorMode: e.currentTarget.dataset.mode })
    this.calculatePrice()
  },

  setPaperSize: function (e) {
    this.setData({ paperSize: e.currentTarget.dataset.size })
  },

  calculatePrice: function () {
    var d = this.data
    var pricePerPage = d.colorMode === 'color' ? d.priceColor : d.priceBw
    var printFee = d.pageCount * d.copies * pricePerPage
    var serviceFee = d.serviceFeeVal
    var pointsDiscount = 0
    if (d.usePoints && d.pointsToUse > 0) {
      var maxDiscount = Math.min(d.maxPointsDiscount, printFee)
      pointsDiscount = Math.min(d.pointsToUse / d.pointsDeductRate, maxDiscount)
    }
    var totalFee = printFee + serviceFee
    var actualPay = Math.max(totalFee - pointsDiscount, 0.01)

    this.setData({
      printFee: printFee.toFixed(2),
      serviceFee: serviceFee.toFixed(2),
      totalFee: totalFee.toFixed(2),
      pointsDiscount: pointsDiscount.toFixed(2),
      actualPay: actualPay.toFixed(2),
      maxPointsDiscount: Math.min(d.maxPointsDiscount, printFee)
    })

    if (d.isLogin) {
      var maxPointsNeeded = Math.ceil(this.data.maxPointsDiscount * d.pointsDeductRate)
      this.setData({ pointsToUse: Math.min(d.userPoints, maxPointsNeeded) })
    }
  },

  togglePoints: function (e) {
    this.setData({ usePoints: e.detail.value })
    this.calculatePrice()
  },

  setPointsToUse: function (e) {
    var pointsToUse = parseInt(e.detail.value) || 0
    var maxPoints = Math.min(this.data.userPoints, Math.ceil(this.data.maxPointsDiscount * this.data.pointsDeductRate))
    this.setData({ pointsToUse: Math.min(pointsToUse, maxPoints) })
    this.calculatePrice()
  },

  removeFile: function () {
    this.setData({ selectedFile: null, pageCount: 1 })
    this.calculatePrice()
  },

  // 创建订单并支付
  createOrderAndPay: function () {
    const self = this
    const { selectedFile, pageCount, copies, colorMode, paperSize, pointsToUse, usePoints } = this.data

    if (!selectedFile) {
      wx.showToast({ title: '请先选择文件', icon: 'none' })
      return
    }

    // 没有openid用匿名标识，不阻断下单
    var openid = app.globalData.openid || ('anon_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6))

    this.setData({ loading: true })
    wx.showLoading({ title: '上传文件中...', mask: true })

    // 第一步：上传文件到服务器
    api.uploadFile(selectedFile.path, selectedFile.name).then(function (uploadRes) {
      var fileUrl = uploadRes.data.url
      // 使用服务端返回的真实页数
      if (uploadRes.data.pageCount && uploadRes.data.pageCount > 0) {
        self.setData({ pageCount: uploadRes.data.pageCount })
        self.calculatePrice()
      }

      wx.showLoading({ title: '创建订单...', mask: true })

      // 第二步：创建订单（带上文件URL）
      return api.createOrder({
        openid: openid,
        fileName: selectedFile.name,
        fileUrl: fileUrl,
        pageCount: pageCount,
        copies: copies,
        colorMode: colorMode,
        paperSize: paperSize,
        pointsUsed: usePoints ? pointsToUse : 0
      })
    }).then(function (res) {
      wx.hideLoading()
      if (res.code === 200) {
        const orderNo = res.data.orderNo

        // 模拟支付成功（正式环境对接微信支付）
        api.payCallback(orderNo).then(function () {
          wx.showToast({ title: '下单成功', icon: 'success' })
          setTimeout(function () {
            wx.redirectTo({
              url: `/pages/order-detail/order-detail?orderNo=${orderNo}`
            })
          }, 1500)
        })

        app.refreshPoints()
      } else {
        wx.showToast({ title: res.msg || '创建订单失败', icon: 'none' })
      }
    }).catch(function (err) {
      wx.hideLoading()
      wx.showToast({ title: err.msg || '上传失败', icon: 'none' })
    }).finally(function () {
      self.setData({ loading: false })
    })
  }
})
