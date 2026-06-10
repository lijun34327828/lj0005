const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'config.json');

let configCache = null;

function loadConfig() {
  if (configCache) return configCache;
  
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    configCache = JSON.parse(raw);
    return configCache;
  } catch (err) {
    console.error('加载配置文件失败:', err.message);
    throw err;
  }
}

function getConfig(key = null) {
  const config = loadConfig();
  if (!key) return config;
  
  const keys = key.split('.');
  let result = config;
  for (const k of keys) {
    if (result && typeof result === 'object' && k in result) {
      result = result[k];
    } else {
      return undefined;
    }
  }
  return result;
}

function reloadConfig() {
  configCache = null;
  return loadConfig();
}

module.exports = {
  getConfig,
  reloadConfig,
  loadConfig
};
