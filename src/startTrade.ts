// public module
import { telegram_scraper } from 'telegram-scraper';
import dotenv from 'dotenv';
dotenv.config();

// private module
import raydiumToken from "./Raydium/raydium"
import jupiterToken from "./Jupiter/jupiter"

import {
  verifyAddress,
  getRandomArbitrary
}  from "./util/helper";

import {
  solBuyAmountRange
} from "./config";

import { 
  buyActions, 
  sellActions,
  addBuy,
  getSolanaBuys,
  updateSells,
} from './util/db';

import {
  convertAsSignal
} from "./util/helper"

import startRouter from './router/router.start';

// needed types
import { 
  signal,
  addressType,
  signalMap
} from "./util/types"

import bot from './bot';
import { appLogger, tradeLogger, childLogger } from './util/logger';
import { SWAP_ENGINE } from './config';
import { classifySignal } from './util/signalState';


let telegram_signals: signalMap = {};
let telegram_signals_list : number[]  = [];
let totalCnt: number = 0;


export const scrapeMessages = async () => {
  const log = childLogger(appLogger, 'Scraper');
  // Determine channel to scrape from env or fallback
  const envChannel = process.env.TELEGRAM_CHANNEL;
  let telegram_channel_username = 'Maestrosdegen';

  if (envChannel && envChannel.trim().length > 0) {
    const raw = envChannel.trim();
    // Accept forms: "username", "@username", "https://t.me/username"
    // Numeric chat IDs (e.g., "-100123..." or "-4798590389") are NOT supported by telegram-scraper
    // so we skip applying numeric values here.
    const isNumericId = /^-?\d+$/.test(raw);
    if (!isNumericId) {
      let candidate = raw;
      if (candidate.startsWith('http')) {
        const m = candidate.match(/t\.me\/(.+)$/);
        if (m && m[1]) candidate = m[1];
      }
      if (candidate.startsWith('@')) candidate = candidate.slice(1);
      telegram_channel_username = candidate;
    } else {
      log.warn('TELEGRAM_CHANNEL appears to be a numeric chat ID. telegram-scraper expects a public channel username. Falling back to default.');
    }
  }

  let result = JSON.parse(await telegram_scraper(telegram_channel_username));
  let recentMessage = result[result.length-1]["message_text"];
  let spaceNumber = recentMessage.split(" ").length - 1;
  let spacePosition = 0;
  let slashNumber = 0;
  let slashPosition = 0;

  while (spaceNumber > 0) {
    spacePosition = recentMessage.indexOf(" ");
    if (spacePosition >= 40) {
      recentMessage = recentMessage.slice(0, spacePosition + 1);
        break;
    } else {
      recentMessage = recentMessage.slice(spacePosition + 1);
    }
    
    if (recentMessage.search("/") >= 0) {
        slashNumber = recentMessage.split("/").length - 1;
        while (slashNumber >= 0) {
          slashPosition = recentMessage.indexOf("/");
          recentMessage = recentMessage.slice(slashPosition + 1);
          slashNumber--;
        }
    }
    if (recentMessage.includes("?")) {
      let questionNumber = recentMessage.split("?").length - 1;
      while (questionNumber > 0) {
        let questionPosition = recentMessage.indexOf("?");
        recentMessage = recentMessage.slice(0, questionPosition );
        log.debug("Trimmed message", { recentMessage });
        questionNumber--;
      }
    }

    spaceNumber--;
    const solAmount: number = getRandomArbitrary(solBuyAmountRange[0], solBuyAmountRange[1]);
    if (createSignal(recentMessage, solAmount)) {
      await tokenBuy();
    }
  }

}

