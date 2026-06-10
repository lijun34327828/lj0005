const logger = require('../logger');
const { getConfig } = require('../config');
const TextChunker = require('../utils/textChunker');
const LanguageDetector = require('../utils/languageDetector');
const { TranslationEngineManager, cleanTranslationTags } = require('./translationEngine');
const sensitiveFilter = require('./sensitiveFilter');
const translationCache = require('./translationCache');

class TranslationService {
  constructor() {
    this.chunker = null;
    this.langDetector = null;
    this.engineManager = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    
    const chunkerConfig = getConfig('translation');
    
    this.chunker = new TextChunker({
      maxChunkSize: chunkerConfig.maxChunkSize,
      minSentenceLength: chunkerConfig.minSentenceLength
    });
    
    this.langDetector = new LanguageDetector();
    this.engineManager = new TranslationEngineManager(chunkerConfig.engines);
    translationCache.init();
    sensitiveFilter.init();
    
    this.initialized = true;
    logger.info('翻译服务初始化完成');
  }

  detectLanguage(text) {
    this.init();
    return this.langDetector.detect(text);
  }

  _normalizeLang(lang) {
    if (!lang || lang === 'auto' || lang === 'unknown') return lang;
    return lang.replace(/-.*$/, '').toLowerCase().substring(0, 2);
  }

  async translateChunk(chunk, sourceLang, targetLang) {
    this.init();

    if (sourceLang === 'auto') {
      return this._translateAutoDetect(chunk, targetLang);
    }

    const cacheResult = translationCache.get(chunk, sourceLang, targetLang);
    if (cacheResult) {
      cacheResult.text = cleanTranslationTags(cacheResult.text);
      logger.debug('缓存命中，跳过翻译');
      return cacheResult;
    }

    const result = await this.engineManager.translateWithFallback(
      chunk, sourceLang, targetLang
    );
    result.text = cleanTranslationTags(result.text);
    translationCache.set(chunk, sourceLang, targetLang, result);
    return result;
  }

  async _translateAutoDetect(chunk, targetLang) {
    const targetNorm = this._normalizeLang(targetLang);
    const sentences = this.chunker.splitIntoSentences(chunk);

    if (sentences.length === 0) {
      return { text: chunk, engine: 'none', sourceLang: 'auto', targetLang };
    }

    if (sentences.length === 1) {
      return this._translateSingleSentence(sentences[0], targetLang, targetNorm);
    }

    const translatedParts = [];
    let lastEngine = 'auto-mixed';

    for (const sentence of sentences) {
      const detection = this.detectLanguage(sentence);
      const sentenceLang = this._normalizeLang(detection.language);

      if (sentenceLang === targetNorm || sentenceLang === 'unknown' || sentenceLang === 'auto') {
        translatedParts.push(sentence);
      } else {
        const cacheKey = sentence;
        const cacheResult = translationCache.get(cacheKey, sentenceLang, targetLang);
        if (cacheResult) {
          cacheResult.text = cleanTranslationTags(cacheResult.text);
          translatedParts.push(cacheResult.text);
          lastEngine = cacheResult.engine || lastEngine;
        } else {
          const result = await this.engineManager.translateWithFallback(
            sentence, sentenceLang, targetLang
          );
          result.text = cleanTranslationTags(result.text);
          translationCache.set(cacheKey, sentenceLang, targetLang, result);
          translatedParts.push(result.text);
          lastEngine = result.engine || lastEngine;
        }
      }
    }

    return {
      text: translatedParts.join(' '),
      engine: lastEngine,
      sourceLang: 'auto',
      targetLang
    };
  }

  async _translateSingleSentence(sentence, targetLang, targetNorm) {
    const detection = this.detectLanguage(sentence);
    const sentenceLang = this._normalizeLang(detection.language);

    if (sentenceLang === targetNorm || sentenceLang === 'unknown' || sentenceLang === 'auto') {
      return { text: sentence, engine: 'same-lang', sourceLang: detection.language || 'auto', targetLang };
    }

    const cacheResult = translationCache.get(sentence, sentenceLang, targetLang);
    if (cacheResult) {
      cacheResult.text = cleanTranslationTags(cacheResult.text);
      logger.debug('缓存命中，跳过翻译');
      return cacheResult;
    }

    const result = await this.engineManager.translateWithFallback(
      sentence, sentenceLang, targetLang
    );
    result.text = cleanTranslationTags(result.text);
    translationCache.set(sentence, sentenceLang, targetLang, result);
    return result;
  }

  applyFilter(text) {
    this.init();
    return sensitiveFilter.filter(text);
  }

  splitText(text) {
    this.init();
    return this.chunker.splitText(text);
  }

  async* streamTranslate(text, sourceLang = 'auto', targetLang = 'zh') {
    this.init();
    
    const chunks = this.splitText(text);
    const totalChunks = chunks.length;
    
    logger.info(`开始流式翻译，共 ${totalChunks} 个片段`);
    
    let overallDetectedLang = sourceLang;
    if (sourceLang === 'auto' && chunks.length > 0) {
      const detection = this.detectLanguage(chunks[0].text);
      overallDetectedLang = detection.language;
      logger.info(`自动检测语种: ${overallDetectedLang}, 置信度: ${detection.confidence}`);
    }
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      yield {
        type: 'chunk_start',
        chunkId: chunk.id,
        totalChunks,
        chunkIndex: i,
        progress: Math.round((i / totalChunks) * 100)
      };
      
      try {
        const sourceFilterResult = this.applyFilter(chunk.text);
        
        if (sourceFilterResult.blocked) {
          yield {
            type: 'chunk_blocked',
            chunkId: chunk.id,
            reason: sourceFilterResult.blockReason,
            blockedWords: sourceFilterResult.blockedWords
          };
          continue;
        }
        
        let textToTranslate = sourceFilterResult.text;
        if (sourceFilterResult.filtered) {
          yield {
            type: 'filter_warning',
            chunkId: chunk.id,
            warnings: sourceFilterResult.warnings,
            maskedWords: sourceFilterResult.maskedWords
          };
        }
        
        const translation = await this.translateChunk(
          textToTranslate,
          sourceLang,
          targetLang
        );
        
        const targetFilterResult = this.applyFilter(translation.text);
        
        if (targetFilterResult.blocked) {
          yield {
            type: 'translation_blocked',
            chunkId: chunk.id,
            reason: targetFilterResult.blockReason
          };
          continue;
        }
        
        yield {
          type: 'chunk_complete',
          chunkId: chunk.id,
          originalText: chunk.text,
          translatedText: targetFilterResult.text,
          sourceLang: translation.sourceLang || overallDetectedLang,
          targetLang,
          engine: translation.engine,
          fromCache: translation.fromCache || false,
          filtered: targetFilterResult.filtered,
          warnings: targetFilterResult.warnings,
          progress: Math.round(((i + 1) / totalChunks) * 100)
        };
        
      } catch (err) {
        logger.error(`片段 ${chunk.id} 翻译失败:`, err.message);
        
        yield {
          type: 'chunk_error',
          chunkId: chunk.id,
          error: err.message,
          originalText: chunk.text
        };
      }
    }
    
    yield {
      type: 'complete',
      totalChunks,
      sourceLang: overallDetectedLang,
      targetLang
    };
  }

  getEngineStatus() {
    this.init();
    return this.engineManager.getEngineStatus();
  }

  getStats() {
    this.init();
    return {
      engines: this.engineManager.getEngineStatus(),
      cache: translationCache.getStats(),
      filter: sensitiveFilter.getStats()
    };
  }
}

module.exports = new TranslationService();
