// pages/upload/upload.js - 【多文件版本】支持混合类型多选
const app = getApp()
const api = require('../../utils/api.js')
const compat = require('../../utils/compat.js')

Page({
  data: {
    selectedFiles: [],       // 多文件数组
    uploadedFiles: [],       // 已上传文件信息 [{name, url, pageCount, type}]
    totalPageCount: 0,       // 总页数
    copies: 1,
    colorMode: 'bw',
    paperSize: 'A4',
    duplex: 'single',
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
    showFilePicker: false,
    maxFiles: 10            // 最多10个文件
  },

  onLoad: function () { this.checkLogin(); this.loadConfig() },
  onShow: function () { this.checkLogin(); this.calculatePrice() },

  checkLogin: function () {
    this.setData({
      isLogin: app.globalData.isLogin,
      userPoints: app.globalData.points || 0
    })
  },

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

  // 判断文件类型
  getFileType: function (fileName) {
    var ext = (fileName || '').split('.').pop().toLowerCase()
    var imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
    var docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf']
    if (imageExts.includes(ext)) return 'image'
    if (docExts.includes(ext)) return 'document'
    return 'other'
  },

  // 添加文件到列表
  addFiles: function (files) {
    var current = this.data.selectedFiles
    var remaining = this.data.maxFiles - current.length
    if (remaining <= 0) {
      wx.showToast({ title: '最多' + this.data.maxFiles + '个文件', icon: 'none' })
      return
    }
    var toAdd = files.slice(0, remaining)
    var newFiles = current.concat(toAdd.map(function (f) {
      return {
        name: f.name,
        path: f.path,
        size: f.size,
        sizeText: (f.size / 1024).toFixed(1) + ' KB',
        type: this.getFileType(f.name),
        status: 'pending',     // pending/uploading/done/error
        pageCount: null,
        url: null
      }
    }.bind(this)))
    this.setData({ selectedFiles: newFiles, showFilePicker: false })
    // 自动开始上传解析
    this.uploadAllFiles()
  },

  // 批量上传并解析页数
  uploadAllFiles: function () {
    var self = this
    var files = this.data.selectedFiles
    files.forEach(function (file, index) {
      if (file.status !== 'pending') return
      self.uploadSingleFile(index)
    })
  },

  // 上传单个文件获取页数
  uploadSingleFile: function (index) {
    var self = this
    var files = this.data.selectedFiles
    var file = files[index]
    if (!file || file.status !== 'pending') return

    // 图片固定1页，直接标记完成
    if (file.type === 'image') {
      var updated = files.slice()
      updated[index] = Object.assign({}, file, { status: 'done', pageCount: 1 })
      self.setData({ selectedFiles: updated })
      self.updateTotalPages()
      return
    }

    // 文档类需要上传解析
    var updated = files.slice()
    updated[index] = Object.assign({}, file, { status: 'uploading' })
    self.setData({ selectedFiles: updated })

    api.uploadFile(file.path, file.name).then(function (res) {
      var updated2 = self.data.selectedFiles.slice()
      var f = updated2[index]
      if (f) {
        updated2[index] = Object.assign({}, f, {
          status: 'done',
          url: res.data.url,
          pageCount: res.data.pageCount || 1
        })
        self.setData({ selectedFiles: updated2 })
        self.updateTotalPages()
      }
    }).catch(function () {
      var updated2 = self.data.selectedFiles.slice()
      var f = updated2[index]
      if (f) {
        updated2[index] = Object.assign({}, f, { status: 'error', pageCount: 1 })
        self.setData({ selectedFiles: updated2 })
        self.updateTotalPages()
      }
    })
  },

  // 更新总页数
  updateTotalPages: function () {
    var total = this.data.selectedFiles.reduce(function (sum, f) {
      return sum + (f.pageCount || 0)
    }, 0)
    this.setData({ totalPageCount: total })
    this.calculatePrice()
  },

  // 选择本地文件（多选）
  chooseLocalFile: function () {
    var self = this
    var remaining = this.data.maxFiles - this.data.selectedFiles.length
    if (remaining <= 0) {
      wx.showToast({ title: '最多' + this.data.maxFiles + '个文件', icon: 'none' })
      return
    }
    compat.chooseFile({ count: remaining, type: 'file' }).then(function (res) {
      self.addFiles(res.tempFiles)
    }).catch(function () {
      compat.showToast('文件选择失败')
    })
  },

  // 选择微信聊天文件（多选）
  chooseChatFile: function () {
    var self = this
    var remaining = this.data.maxFiles - this.data.selectedFiles.length
    if (remaining <= 0) {
      wx.showToast({ title: '最多' + this.data.maxFiles + '个文件', icon: 'none' })
      return
    }
    compat.chooseFile({ count: remaining, type: 'file' }).then(function (res) {
      self.addFiles(res.tempFiles)
    }).catch(function () {
      compat.showToast('文件选择失败')
    })
  },

  // 选择手机相册图片（多选）
  chooseAlbumImage: function () {
    var self = this
    var remaining = this.data.maxFiles - this.data.selectedFiles.length
    if (remaining <= 0) {
      wx.showToast({ title: '最多' + this.data.maxFiles + '个文件', icon: 'none' })
      return
    }
    compat.chooseImage({ count: remaining, sourceType: ['album', 'camera'] }).then(function (res) {
      var files = res.tempFiles.map(function (f) {
        return {
          name: f.name || '图片.jpg',
          path: f.path,
          size: f.size || 0
        }
      })
      self.addFiles(files)
    }).catch(function () {
      compat.showToast('图片选择失败')
    })
  },

  // 删除单个文件
  removeFile: function (e) {
    var index = e.currentTarget.dataset.index
    var files = this.data.selectedFiles.slice()
    files.splice(index, 1)
    this.setData({ selectedFiles: files })
    this.updateTotalPages()
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
    // 双面打印：每2页算1张纸
    var sheets = d.duplex === 'double' ? Math.ceil(d.totalPageCount / 2) : d.totalPageCount
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

  // 检查是否所有文件都上传完成
  isAllUploaded: function () {
    return this.data.selectedFiles.every(function (f) {
      return f.status === 'done' || f.status === 'error'
    })
  },

  // 创建订单并支付
  createOrderAndPay: function () {
    var self = this
    var files = this.data.selectedFiles

    if (files.length === 0) {
      wx.showToast({ title: '请先选择文件', icon: 'none' })
      return
    }

    // 检查是否还有上传中的文件
    var uploading = files.some(function (f) { return f.status === 'uploading' })
    if (uploading) {
      wx.showToast({ title: '文件上传中，请稍候', icon: 'none' })
      return
    }

    // 获取已上传的文件列表
    var uploadedFiles = files.filter(function (f) {
      return f.status === 'done' && f.url
    }).map(function (f) {
      return {
        name: f.name,
        url: f.url,
        pageCount: f.pageCount || 1
      }
    })

    if (uploadedFiles.length === 0) {
      wx.showToast({ title: '文件上传失败，请重试', icon: 'none' })
      return
    }

    var identity = app.getOrderIdentity()
    var openid = identity.openid
    var deviceId = identity.deviceId

    if (!openid && !deviceId) {
      wx.showToast({ title: '无法下单，请重试', icon: 'none' })
      return
    }

    this.setData({ loading: true })
    wx.showLoading({ title: '创建订单...', mask: true })

    var mainFile = uploadedFiles[0]
    var filesJson = JSON.stringify(uploadedFiles)

    api.createOrder({
      openid: openid || null,
      deviceId: deviceId || null,
      fileName: mainFile.name,
      fileUrl: mainFile.url,
      files: filesJson,
      pageCount: self.data.totalPageCount,
      copies: self.data.copies,
      colorMode: self.data.colorMode,
      paperSize: self.data.paperSize,
      duplex: self.data.duplex,
      pointsUsed: (self.data.usePoints && openid) ? self.data.pointsToUse : 0
    }).then(function (res) {
      wx.hideLoading()
      if (res.code === 200) {
        var orderNo = res.data.orderNo
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
        self.setData({ loading: false })
      }
    }).catch(function (err) {
      wx.hideLoading()
      wx.showToast({ title: err.msg || '创建订单失败', icon: 'none' })
      self.setData({ loading: false })
    })
  }
})
