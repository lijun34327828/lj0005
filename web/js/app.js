class App {
  constructor() {
    this.elements = {};
    this.currentRecordId = null;
    this.isTranslating = false;
    this.warnings = [];
    this.formatInfo = { lineBreaks: 0, paragraphs: 0 };
  }

  init() {
    this.cacheElements();
    this.loadSettings();
    this.loadDraft();
    this.bindEvents();
    this.setupTranslatorEvents();
    this.checkConnection();
    this.startConnectionMonitor();
  }

  cacheElements() {
    this.elements = {
      sourceText: document.getElementById('sourceText'),
      targetLang: document.getElementById('targetLang'),
      sourceLang: document.getElementById('sourceLang'),
      btnSwap: document.getElementById('btnSwap'),
      btnTranslate: document.getElementById('btnTranslate'),
      btnTranslateText: document.getElementById('btnTranslateText'),
      btnClear: document.getElementById('btnClear'),
      btnCopy: document.getElementById('btnCopy'),
      btnStop: document.getElementById('btnStop'),
      btnHistory: document.getElementById('btnHistory'),
      btnCloseHistory: document.getElementById('btnCloseHistory'),
      btnClearHistory: document.getElementById('btnClearHistory'),
      resultPlaceholder: document.getElementById('resultPlaceholder'),
      resultContent: document.getElementById('resultContent'),
      resultContainer: document.getElementById('resultContainer'),
      progressContainer: document.getElementById('progressContainer'),
      progressBar: document.getElementById('progressBar'),
      progressText: document.getElementById('progressText'),
      charCount: document.getElementById('charCount'),
      detectedLang: document.getElementById('detectedLang'),
      translationInfo: document.getElementById('translationInfo'),
      warningsContainer: document.getElementById('warningsContainer'),
      historyModal: document.getElementById('historyModal'),
      historyList: document.getElementById('historyList'),
      historySearch: document.getElementById('historySearch'),
      pagination: document.getElementById('pagination'),
      connectionStatus: document.getElementById('connectionStatus'),
      toastContainer: document.getElementById('toastContainer')
    };
  }

  loadSettings() {
    const settings = storage.getSettings();
    if (settings.sourceLang) {
      this.elements.sourceLang.value = settings.sourceLang;
    }
    if (settings.targetLang) {
      this.elements.targetLang.value = settings.targetLang;
    }
  }

  saveSettings() {
    storage.saveSettings({
      sourceLang: this.elements.sourceLang.value,
      targetLang: this.elements.targetLang.value
    });
  }

  loadDraft() {
    const draft = storage.getDraft();
    if (draft && draft.text) {
      this.elements.sourceText.value = draft.text;
      this.updateCharCount();
      this.showToast('已恢复上次未完成的文本', 'info');
    }
  }

  bindEvents() {
    this.elements.sourceText.addEventListener('input', () => {
      this.updateCharCount();
      this.saveDraft();
      this.detectLanguageDebounced();
    });

    this.elements.sourceLang.addEventListener('change', () => {
      this.saveSettings();
    });

    this.elements.targetLang.addEventListener('change', () => {
      this.saveSettings();
    });

    this.elements.btnSwap.addEventListener('click', () => {
      this.swapLanguages();
    });

    this.elements.btnTranslate.addEventListener('click', () => {
      this.toggleTranslate();
    });

    this.elements.btnClear.addEventListener('click', () => {
      this.clearAll();
    });

    this.elements.btnCopy.addEventListener('click', () => {
      this.copyResult();
    });

    this.elements.btnStop.addEventListener('click', () => {
      this.stopTranslation();
    });

    this.elements.btnHistory.addEventListener('click', () => {
      this.openHistory();
    });

    this.elements.btnCloseHistory.addEventListener('click', () => {
      this.closeHistory();
    });

    this.elements.btnClearHistory.addEventListener('click', () => {
      this.clearHistory();
    });

    this.elements.historySearch.addEventListener('input', () => {
      this.searchHistoryDebounced();
    });

    this.elements.historyModal.addEventListener('click', (e) => {
      if (e.target === this.elements.historyModal) {
        this.closeHistory();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeHistory();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.toggleTranslate();
      }
    });
  }

  setupTranslatorEvents() {
    translator.on('start', (data) => {
      this.isTranslating = true;
      this.currentRecordId = data.recordId;
      this.showTranslatingState();
      this.warnings = [];
    });

    translator.on('chunk_start', (data) => {
      this.addChunkPlaceholder(data.chunkId, data.progress);
    });

    translator.on('chunk_complete', (data) => {
      this.updateChunk(data);
      this.updateProgress(data.progress);
      this.elements.btnCopy.disabled = false;
    });

    translator.on('chunk_error', (data) => {
      this.showChunkError(data);
    });

    translator.on('chunk_blocked', (data) => {
      this.showChunkBlocked(data);
    });

    translator.on('filter_warning', (data) => {
      this.addWarning(data);
    });

    translator.on('progress', (data) => {
      this.updateProgress(data.progress);
    });

    translator.on('complete', (data) => {
      this.elements.detectedLang.textContent = `源语言: ${data.sourceLang}`;
    });

    translator.on('done', (data) => {
      this.finishTranslation(data);
    });

    translator.on('stopped', () => {
      this.showStoppedState();
    });

    translator.on('finished', (data) => {
      this.isTranslating = false;
      if (data.withError) {
        this.showErrorState();
      }
    });

    translator.on('reconnecting', (data) => {
      this.updateConnectionStatus('reconnecting', `重连中 (${data.attempt}/${data.maxAttempts})`);
    });

    translator.on('reconnected', () => {
      this.updateConnectionStatus('online', '已连接');
      this.showToast('连接已恢复', 'success');
    });

    translator.on('connection_lost', (data) => {
      this.updateConnectionStatus('offline', '连接断开');
      this.showToast(`连接断开，已完成 ${data.completedCount} 个片段`, 'error');
      this.savePartialResult();
    });
  }

  updateCharCount() {
    const count = this.elements.sourceText.value.length;
    this.elements.charCount.textContent = count.toLocaleString();
  }

  saveDraft() {
    storage.saveDraft(this.elements.sourceText.value);
  }

  detectLanguageDebounced() {
    if (this._detectTimeout) {
      clearTimeout(this._detectTimeout);
    }
    
    this._detectTimeout = setTimeout(() => {
      this.detectLanguage();
    }, 500);
  }

  async detectLanguage() {
    const text = this.elements.sourceText.value;
    if (!text || text.length < 10) {
      this.elements.detectedLang.textContent = '';
      return;
    }

    if (this.elements.sourceLang.value !== 'auto') {
      return;
    }

    try {
      const result = await translator.detectLanguage(text);
      if (result.language !== 'unknown') {
        const langNames = {
          zh: '中文',
          en: '英语',
          ja: '日语',
          ko: '韩语',
          fr: '法语',
          de: '德语',
          es: '西班牙语'
        };
        const name = langNames[result.language] || result.language;
        const confidence = Math.round(result.confidence * 100);
        this.elements.detectedLang.textContent = `检测到: ${name} (${confidence}%)`;
      }
    } catch (err) {
      console.warn('语种检测失败:', err);
    }
  }

  swapLanguages() {
    const sourceVal = this.elements.sourceLang.value;
    const targetVal = this.elements.targetLang.value;
    
    if (sourceVal === 'auto') {
      this.showToast('自动检测无法作为目标语言', 'warning');
      return;
    }
    
    this.elements.sourceLang.value = targetVal;
    this.elements.targetLang.value = sourceVal;
    this.saveSettings();
    
    const sourceText = this.elements.sourceText.value;
    const resultText = translator.getFullTranslation();
    
    if (resultText) {
      this.elements.sourceText.value = resultText;
      this.elements.resultContent.innerHTML = '';
      this.elements.resultPlaceholder.style.display = 'flex';
      this.elements.resultContent.style.display = 'none';
      this.updateCharCount();
      this.saveDraft();
    }
  }

  toggleTranslate() {
    if (this.isTranslating) {
      this.stopTranslation();
    } else {
      this.startTranslation();
    }
  }

  startTranslation() {
    const text = this.elements.sourceText.value.trim();
    
    if (!text) {
      this.showToast('请输入要翻译的文本', 'warning');
      return;
    }

    const sourceLang = this.elements.sourceLang.value;
    const targetLang = this.elements.targetLang.value;

    this.formatInfo = {
      lineBreaks: (text.match(/\n/g) || []).length,
      paragraphs: text.split(/\n\s*\n/).length
    };

    translator.startTranslate(text, sourceLang, targetLang);
  }

  stopTranslation() {
    translator.stopTranslate();
    this.showToast('翻译已停止', 'info');
  }

  showTranslatingState() {
    this.elements.btnTranslateText.textContent = '翻译中...';
    this.elements.btnStop.style.display = 'inline-flex';
    this.elements.sourceText.disabled = true;
    this.elements.progressContainer.style.display = 'block';
    this.elements.resultPlaceholder.style.display = 'none';
    this.elements.resultContent.style.display = 'block';
    this.elements.resultContent.innerHTML = '';
    this.elements.warningsContainer.style.display = 'none';
    this.elements.translationInfo.textContent = '';
    this.updateProgress(0);
  }

  showStoppedState() {
    this.isTranslating = false;
    this.elements.btnTranslateText.textContent = '重新翻译';
    this.elements.btnStop.style.display = 'none';
    this.elements.sourceText.disabled = false;
    this.savePartialResult();
  }

  showErrorState() {
    this.elements.btnTranslateText.textContent = '重新翻译';
    this.elements.btnStop.style.display = 'none';
    this.elements.sourceText.disabled = false;
    this.savePartialResult();
  }

  addChunkPlaceholder(chunkId, progress) {
    const chunkEl = document.createElement('div');
    chunkEl.className = 'chunk-item translating';
    chunkEl.id = `chunk-${chunkId}`;
    chunkEl.innerHTML = `
      <div class="chunk-translated">
        <span style="opacity: 0.5;">正在翻译...</span>
      </div>
    `;
    this.elements.resultContent.appendChild(chunkEl);
    this.scrollToBottom();
  }

  updateChunk(data) {
    const chunkEl = document.getElementById(`chunk-${data.chunkId}`);
    if (!chunkEl) return;

    chunkEl.className = 'chunk-item completed';
    
    let metaHtml = '';
    if (data.engine) {
      metaHtml += `<span class="chunk-engine">⚙ ${data.engine}</span>`;
    }
    if (data.fromCache) {
      metaHtml += `<span class="chunk-cached">⚡ 缓存</span>`;
    }
    
    chunkEl.innerHTML = `
      ${data.filtered ? '<div class="chunk-warning">⚠ 内容已过滤</div>' : ''}
      <div class="chunk-translated">${this.escapeHtml(data.translatedText)}</div>
      ${metaHtml ? `<div class="chunk-meta">${metaHtml}</div>` : ''}
    `;

    this.scrollToBottom();
  }

  showChunkError(data) {
    const chunkEl = document.getElementById(`chunk-${data.chunkId}`);
    if (!chunkEl) return;

    chunkEl.className = 'chunk-item error';
    chunkEl.innerHTML = `
      <div class="chunk-translated">
        ❌ 翻译失败: ${this.escapeHtml(data.error)}
      </div>
      <div class="chunk-original">原文: ${this.escapeHtml(data.originalText)}</div>
    `;
  }

  showChunkBlocked(data) {
    const chunkEl = document.getElementById(`chunk-${data.chunkId}`);
    if (!chunkEl) return;

    chunkEl.className = 'chunk-item blocked';
    chunkEl.innerHTML = `
      <div class="chunk-translated">
        ⚠ ${this.escapeHtml(data.reason || '内容包含违禁词，已拦截')}
      </div>
    `;
  }

  addWarning(data) {
    if (data.warnings && data.warnings.length > 0) {
      this.warnings.push(...data.warnings);
    }
    if (data.maskedWords && data.maskedWords.length > 0) {
      this.warnings.push(...data.maskedWords.map(w => `已屏蔽: ${w}`));
    }
    this.updateWarnings();
  }

  updateWarnings() {
    if (this.warnings.length === 0) {
      this.elements.warningsContainer.style.display = 'none';
      return;
    }

    const uniqueWarnings = [...new Set(this.warnings)];
    this.elements.warningsContainer.style.display = 'block';
    this.elements.warningsContainer.innerHTML = uniqueWarnings
      .map(w => `<div class="warning-item"><span class="warning-icon">⚠</span><span>${this.escapeHtml(w)}</span></div>`)
      .join('');
  }

  updateProgress(progress) {
    this.elements.progressBar.style.width = `${progress}%`;
    this.elements.progressText.textContent = `${progress}%`;
  }

  finishTranslation(data) {
    this.isTranslating = false;
    this.elements.btnTranslateText.textContent = '重新翻译';
    this.elements.btnStop.style.display = 'none';
    this.elements.sourceText.disabled = false;
    this.elements.progressContainer.style.display = 'none';

    if (data.engine) {
      this.elements.translationInfo.textContent = `翻译引擎: ${data.engine}`;
    }

    const record = {
      id: this.currentRecordId,
      sourceText: this.elements.sourceText.value,
      targetText: translator.getFullTranslation(),
      sourceLang: this.elements.sourceLang.value,
      targetLang: this.elements.targetLang.value,
      engine: data.engine,
      createdAt: Date.now()
    };

    historyManager.addRecord(record);
    storage.clearDraft();

    this.showToast('翻译完成', 'success');
  }

  savePartialResult() {
    const translatedText = translator.getFullTranslation();
    if (translatedText && this.currentRecordId) {
      const record = {
        id: this.currentRecordId,
        sourceText: this.elements.sourceText.value,
        targetText: translatedText,
        sourceLang: this.elements.sourceLang.value,
        targetLang: this.elements.targetLang.value,
        engine: 'partial',
        createdAt: Date.now(),
        partial: true
      };
      historyManager.addRecord(record);
    }
  }

  clearAll() {
    this.elements.sourceText.value = '';
    this.elements.resultContent.innerHTML = '';
    this.elements.resultPlaceholder.style.display = 'flex';
    this.elements.resultContent.style.display = 'none';
    this.elements.warningsContainer.style.display = 'none';
    this.elements.detectedLang.textContent = '';
    this.elements.translationInfo.textContent = '';
    this.elements.progressContainer.style.display = 'none';
    this.elements.btnCopy.disabled = true;
    this.updateCharCount();
    storage.clearDraft();
    this.warnings = [];
  }

  async copyResult() {
    const text = translator.getFullTranslation();
    if (!text) {
      this.showToast('没有可复制的内容', 'warning');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      this.showToast('已复制到剪贴板', 'success');
    } catch (err) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      this.showToast('已复制到剪贴板', 'success');
    }
  }

  scrollToBottom() {
    const container = this.elements.resultContainer;
    container.scrollTop = container.scrollHeight;
  }

  async openHistory() {
    this.elements.historyModal.style.display = 'flex';
    historyManager.setPage(1);
    historyManager.setKeyword('');
    this.elements.historySearch.value = '';
    await this.loadHistory();
  }

  closeHistory() {
    this.elements.historyModal.style.display = 'none';
  }

  searchHistoryDebounced() {
    if (this._searchTimeout) {
      clearTimeout(this._searchTimeout);
    }
    this._searchTimeout = setTimeout(() => {
      historyManager.setKeyword(this.elements.historySearch.value);
      this.loadHistory();
    }, 300);
  }

  async loadHistory() {
    const result = await historyManager.getMergedHistory(
      historyManager.currentPage,
      historyManager.pageSize,
      historyManager.keyword
    );

    this.renderHistoryList(result.items);
    this.renderPagination(result);
  }

  renderHistoryList(items) {
    if (items.length === 0) {
      this.elements.historyList.innerHTML = `
        <div class="history-item-empty">
          暂无历史记录
        </div>
      `;
      return;
    }

    this.elements.historyList.innerHTML = items.map(item => {
      const date = new Date(item.createdAt || Date.now());
      const dateStr = date.toLocaleString('zh-CN');
      const sourcePreview = this.truncateText(item.sourceText, 100);
      
      return `
        <div class="history-item" data-id="${item.id}">
          <div class="history-item-header">
            <span class="history-lang">${item.sourceLang || 'auto'} → ${item.targetLang || 'zh'}</span>
            <span class="history-date">${dateStr}</span>
          </div>
          <div class="history-text">${this.escapeHtml(sourcePreview)}</div>
        </div>
      `;
    }).join('');

    this.elements.historyList.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        this.loadHistoryItem(id);
      });
    });
  }

  renderPagination(result) {
    if (result.totalPages <= 1) {
      this.elements.pagination.innerHTML = '';
      return;
    }

    let html = `<span class="pagination-info">共 ${result.total} 条</span>`;
    
    html += `<button ${result.page <= 1 ? 'disabled' : ''} data-page="prev">上一页</button>`;
    
    const maxVisible = 5;
    let startPage = Math.max(1, result.page - Math.floor(maxVisible / 2));
    let endPage = Math.min(result.totalPages, startPage + maxVisible - 1);
    
    if (endPage - startPage < maxVisible - 1) {
      startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
      html += `<button class="${i === result.page ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    
    html += `<button ${result.page >= result.totalPages ? 'disabled' : ''} data-page="next">下一页</button>`;
    
    this.elements.pagination.innerHTML = html;

    this.elements.pagination.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.getAttribute('data-page');
        if (page === 'prev') {
          historyManager.setPage(result.page - 1);
        } else if (page === 'next') {
          historyManager.setPage(result.page + 1);
        } else {
          historyManager.setPage(parseInt(page, 10));
        }
        this.loadHistory();
      });
    });
  }

  async loadHistoryItem(id) {
    const record = await historyManager.getRecordById(id);
    if (record) {
      this.elements.sourceText.value = record.sourceText || '';
      this.elements.sourceLang.value = record.sourceLang || 'auto';
      this.elements.targetLang.value = record.targetLang || 'zh';
      
      if (record.targetText) {
        this.elements.resultPlaceholder.style.display = 'none';
        this.elements.resultContent.style.display = 'block';
        this.elements.resultContent.innerHTML = `
          <div class="chunk-item completed">
            <div class="chunk-translated">${this.escapeHtml(record.targetText)}</div>
          </div>
        `;
        this.elements.btnCopy.disabled = false;
        
        translator.completedChunks.set(0, {
          chunkId: 0,
          translatedText: record.targetText
        });
      }
      
      this.updateCharCount();
      this.closeHistory();
      this.showToast('已加载历史记录', 'info');
    }
  }

  async clearHistory() {
    if (!confirm('确定要清空所有历史记录吗？')) return;
    
    await historyManager.clearAll();
    await this.loadHistory();
    this.showToast('历史记录已清空', 'success');
  }

  async checkConnection() {
    const isOnline = await translator.checkConnection();
    this.updateConnectionStatus(isOnline ? 'online' : 'offline', isOnline ? '已连接' : '已断开');
  }

  startConnectionMonitor() {
    setInterval(() => {
      if (!this.isTranslating) {
        this.checkConnection();
      }
    }, 30000);
  }

  updateConnectionStatus(status, text) {
    const statusEl = this.elements.connectionStatus;
    statusEl.className = `connection-status ${status}`;
    statusEl.querySelector('.status-text').textContent = text;
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };
    
    toast.innerHTML = `
      <span>${icons[type] || 'ℹ'}</span>
      <span>${this.escapeHtml(message)}</span>
    `;
    
    this.elements.toastContainer.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('hide');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3000);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  truncateText(text, maxLen) {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + '...';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
  window.app = app;
});
