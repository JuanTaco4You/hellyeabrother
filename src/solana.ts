import { Connection, clusterApiUrl } from '@solana/web3.js';
import TelegramBot from 'node-telegram-bot-api';

// A development connection for potential utilities (not required elsewhere)
export const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');

// Helper to respond to a callback query. Call this where you handle callbacks.
export function respondToCallback(bot: TelegramBot, callbackQuery: any, category: string) {
  bot.answerCallbackQuery(callbackQuery.id, {
    text: `You pressed ${category}`,
    show_alert: true,
  });
}
