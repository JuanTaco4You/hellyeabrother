"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const TelegramBot = require("node-telegram-bot-api");
const bot_1 = __importDefault(require("./bot"));
const router_1 = __importDefault(require("./router"));
const logger_1 = require("./util/logger");
(() => {
    const log = (0, logger_1.childLogger)(logger_1.appLogger, 'Bootstrap');
    log.info('Starting Telegram bot router');
    (0, router_1.default)(bot_1.default);
})();
