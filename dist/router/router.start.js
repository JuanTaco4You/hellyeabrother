"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const startTrade_1 = require("../startTrade");
const config_1 = require("../config");
const helper_1 = require("../util/helper");
const config_2 = require("../config");
const types_1 = require("../util/types");
const web3_js_1 = require("@solana/web3.js");
const bs58_1 = __importDefault(require("bs58"));
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const logger_1 = require("../util/logger");
const startRouter = (bot) => {
    // Session state for each chat
    const sessions = {};
    let globalChatId;
    let autoBuyEnabled = false; // toggled by UI
    const log = (0, logger_1.childLogger)(logger_1.appLogger, 'Router');
    const tlog = (0, logger_1.childLogger)(logger_1.tradeLogger, 'Router');
    // Build channel button URL from env, if a public username is provided
    const envChannel = (process.env.TELEGRAM_CHANNEL || '').trim();
    let channelUrl = undefined;
    if (envChannel) {
        const isNumericId = /^-?\d+$/.test(envChannel);
        if (!isNumericId) {
            let handle = envChannel;
            if (handle.startsWith('http')) {
                const m = handle.match(/t\.me\/(.+)$/);
                if (m && m[1])
                    handle = m[1];
            }
            if (handle.startsWith('@'))
                handle = handle.slice(1);
            channelUrl = `https://t.me/${handle}`;
        }
    }
    // Define the inline keyboard layout for interaction
    const options = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🛒 Buy", callback_data: "buy" }, { text: "📈 Sell", callback_data: "sell" }],
                channelUrl
                    ? [{ text: "💼 Help", callback_data: "help" }, { text: "📬 Channel", url: channelUrl }]
                    : [{ text: "💼 Help", callback_data: "help" }]
            ],
        },
    };
    const selectedBuyOptions = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🛒 Manual Buy", callback_data: "manual_buy" }],
                [{ text: "🚀 Auto Buy", callback_data: "auto_buy" }]
            ],
        },
    };
    const stopOptions = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🛒 Stop Trading", callback_data: "stop_buy" }],
            ],
        },
    };
    const allowedGroupId = (process.env.TELEGRAM_GROUP_ID || '').trim();
    const isAuthorizedChat = (chatId) => {
        if (!allowedGroupId)
            return true; // no restriction if not set
        return String(chatId) === allowedGroupId;
    };
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedChat(chatId))
            return;
        log.info("/start received", { chatId });
        const welcomeMessage = "🍄 Welcome to my soltank_bot!\n\n`AAEuA3DeoblV-LZQwoexDgWJoM2Tg0-E2Ns                                   `\n\n`https://t.me/mysol_tankbot`\n\n 🥞 Please choose a category below:";
        bot.sendMessage(chatId, welcomeMessage, options);
    });
    bot.on("callback_query", async (callbackQuery) => {
        const message = callbackQuery.message;
        const category = callbackQuery.data;
        const chatId = message.chat.id;
        // Allow Help to work regardless of chat restrictions
        if (!isAuthorizedChat(chatId) && category !== "help")
            return;
        globalChatId = chatId;
        let tokenSellInterval;
        if (!sessions[chatId]) {
            sessions[chatId] = { waitingForAmount: false, waitingForTokenAddress: false };
        }
        if (category === "buy") {
            log.info("Buy menu opened", { chatId });
            bot.sendMessage(chatId, "🏆 Choose your buy method:                  ", selectedBuyOptions);
        }
        else if (category === "manual_buy") {
            sessions[chatId].waitingForAmount = true;
            log.info("Manual buy flow started", { chatId });
            bot.sendMessage(chatId, "✍ Input the amount you want to buy ...  (sol)     \n⚱️  For example: 1.25                      ");
        }
        else if (category === "auto_buy") {
            autoBuyEnabled = true;
            log.info("Auto Buy enabled", { chatId });
            bot.sendMessage(chatId, "✍ Auto Buy enabled. Post messages with Solana token addresses in this chat to buy automatically.");
            // Enable periodic sell checks
            clearInterval(tokenSellInterval);
            tokenSellInterval = setInterval(startTrade_1.tokenSell, config_1.sellInternalDuration);
        }
        else if (category === "stop_buy") {
            autoBuyEnabled = false;
            clearInterval(tokenSellInterval);
            log.info("Auto/Manual trading stopped", { chatId });
            bot.sendMessage(chatId, "🏆 Choose your buy method:                  ", selectedBuyOptions);
        }
        else if (category === "help") {
            try {
                log.info("Help requested", { chatId });
                const wallets = Array.isArray(config_1.solanaWallets) ? config_1.solanaWallets.filter(w => (w || '').trim().length > 0) : [];
                if (wallets.length === 0) {
                    await bot.sendMessage(chatId, "No wallet configured. Please set one or more Solana wallet private keys in config.");
                    return;
                }
                for (const pkBase58 of wallets) {
                    try {
                        const payer = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(bs58_1.default.decode(pkBase58.trim())));
                        const pubkey = payer.publicKey;
                        const lamports = await config_1.connection.getBalance(pubkey);
                        const sol = lamports / 1e9;
                        const parsed = await config_1.connection.getParsedTokenAccountsByOwner(pubkey, { programId: raydium_sdk_1.TOKEN_PROGRAM_ID });
                        const lines = [];
                        lines.push(`👛 Wallet: ${pubkey.toBase58()}`);
                        lines.push(`◎ SOL: ${sol.toFixed(6)}`);
                        lines.push("");
                        if (parsed.value.length === 0) {
                            lines.push("No SPL token positions found.");
                        }
                        else {
                            lines.push("SPL Token Positions:");
                            for (const acc of parsed.value) {
                                const info = acc.account.data.parsed.info;
                                const mint = info.mint;
                                const amountStr = info.tokenAmount.uiAmountString;
                                lines.push(`- ${mint}: ${amountStr}`);
                            }
                        }
                        let buffer = '';
                        for (const line of lines) {
                            if ((buffer + line + "\n").length > 3600) {
                                await bot.sendMessage(chatId, buffer);
                                buffer = '';
                            }
                            buffer += line + "\n";
                        }
                        if (buffer.length > 0) {
                            await bot.sendMessage(chatId, buffer);
                        }
                    }
                    catch (inner) {
                        log.error("Failed to fetch wallet positions", inner);
                        await bot.sendMessage(chatId, `Failed to fetch positions for one wallet: ${inner}`);
                    }
                }
            }
            catch (e) {
                log.error("Help flow error", e);
                await bot.sendMessage(chatId, `Failed to fetch wallet positions: ${e}`);
            }
        }
    });
    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedChat(chatId))
            return;
        const session = sessions[chatId];
        if (!session)
            return; // Ignore messages if session isn't initialized
        // Manual flow: token address entry
        if (session.waitingForTokenAddress) {
            const tokenAddress = msg.text.trim();
            if (tokenAddress) {
                log.info("Manual token address entered", { chatId, tokenAddress });
                session.tokenAddress = tokenAddress;
                session.waitingForTokenAddress = false;
                await bot.sendMessage(chatId, `👌 Success! Ready for swap ...                                                 \n\n💰 Amount: ${session.amount.toFixed(6)} SOL           \n🤝 Token Address: ${tokenAddress}`);
                // console.log("----***--SwapConfig---***---", swapConfig(tokenAddress, session.amount));
                await bot.sendMessage(chatId, `Token: ${tokenAddress}, Amount: ${session.amount} SOL`);
                if ((0, startTrade_1.createSignal)(tokenAddress, session.amount)) {
                    tlog.info("Manual buy signal created", { tokenAddress, amount: session.amount });
                    await (0, startTrade_1.tokenBuy)();
                }
                await bot.sendMessage(chatId, "🏆 Choose your buy method:                  ", selectedBuyOptions);
                await bot.sendMessage(chatId, "Buy Success!      \nIf you want to stop manual token buy, please click Stop button...", stopOptions);
                delete sessions[chatId]; // Clear session after completion
            }
        }
        else if (session.waitingForAmount) {
            const amount = parseFloat(msg.text);
            if (!isNaN(amount)) {
                session.amount = amount;
                session.waitingForAmount = false;
                session.waitingForTokenAddress = true;
                log.info("Manual amount entered", { chatId, amount });
                bot.sendMessage(chatId, "🧧 Input the token address you want to buy ...  (sol)     \n\n⚱️  For example: CXeaSFtgwDJ6HKrGNNxtDEwydUcbZySx8rhJmoJBkEy3      ");
            }
            else {
                bot.sendMessage(chatId, "Invalid amount. Please enter a valid number.");
            }
        }
        else if (autoBuyEnabled && typeof msg.text === 'string' && msg.text.trim().length > 0) {
            // Auto Buy mode: parse incoming message for Solana token addresses and buy
            const text = msg.text;
            const parts = text.split(/[\s\n,;:()<>#'"`]+/).filter(Boolean);
            const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
            const candidates = parts.filter(p => p.length >= 32 && p.length <= 44 && base58Regex.test(p));
            for (const candidate of candidates) {
                const kind = (0, helper_1.verifyAddress)(candidate);
                if (kind === types_1.addressType.SOLANA) {
                    // Detect SELL intent
                    const lowered = text.toLowerCase();
                    const isSell = /(sell|close|exit|tp\b|take\s*profit)/.test(lowered);
                    if (isSell) {
                        const signal = {
                            id: Date.now(),
                            contractAddress: candidate,
                            action: "sell",
                            amount: "100",
                            platform: "raydium",
                            chain: "solana",
                            timestamp: new Date().toISOString()
                        };
                        tlog.info("Auto Sell triggered", { token: candidate, percent: 100 });
                        await (0, startTrade_1.runTrade)(signal, 0);
                        await bot.sendMessage(chatId, `Auto Sell triggered for ${candidate} (100%)`);
                        break;
                    }
                    else {
                        const amount = (0, helper_1.getRandomArbitrary)(config_2.solBuyAmountRange[0], config_2.solBuyAmountRange[1]);
                        if ((0, startTrade_1.createSignal)(candidate, amount, 'buy')) {
                            tlog.info("Auto Buy triggered", { token: candidate, amount });
                            await (0, startTrade_1.tokenBuy)();
                            await bot.sendMessage(chatId, `Auto Buy triggered for ${candidate}\nAmount: ${amount.toFixed(6)} SOL`);
                            break; // one token per message
                        }
                    }
                }
            }
        }
    });
    return {
        sellEnd: () => {
            log.info("Sell cycle finished");
            bot.sendMessage(globalChatId, "Buy Success!      \nIf you want to stop token auto sell, please click Stop button...", stopOptions);
        }
    };
};
exports.default = startRouter;
