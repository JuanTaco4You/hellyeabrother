"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const startTrade_1 = require("../startTrade");
const db_1 = require("../util/db");
const helper_1 = require("../util/helper");
const config_1 = require("../config");
const helper_2 = require("../util/helper");
const config_2 = require("../config");
const types_1 = require("../util/types");
const web3_js_1 = require("@solana/web3.js");
const bs58_1 = __importDefault(require("bs58"));
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const logger_1 = require("../util/logger");
const startRouter = (bot) => {
    // Session state for each chat
    const sessions = {};
    // Dashboard state per chat
    // Use NodeJS.Timeout (or ReturnType<typeof setInterval>) for Node compatibility
    const dashboards = {};
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
                [{ text: "▶️ Execute Buy Cycle", callback_data: "exec_buy_cycle" }, { text: "⏩ Execute Sell Cycle", callback_data: "exec_sell_cycle" }],
                [{ text: "📊 Live Dashboard", callback_data: "live_dashboard" }],
                [{ text: "🧹 Clear DB Buys", callback_data: "clear_db_buys" }, { text: "🧹 Clear Non-held Buys", callback_data: "clear_nonheld_buys" }],
                [{ text: "⚙️ Set Min Balance", callback_data: "set_min_balance" }],
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
    const selectedSellOptions = {
        reply_markup: {
            inline_keyboard: [
                [{ text: "📈 Manual Sell", callback_data: "manual_sell" }],
                [{ text: "⏩ Execute Sell Cycle", callback_data: "exec_sell_cycle" }]
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
        let walletAddress = "No wallet configured";
        try {
            const wallets = Array.isArray(config_1.solanaWallets)
                ? config_1.solanaWallets.filter(w => (w || '').trim().length > 0)
                : [];
            if (wallets.length > 0) {
                const payer = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(bs58_1.default.decode(wallets[0].trim())));
                walletAddress = payer.publicKey.toBase58();
            }
        }
        catch (_) { }
        const welcomeMessage = `Welcome to the Savage Bot\n\n${walletAddress}\n\nPlease pick an option below`;
        bot.sendMessage(chatId, welcomeMessage, options);
    });
    bot.on("callback_query", async (callbackQuery) => {
        var _a, _b;
        const message = callbackQuery.message;
        const category = callbackQuery.data;
        const chatId = message.chat.id;
        // Allow Help to work regardless of chat restrictions
        if (!isAuthorizedChat(chatId) && category !== "help")
            return;
        globalChatId = chatId;
        let tokenSellInterval;
        if (!sessions[chatId]) {
            sessions[chatId] = { waitingForAmount: false, waitingForTokenAddress: false, minBalance: 0 };
        }
        if (category === "buy") {
            log.info("Buy menu opened", { chatId });
            bot.sendMessage(chatId, "🏆 Choose your buy method:                  ", selectedBuyOptions);
        }
        else if (category === "sell") {
            log.info("Sell menu opened", { chatId });
            bot.sendMessage(chatId, "📈 Choose your sell method:", selectedSellOptions);
        }
        else if (category === "manual_buy") {
            sessions[chatId].waitingForAmount = true;
            sessions[chatId].mode = 'manual_buy';
            log.info("Manual buy flow started", { chatId });
            bot.sendMessage(chatId, "✍ Input the amount you want to buy ...  (sol)     \n⚱️  For example: 1.25                      ");
        }
        else if (category === "manual_sell") {
            sessions[chatId].waitingForSellPercent = true;
            sessions[chatId].mode = 'manual_sell';
            log.info("Manual sell flow started", { chatId });
            bot.sendMessage(chatId, "✍ Input the percent you want to sell ... (e.g., 50 or 100)");
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
        else if (category === "exec_buy_cycle") {
            log.info("Execute buy cycle triggered", { chatId });
            await bot.sendMessage(chatId, "Starting buy cycle...\nThis processes queued buy signals.");
            await (0, startTrade_1.tokenBuy)();
            await bot.sendMessage(chatId, "Buy cycle completed.");
        }
        else if (category === "exec_sell_cycle") {
            log.info("Execute sell cycle triggered", { chatId });
            await bot.sendMessage(chatId, "Starting sell cycle...\nThis processes eligible sells from DB.");
            await (0, startTrade_1.tokenSell)();
            await bot.sendMessage(chatId, "Sell cycle completed.");
        }
        else if (category === "live_dashboard") {
            try {
                // Start or toggle the live dashboard
                if ((_a = dashboards[chatId]) === null || _a === void 0 ? void 0 : _a.interval) {
                    clearInterval(dashboards[chatId].interval);
                }
                const sent = await bot.sendMessage(chatId, "📊 Initializing live dashboard...", {
                    reply_markup: {
                        inline_keyboard: [[{ text: "🛑 Stop Dashboard", callback_data: "stop_dashboard" }]]
                    }
                });
                const messageId = sent.message_id;
                const render = async () => {
                    var _a;
                    try {
                        // Load wallet SPL token balances and show only held positions.
                        const wallets = Array.isArray(config_1.solanaWallets) ? config_1.solanaWallets.filter(w => (w || '').trim().length > 0) : [];
                        const held = [];
                        const solLines = [];
                        const minBalance = Number(((_a = sessions[chatId]) === null || _a === void 0 ? void 0 : _a.minBalance) || 0);
                        for (const pkBase58 of wallets) {
                            try {
                                const payer = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(bs58_1.default.decode(pkBase58.trim())));
                                // Wallet SOL balance
                                const lamports = await config_1.connection.getBalance(payer.publicKey);
                                const sol = lamports / 1e9;
                                solLines.push(`◎ ${payer.publicKey.toBase58()}: ${sol.toFixed(6)} SOL`);
                                const parsed = await config_1.connection.getParsedTokenAccountsByOwner(payer.publicKey, { programId: raydium_sdk_1.TOKEN_PROGRAM_ID });
                                for (const acc of parsed.value) {
                                    const info = acc.account.data.parsed.info;
                                    const mint = info.mint;
                                    const uiAmount = Number(info.tokenAmount.uiAmount || 0);
                                    if (uiAmount > minBalance)
                                        held.push({ mint, amount: uiAmount });
                                }
                            }
                            catch (_) { }
                        }
                        if (held.length === 0) {
                            const noPosText = [
                                "📊 No SPL token balances found in configured wallets.",
                                "",
                                "◎ SOL Balances:",
                                ...(solLines.length ? solLines : ["(no wallets configured)"])
                            ].join("\n");
                            await bot.editMessageText(noPosText, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: "🛑 Stop Dashboard", callback_data: "stop_dashboard" }]] } });
                            return;
                        }
                        // Build entry price map from DB buys (last entry per mint)
                        const buys = await (0, db_1.getSolanaBuys)();
                        const entryByMint = new Map();
                        for (const row of buys || []) {
                            entryByMint.set(String(row.contractAddress), Number(row.purchasedPrice));
                        }
                        const lines = [];
                        lines.push("📊 Live Positions (updates ~4s)");
                        lines.push("");
                        lines.push(`◎ SOL Balances (min: ${minBalance}):`);
                        if (solLines.length)
                            lines.push(...solLines);
                        else
                            lines.push("(no wallets configured)");
                        lines.push("");
                        lines.push("SPL Token Positions:");
                        for (const pos of held) {
                            const token = pos.mint;
                            const p = await (0, helper_1.getSolanaTokenPriceBitquery)(token).catch(() => ({ usdPrice: undefined }));
                            const cur = p === null || p === void 0 ? void 0 : p.usdPrice;
                            const entry = entryByMint.get(token);
                            const pnl = (cur != null && entry != null) ? ((cur - entry) / entry) * 100 : undefined;
                            lines.push(`• ${token}\n  size: ${pos.amount} | entry: ${entry != null ? `$${entry.toFixed(6)}` : 'n/a'} | cur: ${cur != null ? `$${cur.toFixed(6)}` : 'n/a'} | pnl: ${pnl != null ? pnl.toFixed(2) + '%' : 'n/a'}`);
                        }
                        let text = lines.join("\n");
                        if (text.length > 3900)
                            text = text.slice(0, 3900) + "\n...";
                        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [[{ text: "🛑 Stop Dashboard", callback_data: "stop_dashboard" }]] } });
                    }
                    catch (e) {
                        log.error("Dashboard render error", e);
                    }
                };
                await render();
                const interval = setInterval(render, 4000);
                dashboards[chatId] = { interval, messageId };
            }
            catch (e) {
                log.error("Live dashboard error", e);
                await bot.sendMessage(chatId, `Failed to start dashboard: ${e}`);
            }
        }
        else if (category === "stop_dashboard") {
            const d = dashboards[chatId];
            if (d === null || d === void 0 ? void 0 : d.interval)
                clearInterval(d.interval);
            dashboards[chatId] = undefined;
            await bot.sendMessage(chatId, "🛑 Dashboard stopped.");
        }
        else if (category === "clear_db_buys") {
            await bot.sendMessage(chatId, "This will delete ALL rows from the buys table. Are you sure?", {
                reply_markup: {
                    inline_keyboard: [[
                            { text: "✅ Confirm Clear", callback_data: "confirm_clear_db_buys" },
                            { text: "❌ Cancel", callback_data: "cancel_clear_db_buys" }
                        ]]
                }
            });
        }
        else if (category === "confirm_clear_db_buys") {
            try {
                await (0, db_1.clearAllBuys)();
                await bot.sendMessage(chatId, "Buys table cleared.");
            }
            catch (e) {
                log.error("Clear DB buys error", e);
                await bot.sendMessage(chatId, `Failed to clear buys: ${e}`);
            }
        }
        else if (category === "cancel_clear_db_buys") {
            await bot.sendMessage(chatId, "Clear canceled.");
        }
        else if (category === "clear_nonheld_buys") {
            try {
                // Compute held mints
                const wallets = Array.isArray(config_1.solanaWallets) ? config_1.solanaWallets.filter(w => (w || '').trim().length > 0) : [];
                const heldSet = new Set();
                for (const pkBase58 of wallets) {
                    try {
                        const payer = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(bs58_1.default.decode(pkBase58.trim())));
                        const parsed = await config_1.connection.getParsedTokenAccountsByOwner(payer.publicKey, { programId: raydium_sdk_1.TOKEN_PROGRAM_ID });
                        for (const acc of parsed.value) {
                            const info = acc.account.data.parsed.info;
                            const mint = info.mint;
                            const uiAmount = Number(info.tokenAmount.uiAmount || 0);
                            if (uiAmount > 0)
                                heldSet.add(mint);
                        }
                    }
                    catch (_) { }
                }
                const held = Array.from(heldSet);
                await bot.sendMessage(chatId, `About to clear non-held buys. Held count: ${held.length}. Proceed?`, {
                    reply_markup: { inline_keyboard: [[
                                { text: "✅ Confirm", callback_data: `confirm_clear_nonheld_buys` },
                                { text: "❌ Cancel", callback_data: `cancel_clear_nonheld_buys` }
                            ]] }
                });
                // Cache held in session for confirm step
                sessions[chatId].pendingHeld = held;
            }
            catch (e) {
                log.error("Prep clear non-held error", e);
                await bot.sendMessage(chatId, `Failed to prepare clear: ${e}`);
            }
        }
        else if (category === "confirm_clear_nonheld_buys") {
            try {
                const held = ((_b = sessions[chatId]) === null || _b === void 0 ? void 0 : _b.pendingHeld) || [];
                await (0, db_1.clearBuysNotIn)(held);
                sessions[chatId].pendingHeld = undefined;
                await bot.sendMessage(chatId, "Cleared non-held buys.");
            }
            catch (e) {
                log.error("Clear non-held buys error", e);
                await bot.sendMessage(chatId, `Failed to clear non-held buys: ${e}`);
            }
        }
        else if (category === "cancel_clear_nonheld_buys") {
            sessions[chatId].pendingHeld = undefined;
            await bot.sendMessage(chatId, "Clear non-held canceled.");
        }
        else if (category === "set_min_balance") {
            sessions[chatId].waitingForMinBalance = true;
            await bot.sendMessage(chatId, "Enter minimum SPL token balance to display (e.g., 0.001). Use 0 to show all.");
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
        else if (session.waitingForSellAddress) {
            const tokenAddress = msg.text.trim();
            if (tokenAddress) {
                session.waitingForSellAddress = false;
                log.info("Manual sell token address entered", { chatId, tokenAddress });
                await bot.sendMessage(chatId, `👌 Sell setup:\n\n📉 Percent: ${session.sellPercent}%\n🤝 Token Address: ${tokenAddress}`);
                if ((0, startTrade_1.createSignal)(tokenAddress, session.sellPercent, 'sell')) {
                    tlog.info("Manual sell signal created", { tokenAddress, percent: session.sellPercent });
                    await (0, startTrade_1.runTrade)({
                        id: Date.now(),
                        contractAddress: tokenAddress,
                        action: 'sell',
                        amount: String(session.sellPercent),
                        platform: 'raydium',
                        chain: 'solana',
                        timestamp: new Date().toISOString()
                    }, 0);
                }
                await bot.sendMessage(chatId, "📈 Choose your sell method:", selectedSellOptions);
                await bot.sendMessage(chatId, "Sell signal executed.");
                delete sessions[chatId];
            }
        }
        else if (session.waitingForSellPercent) {
            const percent = parseFloat(msg.text);
            if (!isNaN(percent) && percent > 0 && percent <= 100) {
                session.sellPercent = percent;
                session.waitingForSellPercent = false;
                session.waitingForSellAddress = true;
                log.info("Manual sell percent entered", { chatId, percent });
                bot.sendMessage(chatId, "🧧 Input the token address you want to sell ...  (sol mint)");
            }
            else {
                bot.sendMessage(chatId, "Invalid percent. Enter a number between 1 and 100.");
            }
        }
        else if (session.waitingForMinBalance) {
            const min = parseFloat(msg.text);
            if (!isNaN(min) && min >= 0) {
                sessions[chatId].minBalance = min;
                sessions[chatId].waitingForMinBalance = false;
                log.info("Min balance updated", { chatId, min });
                await bot.sendMessage(chatId, `Minimum balance set to ${min}. This filters dashboard SPL positions.`);
            }
            else {
                await bot.sendMessage(chatId, "Invalid number. Please enter a non-negative number, e.g., 0.001");
            }
        }
        else if (autoBuyEnabled && typeof msg.text === 'string' && msg.text.trim().length > 0) {
            // Auto Buy mode: robustly parse message for possible Solana mint addresses
            const text = msg.text;
            // Extract all base58 substrings of plausible mint length wherever they appear
            const candidates = Array.from(new Set((text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) || [])));
            for (let raw of candidates) {
                // Handle GMGN-style suffixes like '<mint>pump'
                let candidate = raw;
                if (candidate.toLowerCase().endsWith('pump')) {
                    const trimmed = candidate.slice(0, -4);
                    if ((0, helper_2.verifyAddress)(trimmed) === types_1.addressType.SOLANA)
                        candidate = trimmed;
                }
                const kind = (0, helper_2.verifyAddress)(candidate);
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
                        const amount = (0, helper_2.getRandomArbitrary)(config_2.solBuyAmountRange[0], config_2.solBuyAmountRange[1]);
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
