import dotenv from "dotenv";
dotenv.config();

import bot from "../bot";
import { appLogger, childLogger } from "./logger";

let currentChatId: number | undefined;

export const setCurrentChat = (chatId: number) => {
  currentChatId = chatId;
};

export const notify = async (text: string) => {
  try {
    if (currentChatId !== undefined) {
      await bot.sendMessage(currentChatId, text);
    }
  } catch (e) {
    childLogger(appLogger, 'Notify').error('Failed to send Telegram message', e);
  }
};

export const notifySwapResult = async (params: { action: 'buy' | 'sell', token: string, amount?: number, success: boolean, txid?: string, error?: any, simulated?: boolean }) => {
  const { action, token, amount, success, txid, error, simulated } = params;
  const status = success ? (simulated ? 'Simulation OK' : 'Swap Succeeded') : (simulated ? 'Simulation Failed' : 'Swap Failed');
  const lines = [
    `🧭 ${status}`,
    `🎯 Action: ${action.toUpperCase()}`,
    `🤝 Token: ${token}`,
  ];
  if (amount !== undefined) lines.push(`💰 Amount: ${amount} SOL`);
  if (txid) lines.push(`🔗 https://solscan.io/tx/${txid}`);
  if (!success && error) lines.push(`⚠️ ${String(error?.message || error)}`);
  await notify(lines.join("\n"));
};

