import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
dotenv.config();
import { 
    createSignal,
    tokenBuy,
    tokenSell,
    runTrade
} from "../startTrade";
import { sellInternalDuration } from "../config";
import { verifyAddress, getRandomArbitrary } from "../util/helper";
import { solBuyAmountRange } from "../config";
import { addressType } from "../util/types";

const startRouter = (bot: TelegramBot) => {
    // Session state for each chat
    const sessions: any = {};
    let globalChatId: any;
    let autoBuyEnabled = false; // toggled by UI

    // Build channel button URL from env, if a public username is provided
    const envChannel = (process.env.TELEGRAM_CHANNEL || '').trim();
    let channelUrl: string | undefined = undefined;
    if (envChannel) {
        const isNumericId = /^-?\d+$/.test(envChannel);
        if (!isNumericId) {
            let handle = envChannel;
            if (handle.startsWith('http')) {
                const m = handle.match(/t\.me\/(.+)$/);
                if (m && m[1]) handle = m[1];
            }
            if (handle.startsWith('@')) handle = handle.slice(1);
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
    const isAuthorizedChat = (chatId: number) => {
        if (!allowedGroupId) return true; // no restriction if not set
        return String(chatId) === allowedGroupId;
    };

    bot.onText(/\/start/, (msg: any) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedChat(chatId)) return;
        console.log("chatId", chatId);
        const welcomeMessage = "🍄 Welcome to my soltank_bot!\n\n`AAEuA3DeoblV-LZQwoexDgWJoM2Tg0-E2Ns                                   `\n\n`https://t.me/mysol_tankbot`\n\n 🥞 Please choose a category below:";
        bot.sendMessage(chatId, welcomeMessage, options);
    });

    bot.on("callback_query", (callbackQuery: any) => {

        const message = callbackQuery.message;
        const category = callbackQuery.data;
        const chatId = message.chat.id;
        if (!isAuthorizedChat(chatId)) return;
        globalChatId = chatId;

        let tokenSellInterval;

        if (!sessions[chatId]) {
            sessions[chatId] = { waitingForAmount: false, waitingForTokenAddress: false };
        }

        if (category === "buy") {
            bot.sendMessage(chatId, "🏆 Choose your buy method:                  ", selectedBuyOptions);
        } else if (category === "manual_buy") {
            sessions[chatId].waitingForAmount = true;
            bot.sendMessage(chatId, "✍ Input the amount you want to buy ...  (sol)     \n⚱️  For example: 1.25                      ");
        } else if (category === "auto_buy") {
            autoBuyEnabled = true;
            bot.sendMessage(chatId, "✍ Auto Buy enabled. Post messages with Solana token addresses in this chat to buy automatically.");
            // Enable periodic sell checks
            clearInterval(tokenSellInterval);
            tokenSellInterval = setInterval(tokenSell, sellInternalDuration);

        } else if (category === "stop_buy") {
            autoBuyEnabled = false;
            clearInterval(tokenSellInterval);
            bot.sendMessage(chatId, "🏆 Choose your buy method:                  ", selectedBuyOptions);
        }
    });

    bot.on("message", async (msg: any) => {
        const chatId = msg.chat.id;
        if (!isAuthorizedChat(chatId)) return;
        const session = sessions[chatId];

        if (!session) return; // Ignore messages if session isn't initialized

        // Manual flow: token address entry
        if (session.waitingForTokenAddress) {
            const tokenAddress = msg.text.trim();
            if (tokenAddress) {
                console.log("Token address:", tokenAddress);
                session.tokenAddress = tokenAddress;
                session.waitingForTokenAddress = false;      
                await bot.sendMessage(chatId, `👌 Success! Ready for swap ...                                                 \n\n💰 Amount: ${session.amount.toFixed(6)} SOL           \n🤝 Token Address: ${tokenAddress}`);
                // console.log("----***--SwapConfig---***---", swapConfig(tokenAddress, session.amount));
                await bot.sendMessage(chatId, `Token: ${tokenAddress}, Amount: ${session.amount} SOL`);
                if (createSignal(tokenAddress, session.amount)){
                    await tokenBuy();
                }
                await bot.sendMessage(chatId, "🏆 Choose your buy method:                  ", selectedBuyOptions);
                await bot.sendMessage(chatId, "Buy Success!      \nIf you want to stop manual token buy, please click Stop button...", stopOptions);
                delete sessions[chatId]; // Clear session after completion
            }
        } else if (session.waitingForAmount) {
            const amount = parseFloat(msg.text);
            if (!isNaN(amount)) {
                session.amount = amount;
                session.waitingForAmount = false;
                session.waitingForTokenAddress = true;
                bot.sendMessage(chatId, "🧧 Input the token address you want to buy ...  (sol)     \n\n⚱️  For example: CXeaSFtgwDJ6HKrGNNxtDEwydUcbZySx8rhJmoJBkEy3      ");
            } else {
                bot.sendMessage(chatId, "Invalid amount. Please enter a valid number.");
            }
        } else if (autoBuyEnabled && typeof msg.text === 'string' && msg.text.trim().length > 0) {
            // Auto Buy mode: parse incoming message for Solana token addresses and buy
            const text: string = msg.text;
            const parts = text.split(/[\s\n,;:()<>#'"`]+/).filter(Boolean);
            const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
            const candidates = parts.filter(p => p.length >= 32 && p.length <= 44 && base58Regex.test(p));
            for (const candidate of candidates) {
                const kind = verifyAddress(candidate);
                if (kind === addressType.SOLANA) {
                    // Detect SELL intent
                    const lowered = text.toLowerCase();
                    const isSell = /(sell|close|exit|tp\b|take\s*profit)/.test(lowered);
                    if (isSell) {
                        const signal = {
                            id: Date.now(),
                            contractAddress: candidate,
                            action: "sell" as const,
                            amount: "100",
                            platform: "raydium" as const,
                            chain: "solana" as const,
                            timestamp: new Date().toISOString()
                        };
                        await runTrade(signal, 0);
                        await bot.sendMessage(chatId, `Auto Sell triggered for ${candidate} (100%)`);
                        break;
                    } else {
                        const amount = getRandomArbitrary(solBuyAmountRange[0], solBuyAmountRange[1]);
                        if (createSignal(candidate, amount, 'buy')) {
                            await tokenBuy();
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
            bot.sendMessage(globalChatId, "Buy Success!      \nIf you want to stop token auto sell, please click Stop button...", stopOptions);
        }
    }    
}


export default startRouter;
