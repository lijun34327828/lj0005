const express = require('express');
const router = express.Router();
const logger = require('../logger');
const historyService = require('../services/historyService');
const rateLimiter = require('../middleware/rateLimiter');

router.use(rateLimiter.middleware());

router.get('/', (req, res) => {
  try {
    const { page = 1, pageSize = 20, keyword = '' } = req.query;
    
    const result = historyService.list({
      page: parseInt(page, 10),
      pageSize: parseInt(pageSize, 10),
      keyword
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    logger.error('获取历史记录失败:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const record = historyService.getById(id);
    
    if (!record) {
      return res.status(404).json({ 
        error: 'not_found', 
        message: '记录不存在' 
      });
    }
    
    res.json({
      success: true,
      data: record
    });
  } catch (err) {
    logger.error('获取记录详情失败:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const record = historyService.add(req.body);
    
    res.status(201).json({
      success: true,
      data: record
    });
  } catch (err) {
    logger.error('创建历史记录失败:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const deleted = historyService.delete(id);
    
    if (!deleted) {
      return res.status(404).json({ 
        error: 'not_found', 
        message: '记录不存在' 
      });
    }
    
    res.json({
      success: true,
      message: '删除成功'
    });
  } catch (err) {
    logger.error('删除历史记录失败:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

router.delete('/', (req, res) => {
  try {
    historyService.clear();
    
    res.json({
      success: true,
      message: '已清空所有历史记录'
    });
  } catch (err) {
    logger.error('清空历史记录失败:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

router.get('/stats/summary', (req, res) => {
  try {
    const stats = historyService.getStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    logger.error('获取统计信息失败:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

module.exports = router;
