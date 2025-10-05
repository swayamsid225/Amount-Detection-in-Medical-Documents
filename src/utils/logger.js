const config = require('../config/config');

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const COLORS = {
  error: '\x1b[31m', // Red
  warn: '\x1b[33m',  // Yellow
  info: '\x1b[36m',  // Cyan
  debug: '\x1b[90m', // Gray
  reset: '\x1b[0m'
};

class Logger {
  constructor() {
    this.level = LOG_LEVELS[config.logLevel] || LOG_LEVELS.info;
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const color = COLORS[level];
    const reset = COLORS.reset;
    const levelStr = level.toUpperCase().padEnd(5);
    
    let formattedMessage = `${color}[${timestamp}] ${levelStr}${reset} ${message}`;
    
    if (args.length > 0) {
      formattedMessage += ' ' + args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
      ).join(' ');
    }
    
    return formattedMessage;
  }

  error(message, ...args) {
    if (this.level >= LOG_LEVELS.error) {
      console.error(this.formatMessage('error', message, ...args));
    }
  }

  warn(message, ...args) {
    if (this.level >= LOG_LEVELS.warn) {
      console.warn(this.formatMessage('warn', message, ...args));
    }
  }

  info(message, ...args) {
    if (this.level >= LOG_LEVELS.info) {
      console.log(this.formatMessage('info', message, ...args));
    }
  }

  debug(message, ...args) {
    if (this.level >= LOG_LEVELS.debug) {
      console.log(this.formatMessage('debug', message, ...args));
    }
  }
}

module.exports = new Logger();