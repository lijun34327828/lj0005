const fs = require('fs');
const path = require('path');
const { getConfig } = require('../config');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

class Logger {
  constructor() {
    this.logDir = LOG_DIR;
    this.currentLogFile = null;
    this.currentDate = null;
    this.ensureLogDir();
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  getLogFileName() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    return `translate-${dateStr}.log`;
  }

  getCurrentLogPath() {
    return path.join(this.logDir, this.getLogFileName());
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 
      ? ' ' + JSON.stringify(meta) 
      : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}\n`;
  }

  log(level, message, meta = {}) {
    const configLevel = getConfig('log.level') || 'info';
    if (LOG_LEVELS[level] < LOG_LEVELS[configLevel]) return;

    const logMsg = this.formatMessage(level, message, meta);
    
    process.stdout.write(logMsg);

    try {
      const logPath = this.getCurrentLogPath();
      fs.appendFileSync(logPath, logMsg, 'utf-8');
      this.cleanupOldLogs();
    } catch (err) {
      console.error('写入日志文件失败:', err.message);
    }
  }

  cleanupOldLogs() {
    try {
      const maxFiles = getConfig('log.maxFiles') || 10;
      const files = fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('translate-') && f.endsWith('.log'))
        .sort()
        .reverse();

      if (files.length > maxFiles) {
        files.slice(maxFiles).forEach(file => {
          fs.unlinkSync(path.join(this.logDir, file));
        });
      }
    } catch (err) {
      console.error('清理旧日志失败:', err.message);
    }
  }

  debug(message, meta) {
    this.log('debug', message, meta);
  }

  info(message, meta) {
    this.log('info', message, meta);
  }

  warn(message, meta) {
    this.log('warn', message, meta);
  }

  error(message, meta) {
    this.log('error', message, meta);
  }
}

module.exports = new Logger();
