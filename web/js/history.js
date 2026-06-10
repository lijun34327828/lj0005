class HistoryManager {
  constructor() {
    this.currentPage = 1;
    this.pageSize = 10;
    this.keyword = '';
    this.syncing = false;
    this.serverHistory = [];
  }

  async addRecord(record) {
    storage.addHistoryItem(record);

    try {
      await this.syncToServer(record);
    } catch (err) {
      console.warn('同步历史记录到服务端失败:', err);
    }
  }

  async syncToServer(record) {
    try {
      const response = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.data;
      }
    } catch (err) {
      console.warn('同步到服务器失败:', err);
    }
    return null;
  }

  getLocalHistory(page, pageSize, keyword = '') {
    return storage.getHistoryPage(page, pageSize, keyword);
  }

  async getServerHistory(page, pageSize, keyword = '') {
    try {
      const params = new URLSearchParams({
        page,
        pageSize,
        keyword
      });
      
      const response = await fetch(`/api/history?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        return data.data;
      }
    } catch (err) {
      console.warn('获取服务端历史记录失败:', err);
    }
    return null;
  }

  async getMergedHistory(page, pageSize, keyword = '') {
    const localResult = this.getLocalHistory(page, pageSize, keyword);
    
    try {
      const serverResult = await this.getServerHistory(page, pageSize, keyword);
      if (serverResult) {
        return this.mergeHistoryResults(localResult, serverResult);
      }
    } catch (err) {
      console.warn('使用本地历史记录:', err);
    }
    
    return localResult;
  }

  mergeHistoryResults(localResult, serverResult) {
    const allItems = [...localResult.items, ...serverResult.items];
    const uniqueMap = new Map();
    
    for (const item of allItems) {
      if (item.id && !uniqueMap.has(item.id)) {
        uniqueMap.set(item.id, item);
      }
    }
    
    const merged = Array.from(uniqueMap.values())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    
    const total = Math.max(localResult.total, serverResult.total, merged.length);
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    const items = merged.slice(startIndex, endIndex);
    
    return {
      items,
      total,
      page: this.currentPage,
      pageSize: this.pageSize,
      totalPages: Math.ceil(total / this.pageSize),
      hasMore: endIndex < total
    };
  }

  async deleteRecord(id) {
    const localCount = storage.deleteHistoryItem(id);
    
    try {
      await fetch(`/api/history/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.warn('删除服务端记录失败:', err);
    }
    
    return localCount;
  }

  async clearAll() {
    storage.clearHistory();
    
    try {
      await fetch('/api/history', { method: 'DELETE' });
    } catch (err) {
      console.warn('清空服务端历史失败:', err);
    }
  }

  async getRecordById(id) {
    const localRecord = storage.getHistoryItem(id);
    
    if (localRecord) {
      return localRecord;
    }
    
    try {
      const response = await fetch(`/api/history/${id}`);
      if (response.ok) {
        const data = await response.json();
        return data.data;
      }
    } catch (err) {
      console.warn('获取服务端记录失败:', err);
    }
    
    return null;
  }

  setPage(page) {
    this.currentPage = page;
  }

  setKeyword(keyword) {
    this.keyword = keyword;
    this.currentPage = 1;
  }

  setPageSize(size) {
    this.pageSize = size;
    this.currentPage = 1;
  }
}

const historyManager = new HistoryManager();