export const createSignal = (tokenAddress: string, amount: number, action: 'buy' | 'sell' = 'buy' ): boolean => {
  const tlog = childLogger(tradeLogger, 'Signals');
  const isAddress = verifyAddress(tokenAddress);
  tlog.debug("verifyAddress", { tokenAddress, isAddress })
  if (isAddress === addressType.SOLANA) {
    const { kind, version } = classifySignal(tokenAddress, action);
    if (action === 'buy' && kind === 'update') {
      tlog.info("Skipping re-buy on update", { tokenAddress, version });
      return false;
    }
    tlog.info("Insert solana signal", { tokenAddress, amount, action, kind, version });
    telegram_signals[totalCnt] = {
      id: totalCnt,
      contractAddress: tokenAddress,
      action: action,
      amount: action === 'buy' ? `${amount} SOL` : `${amount}`,
      platform: "raydium",
      chain: "solana",
      timestamp: new Date().toISOString(),
      kind,
      version,
    } as signal;
    telegram_signals_list.push(totalCnt);
    totalCnt = totalCnt + 1;
    return true;
  }
  return false;
}
export const tokenBuy = async () => {
  const tlog = childLogger(tradeLogger, 'Buy');
  tlog.info("Starting token buy cycle");
    // while (telegram_signals_list && telegram_signals.length) {
  try {
    /**
     * Check if valid buy signals exist. 
     */
    let telegram_signals_length = telegram_signals_list.length;
    tlog.debug("Current signal state", { list: telegram_signals_list, length: telegram_signals_length });
    for (let i = 0; i < telegram_signals_length; i++) {
      await runTrade(telegram_signals[telegram_signals_list[i]] as signal, i);
    }
    tlog.info("Signal batch finished");
    if (buyActions.length > 0) {
      /**
       * Save successful buying signals to database.
       */
      tlog.info("Persisting buy actions", { count: buyActions.length });
      const res = await addBuy();
      
      // Remove the signals bought in valid signal group;
      const elementToRemove: number[] = [];
      for (const buyAction of buyActions) {
        elementToRemove.push(buyAction.signalNumber);
        telegram_signals[telegram_signals_list[buyAction.signalNumber]] = null;
      }

      tlog.debug("Elements removed", { elementToRemove, before: telegram_signals_list });

      telegram_signals_list = telegram_signals_list.filter((element, index) => !elementToRemove.includes(index));
      
      tlog.info("Signals updated after buy", { remaining: telegram_signals_list.length, after: telegram_signals_list });
      tlog.info("Successfully saved buy signals");

      buyActions.length = 0;
    }
  } catch (err) {
    const tlog = childLogger(tradeLogger, 'Buy');
    tlog.error("Buy cycle error", err);
  }
}

export const tokenSell = async () => {
  const tlog = childLogger(tradeLogger, 'Sell');
  tlog.info("Starting token sell cycle");
  /**
   * fetch sell siganls from database.
   */
  const buySolanaHistoryData: any = await getSolanaBuys();
  tlog.debug("Fetched buy history", { count: buySolanaHistoryData?.length });

  if (buySolanaHistoryData.length > 0) {
    let sellSolanaSignals: signal[] = [];
    /**
     * fetch valid EVM sell signals from EVM sell signal group. 
     */
    if (buySolanaHistoryData.length > 0) sellSolanaSignals = await convertAsSignal(buySolanaHistoryData, true);
    
    /**
     * configure all valid sell signals.
     */
    const sellSignals = [ ...sellSolanaSignals];
    tlog.info("Prepared sell signals", { count: sellSignals.length });
    if (sellSignals.length > 0) {
      for (let i = 0; i < sellSignals.length; i++) {
        try {
          await runTrade(sellSignals[i], i);
        }
        catch (e) {
          tlog.error("Sell execution error", e);
        }
      }
      /**
       * Update successful sell signals in database.
       */
      if (sellActions.length > 0) {
        const res = await updateSells();
        tlog.info("Updated sell records", { result: res });
        sellActions.length = 0;
        startRouter(bot).sellEnd();

      }
    }
  }
}


export const runTrade = async (signal: signal, signalNumber: number) => {
  try {
    const tlog = childLogger(tradeLogger, 'RunTrade');
    tlog.info("Swap start", { signal, signalNumber });
    if (SWAP_ENGINE === 'jupiter') {
      tlog.info("Using Jupiter swap engine");
      await jupiterToken(signal, signalNumber);
    } else if (SWAP_ENGINE === 'raydium') {
      tlog.info("Using Raydium swap engine");
      await raydiumToken(signal, signalNumber);
    } else {
      // Auto: try Jupiter then fall back to Raydium
      tlog.info("Using auto swap engine: Jupiter -> Raydium fallback");
      try {
        await jupiterToken(signal, signalNumber);
      } catch (err) {
        tlog.warn("Jupiter failed, falling back to Raydium", err);
        await raydiumToken(signal, signalNumber);
      }
    }
  } catch (e) {
    const tlog = childLogger(tradeLogger, 'RunTrade');
    tlog.error("Trading failed", e);
  }
}
