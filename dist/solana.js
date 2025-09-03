"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.respondToCallback = exports.connection = void 0;
const web3_js_1 = require("@solana/web3.js");
// A development connection for potential utilities (not required elsewhere)
exports.connection = new web3_js_1.Connection((0, web3_js_1.clusterApiUrl)('devnet'), 'confirmed');
// Helper to respond to a callback query. Call this where you handle callbacks.
function respondToCallback(bot, callbackQuery, category) {
    bot.answerCallbackQuery(callbackQuery.id, {
        text: `You pressed ${category}`,
        show_alert: true,
    });
}
exports.respondToCallback = respondToCallback;
