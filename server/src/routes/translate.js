const express = require('express');
const router = express.Router();
const logger = require('../logger');
const translationService = require('../services/translationService');
const rateLimiter = require('../middleware/rateLimiter');
const historyService = require('../services/historyService');
const { nanoid } = require('nanoid');

router.use(rateLimiter.middleware());

router.get('/detect', async (req, res) => {
  try {
    const { text } = req.query;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'missing_text', message: '缺少文本参数' });
    }
    
    const result = translationService.detectLanguage(text);
    
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    logger.error('语种检测失败:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

router.post('/translate', async (req, res) => {
  try {
    const { text, sourceLang = 'auto', targetLang = 'zh' } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'missing_text', message: '缺少文本参数' });
    }
    
    if (text.length > 50000) {
      return res.status(400).json({ 
        error: 'text_too_long', 
        message: '文本过长，最大支持50000字符' 
      });
    }
    
    const chunks = translationService.splitText(text);
    const results = [];
    let fullTranslatedText = '';
    let engineUsed = 'unknown';
    
    for (const chunk of chunks) {
      try {
        const result = await translationService.translateChunk(
          chunk.text, 
          sourceLang, 
          targetLang
        );
        results.push({
          chunkId: chunk.id,
          original: chunk.text,
          translated: result.text,
          engine: result.engine,
          fromCache: result.fromCache
        });
        fullTranslatedText += result.text + ' ';
        engineUsed = result.engine;
      } catch (err) {
        results.push({
          chunkId: chunk.id,
          original: chunk.text,
          error: err.message
        });
      }
    }
    
    const record = historyService.add({
      id: nanoid(12),
      sourceText: text,
      targetText: fullTranslatedText.trim(),
      sourceLang,
      targetLang,
      engine: engineUsed
    });
    
    res.json({
      success: true,
      data: {
        chunks: results,
        fullText: fullTranslatedText.trim(),
        sourceLang,
        targetLang,
        recordId: record.id
      }
    });
  } catch (err) {
    logger.error('翻译失败:', err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

router.get('/stream/translate', (req, res) => {
  setupStreamTranslation(req, res);
});

router.post('/stream/translate', (req, res) => {
  setupStreamTranslation(req, res);
});

function setupStreamTranslation(req, res) {
  const text = req.body?.text || req.query?.text;
  const sourceLang = req.body?.sourceLang || req.query?.sourceLang || 'auto';
  const targetLang = req.body?.targetLang || req.query?.targetLang || 'zh';
  const recordId = req.body?.recordId || req.query?.recordId || nanoid(12);
  
  if (!text || typeof text !== 'string') {
    res.status(400).json({ error: 'missing_text', message: '缺少文本参数' });
    return;
  }
  
  if (text.length > 50000) {
    res.status(400).json({ error: 'text_too_long', message: '文本过长' });
    return;
  }
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  res.flushHeaders();
  
  let fullTranslatedText = '';
  let engineUsed = 'unknown';
  
  const stream = translationService.streamTranslate(text, sourceLang, targetLang);
  
  const sendEvent = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  (async () => {
    try {
      for await (const chunk of stream) {
        if (res.writableEnded) break;
        
        sendEvent(chunk.type, chunk);
        
        if (chunk.type === 'chunk_complete') {
          fullTranslatedText += chunk.translatedText + ' ';
          if (chunk.engine) {
            engineUsed = chunk.engine;
          }
        }
        
        const delay = 50;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      if (!res.writableEnded) {
        historyService.add({
          id: recordId,
          sourceText: text,
          targetText: fullTranslatedText.trim(),
          sourceLang,
          targetLang,
          engine: engineUsed
        });
        
        sendEvent('done', {
          recordId,
          fullText: fullTranslatedText.trim(),
          engine: engineUsed
        });
        
        res.end();
      }
    } catch (err) {
      logger.error('流式翻译错误:', err);
      if (!res.writableEnded) {
        sendEvent('error', { message: err.message });
        res.end();
      }
    }
  })();
  
  req.on('close', () => {
    logger.debug('客户端断开连接');
  });
}

router.get('/engines/status', (req, res) => {
  try {
    const status = translationService.getEngineStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

router.get('/stats', (req, res) => {
  try {
    const stats = translationService.getStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

module.exports = router;
