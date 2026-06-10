const logger = require('../logger');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const dictionary = require('../utils/dictionary');

function cleanTranslationTags(text) {
  if (!text || typeof text !== 'string') return text;
  let cleaned = text;
  cleaned = cleaned.replace(/\[\s*(?:TRANSLAT\w*|译|翻译)\s*\]\s*/gi, '');
  cleaned = cleaned.replace(/MYMEMORY\b.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/PLEASE\s+SELECT\b.*?(?:\n|$)/gi, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

class TranslationEngine {
  constructor(name, options = {}) {
    this.name = name;
    this.timeoutMs = options.timeoutMs || 10000;
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

class LibreTranslateEngine extends TranslationEngine {
  constructor() {
    super('libretranslate', { timeoutMs: 15000, circuitBreakerThreshold: 5 });
    this.endpoints = [
      'https://libretranslate.de',
      'https://translate.argosopentech.com',
      'https://translate.terraprint.co'
    ];
    this.currentEndpointIndex = 0;
  }

  langMap(lang) {
    const map = {
      'zh': 'zh',
      'zh-CN': 'zh',
      'zh-TW': 'zh',
      'en': 'en',
      'ja': 'ja',
      'ko': 'ko',
      'fr': 'fr',
      'de': 'de',
      'es': 'es',
      'ru': 'ru',
      'pt': 'pt',
      'it': 'it',
      'ar': 'ar',
      'hi': 'hi',
      'auto': 'auto'
    };
    return map[lang] || lang;
  }

  async translate(text, sourceLang, targetLang) {
    const sl = this.langMap(sourceLang || 'auto');
    const tl = this.langMap(targetLang || 'zh');

    if (sl === tl && sl !== 'auto') {
      return {
        text: text,
        engine: this.name,
        sourceLang: sourceLang || 'auto',
        targetLang: targetLang || 'zh'
      };
    }

    for (let i = 0; i < this.endpoints.length; i++) {
      const endpointIndex = (this.currentEndpointIndex + i) % this.endpoints.length;
      const endpoint = this.endpoints[endpointIndex];

      try {
        const result = await this._translateWithEndpoint(
          endpoint, text, sl, tl, sourceLang, targetLang
        );
        this.currentEndpointIndex = endpointIndex;
        return result;
      } catch (err) {
        logger.debug(`LibreTranslate 端点 ${endpoint} 失败: ${err.message}`);
      }
    }

    throw new Error('所有 LibreTranslate 端点均失败');
  }

  _translateWithEndpoint(endpoint, text, sl, tl, originalSourceLang, originalTargetLang) {
    return new Promise((resolve, reject) => {
      try {
        const postData = JSON.stringify({
          q: text,
          source: sl,
          target: tl,
          format: 'text'
        });

        const parsedUrl = new URL(`${endpoint}/translate`);

        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || 443,
          path: parsedUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              if (res.statusCode === 403 || res.statusCode === 429) {
                reject(new Error(`LibreTranslate 限流 (${res.statusCode})`));
                return;
              }
              if (res.statusCode !== 200) {
                reject(new Error(`LibreTranslate HTTP ${res.statusCode}`));
                return;
              }
              const result = JSON.parse(data);
              if (result.error) {
                reject(new Error(`LibreTranslate 错误: ${result.error}`));
                return;
              }
              const translatedText = result.translatedText;
              if (!translatedText || !translatedText.trim()) {
                reject(new Error('LibreTranslate 返回空译文'));
                return;
              }
              resolve({
                text: cleanTranslationTags(translatedText),
                engine: this.name,
                sourceLang: originalSourceLang || 'auto',
                targetLang: originalTargetLang || 'zh'
              });
            } catch (err) {
              reject(new Error(`解析 LibreTranslate 响应失败: ${err.message}`));
            }
          });
        });

        req.setTimeout(this.timeoutMs, () => {
          req.destroy();
          reject(new Error('LibreTranslate 请求超时'));
        });

        req.on('error', (err) => {
          reject(new Error(`LibreTranslate 网络错误: ${err.message}`));
        });

        req.write(postData);
        req.end();
      } catch (err) {
        reject(new Error(`LibreTranslate 失败: ${err.message}`));
      }
    });
  }
}

