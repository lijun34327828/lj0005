const fs = require('fs');
const path = require('path');
const { nanoid } = require('nanoid');
const logger = require('../logger');
const { getConfig } = require('../config');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

class HistoryService {
  constructor() {
    this.history = [];
    this.loaded = false;
  }

  ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  load() {
    if (this.loaded) return;
    
    this.ensureDataDir();
    
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
        this.history = JSON.parse(raw);
        logger.info(`加载历史记录: ${this.history.length} 条`);
      }
    } catch (err) {
      logger.error('加载历史记录失败:', err.message);
      this.history = [];
    }
    
    this.loaded = true;
  }

  save() {
    try {
      this.ensureDataDir();
      const maxStored = getConfig('history.maxStored') || 500;
      
      if (this.history.length > maxStored) {
        this.history = this.history.slice(0, maxStored);
      }
      
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(this.history, null, 2), 'utf-8');
      logger.debug(`保存历史记录: ${this.history.length} 条`);
    } catch (err) {
      logger.error('保存历史记录失败:', err.message);
    }
  }

  add(record) {
    this.load();
    
    const newRecord = {
      id: record.id || nanoid(12),
      sourceText: record.sourceText,
      targetText: record.targetText,
      sourceLang: record.sourceLang || 'auto',
      targetLang: record.targetLang || 'zh',
      engine: record.engine || 'unknown',
      filtered: record.filtered || false,
      warnings: record.warnings || [],
      createdAt: record.createdAt || Date.now()
    };
    
    this.history.unshift(newRecord);
    this.save();
    
    return newRecord;
  }

  getById(id) {
    this.load();
    return this.history.find(r => r.id === id) || null;
  }

  list(options = {}) {
    this.load();
    
    let { page = 1, pageSize = 20, keyword = '' } = options;
    
    page = parseInt(page, 10) || 1;
    pageSize = parseInt(pageSize, 10) || 20;
    
    let filtered = this.history;
    
    if (keyword && keyword.trim()) {
      const kw = keyword.toLowerCase().trim();
      filtered = filtered.filter(r => 
        r.sourceText.toLowerCase().includes(kw) ||
        r.targetText.toLowerCase().includes(kw)
      );
    }
    
    const total = filtered.length;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const items = filtered.slice(startIndex, endIndex);
    
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      hasMore: endIndex < total
    };
  }

  delete(id) {
    this.load();
    const index = this.history.findIndex(r => r.id === id);
    if (index !== -1) {
      this.history.splice(index, 1);
      this.save();
      return true;
    }
    return false;
  }

  clear() {
    this.history = [];
    this.save();
    logger.info('历史记录已清空');
  }

  getStats() {
    this.load();
    return {
      total: this.history.length,
      languages: this.countLanguages()
    };
  }

  countLanguages() {
    const langMap = {};
    for (const record of this.history) {
      const key = `${record.sourceLang}->${record.targetLang}`;
      langMap[key] = (langMap[key] || 0) + 1;
    }
    return langMap;
  }
}

module.exports = new HistoryService();
