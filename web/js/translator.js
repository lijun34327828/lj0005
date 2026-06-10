class Translator {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl || window.location.origin;
    this.eventSource = null;
    this.isTranslating = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000;
    this.currentRecordId = null;
    this.pendingChunks = [];
    this.completedChunks = new Map();
    this.totalChunks = 0;
    this.currentSourceLang = 'auto';
    this.currentTargetLang = 'zh';
    this.currentSourceText = '';
    this.listeners = {};
    this.reconnecting = false;
    this.lostConnection = false;
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try {
          cb(data);
        } catch (err) {
          console.error(`事件监听器错误 [${event}]:`, err);
        }
      });
    }
  }

  async detectLanguage(text) {
    try {
      const response = await fetch(`${this.baseUrl}/api/translate/detect?text=${encodeURIComponent(text.substring(0, 500))}`);
      const data = await response.json();
      return data.data;
    } catch (err) {
      console.error('语种检测失败:', err);
      return { language: 'unknown', confidence: 0 };
    }
  }

  async startTranslate(text, sourceLang = 'auto', targetLang = 'zh', recordId = null) {
    if (this.isTranslating) {
      this.stopTranslate();
    }

    this.isTranslating = true;
    this.currentSourceText = text;
    this.currentSourceLang = sourceLang;
    this.currentTargetLang = targetLang;
    this.currentRecordId = recordId || this.generateId();
    this.pendingChunks = [];
    this.completedChunks.clear();
    this.totalChunks = 0;
    this.reconnectAttempts = 0;
    this.lostConnection = false;

    this.emit('start', { recordId: this.currentRecordId });

    await this.setupEventSource(text, sourceLang, targetLang);
  }

  async setupEventSource(text, sourceLang, targetLang) {
    const url = `${this.baseUrl}/api/translate/stream/translate`;
    const params = new URLSearchParams({
      text,
      sourceLang,
      targetLang,
      recordId: this.currentRecordId
    });

    const fullUrl = `${url}?${params.toString()}`;

    try {
      this.eventSource = new EventSource(fullUrl);

      this.eventSource.onopen = () => {
        console.log('SSE 连接已建立');
        if (this.reconnecting) {
          this.emit('reconnected', { attempt: this.reconnectAttempts });
          this.reconnecting = false;
          this.lostConnection = false;
          this.reconnectAttempts = 0;
        }
        this.emit('connected');
      };

      this.eventSource.addEventListener('chunk_start', (event) => {
        const data = JSON.parse(event.data);
        this.totalChunks = data.totalChunks;
        this.emit('chunk_start', data);
      });

      this.eventSource.addEventListener('chunk_complete', (event) => {
        const data = JSON.parse(event.data);
        this.completedChunks.set(data.chunkId, data);
        this.emit('chunk_complete', data);
        this.emit('progress', {
          progress: data.progress,
          completed: this.completedChunks.size,
          total: this.totalChunks
        });
      });

      this.eventSource.addEventListener('chunk_error', (event) => {
        const data = JSON.parse(event.data);
        this.emit('chunk_error', data);
      });

      this.eventSource.addEventListener('chunk_blocked', (event) => {
        const data = JSON.parse(event.data);
        this.emit('chunk_blocked', data);
      });

      this.eventSource.addEventListener('filter_warning', (event) => {
        const data = JSON.parse(event.data);
        this.emit('filter_warning', data);
      });

      this.eventSource.addEventListener('translation_blocked', (event) => {
        const data = JSON.parse(event.data);
        this.emit('translation_blocked', data);
      });

      this.eventSource.addEventListener('complete', (event) => {
        const data = JSON.parse(event.data);
        this.emit('complete', data);
      });

      this.eventSource.addEventListener('done', (event) => {
        const data = JSON.parse(event.data);
        this.emit('done', data);
        this.finishTranslation();
      });

      this.eventSource.addEventListener('error', (event) => {
        console.error('SSE 错误:', event);
        this.handleConnectionError();
      });

      this.eventSource.onerror = (error) => {
        console.error('SSE 连接错误:', error);
        this.handleConnectionError();
      };

    } catch (err) {
      console.error('建立 SSE 连接失败:', err);
      this.handleConnectionError();
    }
  }

  handleConnectionError() {
    if (!this.isTranslating) return;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnecting = true;
      this.lostConnection = true;
      this.reconnectAttempts++;
      
      this.emit('reconnecting', {
        attempt: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts
      });

      console.log(`尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      
      setTimeout(() => {
        if (this.isTranslating && this.lostConnection) {
          this.reconnectAndResume();
        }
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      this.emit('connection_lost', {
        message: '连接失败，已达到最大重连次数',
        completedCount: this.completedChunks.size
      });
      this.finishTranslation(true);
    }
  }

  async reconnectAndResume() {
    if (!this.isTranslating) return;

    try {
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }

      await this.setupEventSource(
        this.currentSourceText,
        this.currentSourceLang,
        this.currentTargetLang
      );
    } catch (err) {
      console.error('重连失败:', err);
      this.handleConnectionError();
    }
  }

  stopTranslate() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.isTranslating = false;
    this.reconnecting = false;
    this.lostConnection = false;
    this.emit('stopped');
  }

  finishTranslation(withError = false) {
    this.isTranslating = false;
    this.reconnecting = false;
    this.lostConnection = false;
    
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.emit('finished', { withError });
  }

  getFullTranslation() {
    const sortedChunks = Array.from(this.completedChunks.values())
      .sort((a, b) => a.chunkId - b.chunkId);
    
    return sortedChunks.map(c => c.translatedText).join(' ');
  }

  getProgress() {
    if (this.totalChunks === 0) return 0;
    return Math.round((this.completedChunks.size / this.totalChunks) * 100);
  }

  generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  checkConnection() {
    return fetch(`${this.baseUrl}/api/health`)
      .then(res => res.ok)
      .catch(() => false);
  }

  getTranslatedChunks() {
    return Array.from(this.completedChunks.values())
      .sort((a, b) => a.chunkId - b.chunkId);
  }
}

const translator = new Translator();