class GoogleTranslateEngine extends TranslationEngine {
  constructor() {
    super('google', { timeoutMs: 15000, circuitBreakerThreshold: 8 });
  }

  langMap(lang) {
    const map = {
      'zh': 'zh-CN',
      'zh-CN': 'zh-CN',
      'zh-TW': 'zh-TW',
      'en': 'en',
      'ja': 'ja',
      'ko': 'ko',
      'fr': 'fr',
      'de': 'de',
      'es': 'es',
      'ru': 'ru',
      'pt': 'pt',
      'it': 'it',
      'ar': 'ar',
      'hi': 'hi',
      'auto': 'auto'
    };
    return map[lang] || lang;
  }

  async translate(text, sourceLang, targetLang) {
    const sl = this.langMap(sourceLang || 'auto');
    const tl = this.langMap(targetLang || 'zh');

    if (sl === tl) {
      return {
        text: text,
        engine: this.name,
        sourceLang: sourceLang || 'auto',
        targetLang: targetLang || 'zh'
      };
    }

    return new Promise((resolve, reject) => {
      try {
        const params = new URLSearchParams({
          client: 'gtx',
          sl: sl,
          tl: tl,
          dt: 't',
          q: text
        });

        const urlStr = `https://translate.googleapis.com/translate_a/single?${params.toString()}`;
        const parsedUrl = new URL(urlStr);

        const options = {
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        };

        const req = https.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                reject(new Error(`Google Translate HTTP ${res.statusCode}`));
                return;
              }

              const result = JSON.parse(data);

              if (!Array.isArray(result) || !Array.isArray(result[0])) {
                reject(new Error('Google Translate 返回格式异常'));
                return;
              }

              let translatedText = '';
              for (const segment of result[0]) {
                if (Array.isArray(segment) && typeof segment[0] === 'string') {
                  translatedText += segment[0];
                }
              }

              if (!translatedText.trim()) {
                reject(new Error('Google Translate 返回空译文'));
                return;
              }

              const detectedSource = result[2] || sourceLang || 'auto';

              resolve({
                text: cleanTranslationTags(translatedText),
                engine: this.name,
                sourceLang: detectedSource,
                targetLang: targetLang || 'zh'
              });
            } catch (err) {
              reject(new Error(`解析 Google 响应失败: ${err.message}`));
            }
          });
        });

        req.setTimeout(this.timeoutMs, () => {
          req.destroy();
          reject(new Error('Google Translate 请求超时'));
        });

        req.on('error', (err) => {
          reject(new Error(`Google Translate 网络错误: ${err.message}`));
        });

        req.end();
      } catch (err) {
        reject(new Error(`Google Translate 失败: ${err.message}`));
      }
    });
  }
}

class MyMemoryEngine extends TranslationEngine {
  constructor() {
    super('mymemory', { timeoutMs: 10000, circuitBreakerThreshold: 5 });
    this.baseUrl = 'https://api.mymemory.translated.net/get';
  }

  langMap(lang) {
    const map = {
      'zh': 'zh-CN',
      'zh-CN': 'zh-CN',
      'zh-TW': 'zh-TW',
      'en': 'en',
      'ja': 'ja',
      'ko': 'ko',
      'fr': 'fr',
      'de': 'de',
      'es': 'es',
      'ru': 'ru',
      'pt': 'pt',
      'it': 'it',
      'ar': 'ar',
      'hi': 'hi',
      'auto': 'autodetect'
    };
    return map[lang] || lang;
  }

