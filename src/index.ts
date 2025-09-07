const TelegramBot = require("node-telegram-bot-api");

import bot from "./bot"
import router from './router';
import { initSignalState } from './util/signalState';
import { appLogger, childLogger } from './util/logger';

(async () => {
  const log = childLogger(appLogger, 'Bootstrap');
  try {
    await initSignalState();
    log.info('Signal state ready');
  } catch (e) {
    log.error('Signal state init failed', e);
  }
  log.info('Starting Telegram bot router');
  router(bot);
})();




