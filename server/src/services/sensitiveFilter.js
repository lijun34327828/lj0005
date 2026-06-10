const { getConfig } = require('../config');
const logger = require('../logger');

class SensitiveWordFilter {
  constructor() {
    this.trie = { children: {}, isEnd: false, level: null };
    this.levels = {};
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    
    const config = getConfig('sensitiveWords');
    if (!config || !config.enabled) {
      this.initialized = true;
      return;
    }

    this.levels = config.levels || {};
    
    for (const [levelName, levelConfig] of Object.entries(this.levels)) {
      if (levelConfig.words && Array.isArray(levelConfig.words)) {
        for (const word of levelConfig.words) {
          this.addWord(word, levelName, levelConfig);
        }
      }
    }
    
    this.initialized = true;
    logger.info(`敏感词过滤器初始化完成，共 ${Object.keys(this.levels).length} 个级别`);
  }

  addWord(word, level, config) {
    let node = this.trie;
    const lowerWord = word.toLowerCase();
    
    for (const char of lowerWord) {
      if (!node.children[char]) {
        node.children[char] = { children: {}, isEnd: false, level: null };
      }
      node = node.children[char];
    }
    
    node.isEnd = true;
    node.level = level;
    node.config = config;
  }

  filter(text) {
    this.init();
    
    const config = getConfig('sensitiveWords');
    if (!config || !config.enabled) {
      return {
        filtered: false,
        text,
        blocked: false,
        warnings: [],
        maskedWords: []
      };
    }

    const result = {
      filtered: false,
      text: text,
      blocked: false,
      warnings: [],
      maskedWords: [],
      blockReason: null
    };

    const matches = this.findAllMatches(text);

    if (matches.length === 0) {
      return result;
    }

    const blockMatches = matches.filter(m => m.level === 'block');
    if (blockMatches.length > 0) {
      result.blocked = true;
      result.filtered = true;
      result.blockReason = `检测到违禁内容，包含 ${blockMatches.length} 个严重违禁词`;
      result.blockedWords = blockMatches.map(m => m.word);
      return result;
    }

    let filteredText = text;
    const maskMatches = matches.filter(m => m.level === 'mask');
    const warnMatches = matches.filter(m => m.level === 'warn');

    for (const match of maskMatches) {
      const maskChar = this.levels[match.level]?.maskChar || '*';
      const maskStr = maskChar.repeat(match.word.length);
      const regex = new RegExp(this.escapeRegex(match.word), 'gi');
      filteredText = filteredText.replace(regex, maskStr);
      result.maskedWords.push(match.word);
    }

    if (maskMatches.length > 0) {
      result.filtered = true;
      result.text = filteredText;
    }

    for (const match of warnMatches) {
      if (!result.warnings.includes(match.word)) {
        result.warnings.push(match.word);
      }
    }

    if (warnMatches.length > 0) {
      result.filtered = true;
    }

    return result;
  }

  findAllMatches(text) {
    const matches = [];
    const lowerText = text.toLowerCase();
    
    for (let i = 0; i < lowerText.length; i++) {
      let node = this.trie;
      let currentMatch = '';
      
      for (let j = i; j < lowerText.length; j++) {
        const char = lowerText[j];
        if (!node.children[char]) {
          break;
        }
        
        node = node.children[char];
        currentMatch += text[j];
        
        if (node.isEnd) {
          matches.push({
            word: currentMatch,
            level: node.level,
            start: i,
            end: j
          });
        }
      }
    }

    return this.removeOverlaps(matches);
  }

  removeOverlaps(matches) {
    if (matches.length <= 1) return matches;
    
    matches.sort((a, b) => a.start - b.start || b.end - a.end);
    
    const result = [];
    let lastEnd = -1;
    
    for (const match of matches) {
      if (match.start >= lastEnd) {
        result.push(match);
        lastEnd = match.end + 1;
      }
    }
    
    return result;
  }

  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  addWords(level, words) {
    this.init();
    
    if (!this.levels[level]) {
      this.levels[level] = { words: [] };
    }
    
    for (const word of words) {
      this.addWord(word, level, this.levels[level]);
      if (this.levels[level].words.indexOf(word) === -1) {
        this.levels[level].words.push(word);
      }
    }
    
    logger.info(`添加敏感词库添加 ${words.length} 个词到 ${level} 级别`);
  }

  getStats() {
    this.init();
    
    const stats = {};
    for (const [level, config] of Object.entries(this.levels)) {
      stats[level] = {
        count: (config.words || []).length,
        action: config.action || 'warn'
      };
    }
    return stats;
  }
}

module.exports = new SensitiveWordFilter();