  cleanMyMemoryText(text) {
    let cleaned = text;
    cleaned = cleaned.replace(/\[\s*TRANSLAT\w*\s*\]\s*/gi, '');
    cleaned = cleaned.replace(/\[\s*译\s*\]\s*/g, '');
    cleaned = cleaned.replace(/\[\s*翻译\s*\]\s*/g, '');
    cleaned = cleaned.replace(/MYMEMORY\s*(?:WARNING|WARN).*?(?:\n|$)/gi, '');
    cleaned = cleaned.replace(/PLEASE\s*(?:SELECT|CHOOSE).*?(?:\n|$)/gi, '');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
  }

  async translate(text, sourceLang, targetLang) {
    return new Promise((resolve, reject) => {
      try {
        const source = this.langMap(sourceLang || 'auto');
        const target = this.langMap(targetLang || 'zh');

        if (source === target) {
          resolve({
            text: text,
            engine: this.name,
            sourceLang: sourceLang || 'auto',
            targetLang: targetLang || 'zh'
          });
          return;
        }

        const params = new URLSearchParams({
          q: text,
          langpair: `${source}|${target}`
        });

        const url = `${this.baseUrl}?${params.toString()}`;
        const parsedUrl = new URL(url);

        const options = {
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers: {
            'User-Agent': 'SmartTranslator/1.0'
          }
        };

        const req = https.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                reject(new Error(`MyMemory HTTP ${res.statusCode}`));
                return;
              }

              const result = JSON.parse(data);
              if (result.responseStatus === 200 && result.responseData) {
                let translatedText = result.responseData.translatedText;
                translatedText = this.cleanMyMemoryText(translatedText);
                translatedText = cleanTranslationTags(translatedText);

                if (!translatedText.trim()) {
                  reject(new Error('MyMemory 返回空译文'));
                  return;
                }

                resolve({
                  text: translatedText,
                  engine: this.name,
                  sourceLang: sourceLang || 'auto',
                  targetLang: targetLang || 'zh'
                });
              } else {
                reject(new Error(`MyMemory 错误: ${result.responseDetails || result.responseStatus}`));
              }
            } catch (err) {
              reject(new Error(`解析 MyMemory 响应失败: ${err.message}`));
            }
          });
        });

        req.setTimeout(this.timeoutMs, () => {
          req.destroy();
          reject(new Error('MyMemory 请求超时'));
        });

        req.on('error', (err) => {
          reject(new Error(`MyMemory 网络错误: ${err.message}`));
        });

        req.end();
      } catch (err) {
        reject(new Error(`MyMemory 失败: ${err.message}`));
      }
    });
  }
}

class DictionaryEngine extends TranslationEngine {
  constructor() {
    super('dictionary', { timeoutMs: 5000, circuitBreakerThreshold: 999 });
  }

  async translate(text, sourceLang, targetLang) {
    const translatedText = dictionary.translateText(text, sourceLang, targetLang);
    return {
      text: cleanTranslationTags(translatedText),
      engine: this.name,
      sourceLang: sourceLang || 'auto',
      targetLang: targetLang || 'zh'
    };
  }
}

class TranslationEngineManager {
  constructor(engineNames = []) {
    this.engines = [];
    this.initEngines(engineNames);
  }

  initEngines(engineNames) {
    const engineMap = {
      'libretranslate': LibreTranslateEngine,
      'google': GoogleTranslateEngine,
      'mymemory': MyMemoryEngine,
      'dictionary': DictionaryEngine
    };

    for (const name of engineNames) {
      const EngineClass = engineMap[name];
      if (EngineClass) {
        this.engines.push(new EngineClass());
      }
    }

    if (this.engines.length === 0) {
      this.engines.push(new LibreTranslateEngine());
      this.engines.push(new GoogleTranslateEngine());
      this.engines.push(new MyMemoryEngine());
      this.engines.push(new DictionaryEngine());
    }

    const hasDictionary = this.engines.some(e => e.name === 'dictionary');
    if (!hasDictionary) {
      this.engines.push(new DictionaryEngine());
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
  GoogleTranslateEngine,
  MyMemoryEngine,
  LibreTranslateEngine,
  DictionaryEngine,
  cleanTranslationTags
};
