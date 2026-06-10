const express = require('express');
const cors = require('cors');
const path = require('path');
const logger = require('./logger');
const { getConfig } = require('./config');

const translateRouter = require('./routes/translate');
const historyRouter = require('./routes/history');
const sensitiveRouter = require('./routes/sensitive');

const app = express();
const config = getConfig();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  logger.info(`${req.method} ${req.originalUrl}`, { ip: req.ip });
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.debug(`${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`);
  });
  
  next();
});

app.use('/api/translate', translateRouter);
app.use('/api/history', historyRouter);
app.use('/api/sensitive', sensitiveRouter);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

app.use(express.static(path.join(__dirname, '..', '..', 'web')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'web', 'index.html'));
});

app.use((err, req, res, next) => {
  logger.error('服务器错误:', err.message);
  res.status(500).json({
    error: 'internal_error',
    message: err.message
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'not_found',
    message: '接口不存在'
  });
});

const PORT = config.port || 8635;
const HOST = config.host || '0.0.0.0';

app.listen(PORT, HOST, () => {
  logger.info(`翻译服务启动成功`);
  logger.info(`服务地址: http://${HOST}:${PORT}`);
  logger.info(`管理界面: http://${HOST}:${PORT}/`);
});

process.on('SIGINT', () => {
  logger.info('收到关闭信号，正在退出...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger.error('未捕获异常:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的 Promise 拒绝:', reason);
});

module.exports = app;
