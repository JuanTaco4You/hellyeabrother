"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const TelegramBot = require("node-telegram-bot-api");
const bot_1 = __importDefault(require("./bot"));
const router_1 = __importDefault(require("./router"));
(() => {
    (0, router_1.default)(bot_1.default);
})();
