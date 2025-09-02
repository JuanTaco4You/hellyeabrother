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
const helper_1 = require("./util/helper");
const config_1 = require("./config");
const db_1 = require("./util/db");
const helper_2 = require("./util/helper");
const router_start_1 = __importDefault(require("./router/router.start"));
// needed types
const types_1 = require("./util/types");
const bot_1 = __importDefault(require("./bot"));
let telegram_signals = {};
let telegram_signals_list = [];
let totalCnt = 0;
const scrapeMessages = async () => {
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
            console.warn('TELEGRAM_CHANNEL appears to be a numeric chat ID. telegram-scraper expects a public channel username. Falling back to default.');
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
                console.log("$$$$$$$$$", recentMessage);
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
    const isAddress = (0, helper_1.verifyAddress)(tokenAddress);
    console.log("isAddress", isAddress);
    if (isAddress === types_1.addressType.SOLANA) {
        console.log("insert solana signal", tokenAddress);
        telegram_signals[totalCnt] = {
            id: totalCnt,
            contractAddress: tokenAddress,
            action: action,
            amount: action === 'buy' ? `${amount} SOL` : `${amount}`,
            platform: "raydium",
            chain: "solana",
            timestamp: new Date().toISOString(),
        };
        telegram_signals_list.push(totalCnt);
        totalCnt = totalCnt + 1;
        return true;
    }
    return false;
};
exports.createSignal = createSignal;
const tokenBuy = async () => {
    console.log("staring token buy");
    // while (telegram_signals_list && telegram_signals.length) {
    try {
        /**
         * Check if valid buy signals exist.
         */
        let telegram_signals_length = telegram_signals_list.length;
        console.log("telegram_signals_list", telegram_signals_list);
        console.log("current telegram signal length", telegram_signals_length);
        for (let i = 0; i < telegram_signals_length; i++) {
            await (0, exports.runTrade)(telegram_signals[telegram_signals_list[i]], i);
        }
        console.log("current signal finished!");
        if (db_1.buyActions.length > 0) {
            /**
             * Save successful buying signals to database.
             */
            console.log("buyActions", db_1.buyActions);
            const res = await (0, db_1.addBuy)();
            // Remove the signals bought in valid signal group;
            const elementToRemove = [];
            for (const buyAction of db_1.buyActions) {
                elementToRemove.push(buyAction.signalNumber);
                telegram_signals[telegram_signals_list[buyAction.signalNumber]] = null;
            }
            console.log("elementToKeep => ", elementToRemove);
            console.log("before buy telegram_signals_list => ", telegram_signals_list);
            telegram_signals_list = telegram_signals_list.filter((element, index) => !elementToRemove.includes(index));
            console.log("current telegram signal length in db", telegram_signals_list.length);
            console.log("after buy telegram_signals_list => ", telegram_signals_list);
            console.log("successfully saved buy siganls!");
            db_1.buyActions.length = 0;
        }
    }
    catch (err) {
        console.log("error", err);
    }
};
exports.tokenBuy = tokenBuy;
const tokenSell = async () => {
    console.log("starting token sell");
    /**
     * fetch sell siganls from database.
     */
    const buySolanaHistoryData = await (0, db_1.getSolanaBuys)();
    console.log("buySolanaHistoryData => ", buySolanaHistoryData);
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
        console.log("sellSignals", sellSignals);
        if (sellSignals.length > 0) {
            for (let i = 0; i < sellSignals.length; i++) {
                try {
                    await (0, exports.runTrade)(sellSignals[i], i);
                }
                catch (e) {
                    console.error("sell error", e);
                }
            }
            /**
             * Update successful sell signals in database.
             */
            if (db_1.sellActions.length > 0) {
                const res = await (0, db_1.updateSells)();
                console.log(res);
                db_1.sellActions.length = 0;
                (0, router_start_1.default)(bot_1.default).sellEnd();
            }
        }
    }
};
exports.tokenSell = tokenSell;
const runTrade = async (signal, signalNumber) => {
    try {
        console.log("raydium swap start!");
        await (0, raydium_1.default)(signal, signalNumber);
    }
    catch (e) {
        console.log("trading failed", e);
    }
};
exports.runTrade = runTrade;
