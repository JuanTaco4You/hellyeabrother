const TelegramBot = require("node-telegram-bot-api");

import bot from "./bot"
import router from './router';
import { appLogger, childLogger } from './util/logger';

(() => {
  const log = childLogger(appLogger, 'Bootstrap');
  log.info('Starting Telegram bot router');
  router(bot);
})();





