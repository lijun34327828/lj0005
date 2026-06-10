const logger = require('../logger');

class TranslationEngine {
  constructor(name, options = {}) {
    this.name = name;
    this.timeoutMs = options.timeoutMs || 5000;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.circuitBreakerThreshold = options.circuitBreakerThreshold || 5;
    this.recoveryTimeMs = options.recoveryTimeMs || 30000;
  }

  isAvailable() {
    if (this.failureCount >= this.circuitBreakerThreshold) {
      const now = Date.now();
      if (now - this.lastFailureTime < this.recoveryTimeMs) {
        return false;
      }
      this.failureCount = Math.floor(this.failureCount / 2);
    }
    return true;
  }

  recordSuccess() {
    this.failureCount = Math.max(0, this.failureCount - 1);
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    logger.warn(`翻译引擎 ${this.name} 失败，失败次数: ${this.failureCount}`);
  }

  async translate(text, sourceLang, targetLang) {
    throw new Error('子类必须实现 translate 方法');
  }
}

class MockPrimaryEngine extends TranslationEngine {
  constructor() {
    super('mock-primary', { timeoutMs: 3000 });
  }

  async translate(text, sourceLang, targetLang) {
    return new Promise((resolve, reject) => {
      const delay = 200 + Math.random() * 300;
      
      setTimeout(() => {
        if (Math.random() < 0.1) {
          reject(new Error('主引擎模拟故障'));
          return;
        }
        
        const translated = this.mockTranslate(text, sourceLang, targetLang);
        resolve({
          text: translated,
          engine: this.name,
          sourceLang: sourceLang || 'auto',
          targetLang
        });
      }, delay);
    });
  }

  mockTranslate(text, sourceLang, targetLang) {
    if (targetLang === 'zh') {
      return '[译] ' + text.split('').map(char => {
        if (/[a-zA-Z]/.test(char)) return char;
        return char;
      }).join('') + ' [译文已生成]';
    } else {
      return '[Translated] ' + text + ' [translation done]';
    }
  }
}

class MockSecondaryEngine extends TranslationEngine {
  constructor() {
    super('mock-secondary', { timeoutMs: 4000 });
  }

  async translate(text, sourceLang, targetLang) {
    return new Promise((resolve, reject) => {
      const delay = 300 + Math.random() * 400;
      
      setTimeout(() => {
        if (Math.random() < 0.15) {
          reject(new Error('备用引擎模拟故障'));
          return;
        }
        
        resolve({
          text: `[备用引擎译] ${text} [alt]`,
          engine: this.name,
          sourceLang: sourceLang || 'auto',
          targetLang
        });
      }, delay);
    });
  }
}

class MockFallbackEngine extends TranslationEngine {
  constructor() {
    super('mock-fallback', { timeoutMs: 5000 });
  }

  async translate(text, sourceLang, targetLang) {
    return new Promise((resolve) => {
      const delay = 500 + Math.random() * 500;
      
      setTimeout(() => {
        resolve({
          text: `[兜底译] ${text} [fallback]`,
          engine: this.name,
          sourceLang: sourceLang || 'auto',
          targetLang
        });
      }, delay);
    });
  }
}

class TranslationEngineManager {
  constructor(engineNames = []) {
    this.engines = [];
    this.initEngines(engineNames);
  }

  initEngines(engineNames) {
    const engineMap = {
      'mock-primary': MockPrimaryEngine,
      'mock-secondary': MockSecondaryEngine,
      'mock-fallback': MockFallbackEngine
    };

    for (const name of engineNames) {
      const EngineClass = engineMap[name];
      if (EngineClass) {
        this.engines.push(new EngineClass());
      }
    }

    if (this.engines.length === 0) {
      this.engines.push(new MockFallbackEngine());
    }
  }

  async translateWithFallback(text, sourceLang, targetLang) {
    const errors = [];
    
    for (const engine of this.engines) {
      if (!engine.isAvailable()) {
        logger.debug(`跳过不可用引擎: ${engine.name}`);
        continue;
      }

      try {
        logger.debug(`尝试使用引擎: ${engine.name}`);
        const result = await this.withTimeout(
          engine.translate(text, sourceLang, targetLang),
          engine.timeoutMs
        );
        engine.recordSuccess();
        logger.info(`翻译成功，引擎: ${engine.name}`);
        return result;
      } catch (err) {
        engine.recordFailure();
        errors.push({ engine: engine.name, error: err.message });
        logger.warn(`引擎 ${engine.name} 翻译失败: ${err.message}`);
      }
    }

    throw new Error(`所有翻译引擎均失败: ${JSON.stringify(errors)}`);
  }

  withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('翻译超时'));
      }, timeoutMs);

      promise
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  getEngineStatus() {
    return this.engines.map(engine => ({
      name: engine.name,
      available: engine.isAvailable(),
      failureCount: engine.failureCount
    }));
  }
}

module.exports = {
  TranslationEngine,
  TranslationEngineManager,
  MockPrimaryEngine,
  MockSecondaryEngine,
  MockFallbackEngine
};
