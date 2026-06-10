const logger = require('../logger');
const { getConfig } = require('../config');

class RateLimiter {
  constructor() {
    this.clients = new Map();
    this.enabled = true;
  }

  init(options = {}) {
    this.windowMs = options.windowMs || getConfig('rateLimit.windowMs') || 60000;
    this.maxRequests = options.maxRequests || getConfig('rateLimit.maxRequests') || 30;
    this.message = options.message || getConfig('rateLimit.message') || '请求过于频繁';
    this.enabled = options.enabled !== undefined 
      ? options.enabled 
      : (getConfig('rateLimit.enabled') !== false);
  }

  getClientKey(req) {
    return req.ip || 
           req.headers['x-forwarded-for'] || 
           req.connection?.remoteAddress || 
           'unknown';
  }

  middleware(options = {}) {
    this.init(options);
    
    return (req, res, next) => {
      if (!this.enabled) return next();
      
      const key = this.getClientKey(req);
      const now = Date.now();
      
      this.cleanupOldRequests(now);
      
      if (!this.clients.has(key)) {
        this.clients.set(key, []);
      }
      
      const requests = this.clients.get(key);
      const recentRequests = requests.filter(time => now - time < this.windowMs);
      
      if (recentRequests.length >= this.maxRequests) {
        const oldestTime = recentRequests[0];
        const retryAfter = Math.ceil((this.windowMs - (now - oldestTime)) / 1000);
        
        logger.warn(`限流触发，IP: ${key}, 请求数: ${recentRequests.length}`);
        
        res.setHeader('X-RateLimit-Limit', this.maxRequests);
        res.setHeader('X-RateLimit-Remaining', 0);
        res.setHeader('X-RateLimit-Reset', Math.ceil((now + this.windowMs) / 1000));
        res.setHeader('Retry-After', retryAfter);
        
        res.status(429).json({
          error: 'rate_limit_exceeded',
          message: this.message,
          retryAfter
        });
        return;
      }
      
      requests.push(now);
      this.clients.set(key, recentRequests.concat([now]));
      
      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', this.maxRequests - recentRequests.length - 1);
      
      next();
    };
  }

  cleanupOldRequests(now) {
    for (const [key, requests] of this.clients) {
      const recent = requests.filter(time => now - time < this.windowMs);
      if (recent.length === 0) {
        this.clients.delete(key);
      } else if (recent.length !== requests.length) {
        this.clients.set(key, recent);
      }
    }
  }

  getStats() {
    const stats = {
      totalClients: this.clients.size,
      clients: []
    };
    
    const now = Date.now();
    for (const [key, requests] of this.clients) {
      const recent = requests.filter(time => now - time < this.windowMs);
      stats.clients.push({
        ip: key,
        requestCount: recent.length
      });
    }
    
    return stats;
  }

  reset(key) {
    this.clients.delete(key);
  }
}

module.exports = new RateLimiter();
