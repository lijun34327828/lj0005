const express = require('express');
const router = express.Router();
const logger = require('../logger');
const sensitiveFilter = require('../services/sensitiveFilter');
const rateLimiter = require('../middleware/rateLimiter');

router.use(rateLimiter.middleware());

router.get('/stats', (req, res) => {
  try {
    const stats = sensitiveFilter.getStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    logger.error('获取敏感词统计失败:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

router.post('/test', (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'missing_text', message: '缺少文本参数' });
    }
    
    const result = sensitiveFilter.filter(text);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('敏感词测试失败:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

router.post('/words/:level', (req, res) => {
  try {
    const { level } = req.params;
    const { words } = req.body;
    
    if (!words || !Array.isArray(words)) {
      return res.status(400).json({ 
        error: 'invalid_words', 
        message: 'words 必须是数组' 
      });
    }
    
    if (!['warn', 'mask', 'block'].includes(level)) {
      return res.status(400).json({ 
        error: 'invalid_level', 
        message: '级别必须是 warn, mask 或 block' 
      });
    }
    
    sensitiveFilter.addWords(level, words);
    
    res.json({
      success: true,
      message: `已添加 ${words.length} 个敏感词`
    });
  } catch (err) {
    logger.error('添加敏感词失败:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

module.exports = router;
