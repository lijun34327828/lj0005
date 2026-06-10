class LocalStorage {
  constructor(prefix = 'translator_') {
    this.prefix = prefix;
    this.historyKey = this.prefix + 'history';
    this.settingsKey = this.prefix + 'settings';
    this.draftKey = this.prefix + 'draft';
    this.maxHistoryItems = 500;
  }

  getHistory() {
    try {
      const raw = localStorage.getItem(this.historyKey);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error('读取历史记录失败:', err);
      return [];
    }
  }

  saveHistory(history) {
    try {
      if (history.length > this.maxHistoryItems) {
        history = history.slice(0, this.maxHistoryItems);
      }
      localStorage.setItem(this.historyKey, JSON.stringify(history));
    } catch (err) {
      console.error('保存历史记录失败:', err);
    }
  }

  addHistoryItem(item) {
    const history = this.getHistory();
    const existingIndex = history.findIndex(h => h.id === item.id);
    
    if (existingIndex !== -1) {
      history.splice(existingIndex, 1);
    }
    
    history.unshift(item);
    this.saveHistory(history);
    return item;
  }

  getHistoryItem(id) {
    const history = this.getHistory();
    return history.find(h => h.id === id) || null;
  }

  deleteHistoryItem(id) {
    const history = this.getHistory();
    const filtered = history.filter(h => h.id !== id);
    this.saveHistory(filtered);
    return filtered.length;
  }

  clearHistory() {
    localStorage.removeItem(this.historyKey);
  }

  searchHistory(keyword) {
    const history = this.getHistory();
    if (!keyword || !keyword.trim()) return history;
    
    const kw = keyword.toLowerCase().trim();
    return history.filter(h => 
      (h.sourceText && h.sourceText.toLowerCase().includes(kw)) ||
      (h.targetText && h.targetText.toLowerCase().includes(kw))
    );
  }

  getHistoryPage(page, pageSize, keyword = '') {
    let history = keyword ? this.searchHistory(keyword) : this.getHistory();
    const total = history.length;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const items = history.slice(startIndex, endIndex);
    
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      hasMore: endIndex < total
    };
  }

  getSettings() {
    try {
      const raw = localStorage.getItem(this.settingsKey);
      return raw ? JSON.parse(raw) : {
        sourceLang: 'auto',
        targetLang: 'zh',
        autoDetect: true
      };
    } catch (err) {
      return { sourceLang: 'auto', targetLang: 'zh', autoDetect: true };
    }
  }

  saveSettings(settings) {
    try {
      const current = this.getSettings();
      localStorage.setItem(this.settingsKey, JSON.stringify({ ...current, ...settings }));
    } catch (err) {
      console.error('保存设置失败:', err);
    }
  }

  saveDraft(text) {
    try {
      localStorage.setItem(this.draftKey, JSON.stringify({
        text,
        timestamp: Date.now()
      }));
    } catch (err) {
      console.error('保存草稿失败:', err);
    }
  }

  getDraft() {
    try {
      const raw = localStorage.getItem(this.draftKey);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      if (Date.now() - draft.timestamp > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(this.draftKey);
        return null;
      }
      return draft;
    } catch (err) {
      return null;
    }
  }

  clearDraft() {
    localStorage.removeItem(this.draftKey);
  }
}

const storage = new LocalStorage();
