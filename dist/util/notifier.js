"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifySwapResult = exports.notify = exports.setCurrentChat = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const bot_1 = __importDefault(require("../bot"));
const logger_1 = require("./logger");
let currentChatId;
const setCurrentChat = (chatId) => {
    currentChatId = chatId;
};
exports.setCurrentChat = setCurrentChat;
const notify = async (text) => {
    try {
        if (currentChatId !== undefined) {
            await bot_1.default.sendMessage(currentChatId, text);
        }
    }
    catch (e) {
        (0, logger_1.childLogger)(logger_1.appLogger, 'Notify').error('Failed to send Telegram message', e);
    }
};
exports.notify = notify;
const notifySwapResult = async (params) => {
    const { action, token, amount, success, txid, error, simulated } = params;
    const status = success ? (simulated ? 'Simulation OK' : 'Swap Succeeded') : (simulated ? 'Simulation Failed' : 'Swap Failed');
    const lines = [
        `🧭 ${status}`,
        `🎯 Action: ${action.toUpperCase()}`,
        `🤝 Token: ${token}`,
    ];
    if (amount !== undefined)
        lines.push(`💰 Amount: ${amount} SOL`);
    if (txid)
        lines.push(`🔗 https://solscan.io/tx/${txid}`);
    if (!success && error)
        lines.push(`⚠️ ${String(error?.message || error)}`);
    await (0, exports.notify)(lines.join("\n"));
};
exports.notifySwapResult = notifySwapResult;
