// pages/upload/upload.js
const app = getApp()
const api = require('../../utils/api.js')
const compat = require('../../utils/compat.js')

Page({
  data: {
    selectedFile: null,
    uploadedFileUrl: null,   // 上传后服务端返回的文件URL
    serverPageCount: null,   // 服务端返回的真实页数
    pageCount: 1,
    copies: 1,
    colorMode: 'bw',
    paperSize: 'A4',
    duplex: 'single',        // single=单面, double=双面
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
    uploading: false,
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

  // 设置已选文件 —— 选完立即上传获取真实页数
  setSelectedFile: function (file) {
    this.setData({
      selectedFile: {
        name: file.name,
        path: file.path,
        size: file.size,
        sizeText: (file.size / 1024).toFixed(1) + ' KB'
      },
      showFilePicker: false,
      uploadedFileUrl: null,
      serverPageCount: null
    })
    // 图片固定1页，不需要上传获取
    var ext = (file.name || '').split('.').pop().toLowerCase()
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) {
      this.setData({ pageCount: 1, serverPageCount: 1 })
      this.calculatePrice()
    } else {
      // 文档类：立即上传获取真实页数
      this.uploadForPageCount(file)
    }
  },

  // 上传文件获取真实页数（选文件后自动触发）
  uploadForPageCount: function (file) {
    var self = this
    this.setData({ uploading: true })
    wx.showLoading({ title: '解析页数中...', mask: true })

    api.uploadFile(file.path, file.name).then(function (uploadRes) {
      wx.hideLoading()
      var fileUrl = uploadRes.data.url
      var pageCount = uploadRes.data.pageCount || 1

      self.setData({
        uploadedFileUrl: fileUrl,
        serverPageCount: pageCount,
        pageCount: pageCount,
        uploading: false
      })
      self.calculatePrice()

      wx.showToast({ title: pageCount + '页', icon: 'success' })
    }).catch(function () {
      wx.hideLoading()
      // 上传失败，用默认1页，用户可手动改
      self.setData({ uploading: false, pageCount: 1 })
      self.calculatePrice()
      wx.showToast({ title: '页数解析失败，请手动输入', icon: 'none' })
    })
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
    this.calculatePrice()
  },

  setDuplex: function (e) {
    this.setData({ duplex: e.currentTarget.dataset.duplex })
    this.calculatePrice()
  },

  calculatePrice: function () {
    var d = this.data
    var pricePerPage = d.colorMode === 'color' ? d.priceColor : d.priceBw
    // 双面打印：每2页算1张纸的价格，不足2页按1张算
    var sheets = d.duplex === 'double' ? Math.ceil(d.pageCount / 2) : d.pageCount
    var printFee = sheets * d.copies * pricePerPage
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
    this.setData({ selectedFile: null, uploadedFileUrl: null, serverPageCount: null, pageCount: 1 })
    this.calculatePrice()
  },

  // 创建订单并支付
  createOrderAndPay: function () {
    const self = this
    const { selectedFile, pageCount, copies, colorMode, paperSize, duplex, pointsToUse, usePoints, uploadedFileUrl } = this.data

    if (!selectedFile) {
      wx.showToast({ title: '请先选择文件', icon: 'none' })
      return
    }

    if (this.data.uploading) {
      wx.showToast({ title: '文件解析中，请稍候', icon: 'none' })
      return
    }

    // 【升级v2】获取订单归属标识（账号优先，游客用deviceId）
    var identity = app.getOrderIdentity()
    var openid = identity.openid
    var deviceId = identity.deviceId

    // 无账号无设备ID时兜底（极少见）
    if (!openid && !deviceId) {
      wx.showToast({ title: '无法下单，请重试', icon: 'none' })
      return
    }

    this.setData({ loading: true })

    // 如果已经上传过（获取页数时上传的），直接用已有URL
    if (uploadedFileUrl) {
      wx.showLoading({ title: '创建订单...', mask: true })
      self.doCreateOrder(openid, deviceId, uploadedFileUrl, selectedFile.name, pageCount, copies, colorMode, paperSize, duplex, pointsToUse, usePoints)
    } else {
      // 图片等未提前上传的情况
      wx.showLoading({ title: '上传文件中...', mask: true })
      api.uploadFile(selectedFile.path, selectedFile.name).then(function (uploadRes) {
        var fileUrl = uploadRes.data.url
        var realPageCount = uploadRes.data.pageCount || pageCount
        if (realPageCount > 0) {
          self.setData({ pageCount: realPageCount })
        }
        wx.showLoading({ title: '创建订单...', mask: true })
        self.doCreateOrder(openid, deviceId, fileUrl, selectedFile.name, realPageCount, copies, colorMode, paperSize, duplex, pointsToUse, usePoints)
      }).catch(function (err) {
        wx.hideLoading()
        wx.showToast({ title: err.msg || '上传失败', icon: 'none' })
        self.setData({ loading: false })
      })
    }
  },

  doCreateOrder: function (openid, deviceId, fileUrl, fileName, pageCount, copies, colorMode, paperSize, duplex, pointsToUse, usePoints) {
    var self = this
    api.createOrder({
      openid: openid || null,
      deviceId: deviceId || null,
      fileName: fileName,
      fileUrl: fileUrl,
      pageCount: pageCount,
      copies: copies,
      colorMode: colorMode,
      paperSize: paperSize,
      duplex: duplex,
      pointsUsed: (usePoints && openid) ? pointsToUse : 0
    }).then(function (res) {
      wx.hideLoading()
      if (res.code === 200) {
        const orderNo = res.data.orderNo
        api.payCallback(orderNo).then(function () {
          wx.showToast({ title: '下单成功', icon: 'success' })
          setTimeout(function () {
            wx.redirectTo({
              url: '/pages/order-detail/order-detail?orderNo=' + orderNo
            })
          }, 1500)
        })
        app.refreshPoints()
      } else {
        wx.showToast({ title: res.msg || '创建订单失败', icon: 'none' })
      }
    }).catch(function (err) {
      wx.hideLoading()
      wx.showToast({ title: err.msg || '创建订单失败', icon: 'none' })
    }).finally(function () {
      self.setData({ loading: false })
    })
  }
})
