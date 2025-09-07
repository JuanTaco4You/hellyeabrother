"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTrade = exports.tokenSell = exports.tokenBuy = exports.createSignal = exports.scrapeMessages = void 0;
// public module
const telegram_scraper_1 = require("telegram-scraper");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// private module
const raydium_1 = __importDefault(require("./Raydium/raydium"));
const jupiter_1 = __importDefault(require("./Jupiter/jupiter"));
const helper_1 = require("./util/helper");
const config_1 = require("./config");
const db_1 = require("./util/db");
const helper_2 = require("./util/helper");
const router_start_1 = __importDefault(require("./router/router.start"));
// needed types
const types_1 = require("./util/types");
const bot_1 = __importDefault(require("./bot"));
const logger_1 = require("./util/logger");
const config_2 = require("./config");
const signalState_1 = require("./util/signalState");
let telegram_signals = {};
let telegram_signals_list = [];
let totalCnt = 0;
const scrapeMessages = async () => {
    const log = (0, logger_1.childLogger)(logger_1.appLogger, 'Scraper');
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
                if (m && m[1])
                    candidate = m[1];
            }
            if (candidate.startsWith('@'))
                candidate = candidate.slice(1);
            telegram_channel_username = candidate;
        }
        else {
            log.warn('TELEGRAM_CHANNEL appears to be a numeric chat ID. telegram-scraper expects a public channel username. Falling back to default.');
        }
    }
    let result = JSON.parse(await (0, telegram_scraper_1.telegram_scraper)(telegram_channel_username));
    let recentMessage = result[result.length - 1]["message_text"];
    let spaceNumber = recentMessage.split(" ").length - 1;
    let spacePosition = 0;
    let slashNumber = 0;
    let slashPosition = 0;
    while (spaceNumber > 0) {
        spacePosition = recentMessage.indexOf(" ");
        if (spacePosition >= 40) {
            recentMessage = recentMessage.slice(0, spacePosition + 1);
            break;
        }
        else {
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
                recentMessage = recentMessage.slice(0, questionPosition);
                log.debug("Trimmed message", { recentMessage });
                questionNumber--;
            }
        }
        spaceNumber--;
        const solAmount = (0, helper_1.getRandomArbitrary)(config_1.solBuyAmountRange[0], config_1.solBuyAmountRange[1]);
        if ((0, exports.createSignal)(recentMessage, solAmount)) {
            await (0, exports.tokenBuy)();
        }
    }
};
exports.scrapeMessages = scrapeMessages;
const createSignal = (tokenAddress, amount, action = 'buy') => {
    const tlog = (0, logger_1.childLogger)(logger_1.tradeLogger, 'Signals');
    const isAddress = (0, helper_1.verifyAddress)(tokenAddress);
    tlog.debug("verifyAddress", { tokenAddress, isAddress });
    if (isAddress === types_1.addressType.SOLANA) {
        const { kind, version } = (0, signalState_1.classifySignal)(tokenAddress, action);
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
        };
        telegram_signals_list.push(totalCnt);
        totalCnt = totalCnt + 1;
        return true;
    }
    return false;
};
exports.createSignal = createSignal;
const tokenBuy = async () => {
    const tlog = (0, logger_1.childLogger)(logger_1.tradeLogger, 'Buy');
    tlog.info("Starting token buy cycle");
    // while (telegram_signals_list && telegram_signals.length) {
    try {
        /**
         * Check if valid buy signals exist.
         */
        let telegram_signals_length = telegram_signals_list.length;
        tlog.debug("Current signal state", { list: telegram_signals_list, length: telegram_signals_length });
        for (let i = 0; i < telegram_signals_length; i++) {
            await (0, exports.runTrade)(telegram_signals[telegram_signals_list[i]], i);
        }
        tlog.info("Signal batch finished");
        if (db_1.buyActions.length > 0) {
            /**
             * Save successful buying signals to database.
             */
            tlog.info("Persisting buy actions", { count: db_1.buyActions.length });
            const res = await (0, db_1.addBuy)();
            // Remove the signals bought in valid signal group;
            const elementToRemove = [];
            for (const buyAction of db_1.buyActions) {
                elementToRemove.push(buyAction.signalNumber);
                telegram_signals[telegram_signals_list[buyAction.signalNumber]] = null;
            }
            tlog.debug("Elements removed", { elementToRemove, before: telegram_signals_list });
            telegram_signals_list = telegram_signals_list.filter((element, index) => !elementToRemove.includes(index));
            tlog.info("Signals updated after buy", { remaining: telegram_signals_list.length, after: telegram_signals_list });
            tlog.info("Successfully saved buy signals");
            db_1.buyActions.length = 0;
        }
    }
    catch (err) {
        const tlog = (0, logger_1.childLogger)(logger_1.tradeLogger, 'Buy');
        tlog.error("Buy cycle error", err);
    }
};
exports.tokenBuy = tokenBuy;
const tokenSell = async () => {
    const tlog = (0, logger_1.childLogger)(logger_1.tradeLogger, 'Sell');
    tlog.info("Starting token sell cycle");
    /**
     * fetch sell siganls from database.
     */
    const buySolanaHistoryData = await (0, db_1.getSolanaBuys)();
    tlog.debug("Fetched buy history", { count: buySolanaHistoryData?.length });
    if (buySolanaHistoryData.length > 0) {
        let sellSolanaSignals = [];
        /**
         * fetch valid EVM sell signals from EVM sell signal group.
         */
        if (buySolanaHistoryData.length > 0)
            sellSolanaSignals = await (0, helper_2.convertAsSignal)(buySolanaHistoryData, true);
        /**
         * configure all valid sell signals.
         */
        const sellSignals = [...sellSolanaSignals];
        tlog.info("Prepared sell signals", { count: sellSignals.length });
        if (sellSignals.length > 0) {
            for (let i = 0; i < sellSignals.length; i++) {
                try {
                    await (0, exports.runTrade)(sellSignals[i], i);
                }
                catch (e) {
                    tlog.error("Sell execution error", e);
                }
            }
            /**
             * Update successful sell signals in database.
             */
            if (db_1.sellActions.length > 0) {
                const res = await (0, db_1.updateSells)();
                tlog.info("Updated sell records", { result: res });
                db_1.sellActions.length = 0;
                (0, router_start_1.default)(bot_1.default).sellEnd();
            }
        }
    }
};
exports.tokenSell = tokenSell;
const runTrade = async (signal, signalNumber) => {
    try {
        const tlog = (0, logger_1.childLogger)(logger_1.tradeLogger, 'RunTrade');
        tlog.info("Swap start", { signal, signalNumber });
        if (config_2.SWAP_ENGINE === 'jupiter') {
            tlog.info("Using Jupiter swap engine");
            await (0, jupiter_1.default)(signal, signalNumber);
        }
        else if (config_2.SWAP_ENGINE === 'raydium') {
            tlog.info("Using Raydium swap engine");
            await (0, raydium_1.default)(signal, signalNumber);
        }
        else {
            // Auto: try Jupiter then fall back to Raydium
            tlog.info("Using auto swap engine: Jupiter -> Raydium fallback");
            try {
                await (0, jupiter_1.default)(signal, signalNumber);
            }
            catch (err) {
                tlog.warn("Jupiter failed, falling back to Raydium", err);
                await (0, raydium_1.default)(signal, signalNumber);
            }
        }
    }
    catch (e) {
        const tlog = (0, logger_1.childLogger)(logger_1.tradeLogger, 'RunTrade');
        tlog.error("Trading failed", e);
    }
};
exports.runTrade = runTrade;
