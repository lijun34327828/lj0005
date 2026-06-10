const crypto = require('crypto');
const logger = require('../logger');
const { getConfig } = require('../config');

class TranslationCache {
  constructor() {
    this.cache = new Map();
    this.enabled = true;
    this.ttlMs = 3600000;
    this.maxSize = 500;
  }

  init(options = {}) {
    this.enabled = options.enabled !== undefined 
      ? options.enabled 
      : (getConfig('cache.enabled') !== false);
    this.ttlMs = options.ttlMs || getConfig('cache.ttlMs') || 3600000;
    this.maxSize = options.maxSize || getConfig('cache.maxSize') || 500;
  }

  generateKey(text, sourceLang, targetLang) {
    const content = `${sourceLang || 'auto'}:${targetLang}:${text.trim().toLowerCase()}`;
    return crypto.createHash('md5').update(content).digest('hex');
  }

  get(text, sourceLang, targetLang) {
    if (!this.enabled) return null;
    
    const key = this.generateKey(text, sourceLang, targetLang);
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    const now = Date.now();
    if (now - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    
    entry.accessCount++;
    logger.debug(`缓存命中: ${key.substring(0, 8)}..., 命中次数: ${entry.accessCount}`);
    
    return {
      ...entry.data,
      fromCache: true,
      cacheKey: key
    };
  }

  set(text, sourceLang, targetLang, data) {
    if (!this.enabled) return;
    
    const key = this.generateKey(text, sourceLang, targetLang);
    
    this.evictIfNeeded();
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      accessCount: 1
    });
    
    logger.debug(`缓存写入: ${key.substring(0, 8)}...`);
  }

  evictIfNeeded() {
    if (this.cache.size < this.maxSize) return;
    
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => {
      const aScore = a[1].accessCount / (Date.now() - a[1].timestamp);
      const bScore = b[1].accessCount / (Date.now() - b[1].timestamp);
      return aScore - bScore;
    });
    
    const removeCount = Math.floor(this.maxSize * 0.2);
    for (let i = 0; i < removeCount && i < entries.length; i++) {
      this.cache.delete(entries[i][0]);
    }
    
    logger.debug(`缓存淘汰: 移除 ${removeCount} 条旧记录`);
  }

  has(text, sourceLang, targetLang) {
    return this.get(text, sourceLang, targetLang) !== null;
  }

  clear() {
    const size = this.cache.size;
    this.cache.clear();
    logger.info(`缓存清空，共清除 ${size} 条记录`);
  }

  getStats() {
    let totalHits = 0;
    let expiredCount = 0;
    const now = Date.now();
    
    for (const entry of this.cache.values()) {
      if (now - entry.timestamp > this.ttlMs) {
        expiredCount++;
      } else {
        totalHits += entry.accessCount - 1;
      }
    }
    
    return {
      enabled: this.enabled,
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
      hitEstimate: totalHits
    };
  }
}

module.exports = new TranslationCache();
