"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const RaydiumSwap_1 = __importDefault(require("./RaydiumSwap"));
const swapConfig_1 = __importDefault(require("./swapConfig")); // Import the configuration
const helper_1 = require("../util/helper");
const helper_2 = require("../util/helper");
// const { buyActions, sellActions } = require('../../utils/db');
const config_1 = require("../config");
const db_1 = require("../util/db");
const logger_1 = require("../util/logger");
const notifier_1 = require("../util/notifier");
/**
 * Performs a token swap on the Raydium protocol.
 * Depending on the configuration, it can execute the swap or simulate it.
 */
const raydiumSwap = async (signal, sell = false, signalNumber) => {
    try {
        const tlog = (0, logger_1.childLogger)(logger_1.tradeLogger, 'Raydium');
        if (!config_1.solanaWallets[0]) {
            tlog.error("No Solana private key configured. Set `SOLANA_WALLETS` (comma-separated) or `SOL_PRIVATE_KEY` in .env");
            return;
        }
        const raydiumSwap = new RaydiumSwap_1.default(config_1.solanaWallets[0]);
        tlog.info(`Raydium swap initialized`);
        let tokenAAddress;
        let tokenBAddress;
        let tokenAAmount = 0;
        let accountAddress;
        let initialBalance;
        let tokenBPrice;
        let tokenAPrice;
        if (sell) { // sell
            tokenAAddress = signal.contractAddress.toString();
            tokenBAddress = swapConfig_1.default.solTokenAddress;
        }
        else { // buy
            tokenAAddress = swapConfig_1.default.solTokenAddress;
            tokenBAddress = signal.contractAddress.toString();
            tokenAAmount = parseFloat(signal.amount.toString().split("SOL")[0]);
            tokenAPrice = await (0, helper_2.getSolanaTokenPrice)(tokenAAddress); // Sol price;
            tlog.info(`tokenAPrice`, { usdPrice: tokenAPrice?.usdPrice });
            if (tokenAPrice?.usdPrice === undefined)
                return;
        }
        /**
          * Find pool information for the given token pair.
        */
        const poolInfo = await raydiumSwap.getPoolInfoByTokenPair(tokenAAddress, tokenBAddress);
        // console.log("poolInfo", poolInfo);
        if (!poolInfo) {
            tlog.warn("Pool info not found", { tokenAAddress, tokenBAddress });
            await (0, notifier_1.notify)(`⚠️ No Raydium pool found for pair\nA: ${tokenAAddress}\nB: ${tokenBAddress}`);
            return;
        }
        tlog.info('Found pool info');
        const instructions = [];
        if (sell) { // sell
            accountAddress = await (0, helper_1.getTokenAccountByOwnerAndMint)(config_1.solanaWallets[0], tokenAAddress);
            tlog.debug("Sell accountAddress", { accountAddress });
            initialBalance = await (0, helper_1.getTokenBalance)(accountAddress.value[0].pubkey);
            tlog.info(`Sell tokenA initial balance`, { initialBalance });
            tokenAAmount = parseFloat(signal.amount.toString().split("SOL")[0]) / 100 * initialBalance / (10 ** poolInfo.baseDecimals);
        }
        else { //buy
            accountAddress = await (0, helper_1.getTokenAccountByOwnerAndMint)(config_1.solanaWallets[0], tokenBAddress);
            tlog.debug("Buy accountAddress", { accountAddress });
            if (accountAddress?.value?.[0]?.pubkey === undefined) {
                // const createTokenAtaInst = await raydiumSwap.createAssociatedTokenAccount(tokenBAddress);
                // if (createTokenAtaInst) {
                //   // instructions.push(createTokenAtaInst);
                // }
                initialBalance = 0;
            }
            else {
                initialBalance = await (0, helper_1.getTokenBalance)(accountAddress.value[0].pubkey);
            }
            tlog.info(`Buy tokenB initial balance`, { initialBalance });
        }
        tlog.info(`Swapping`, { amount: tokenAAmount, from: tokenAAddress, to: tokenBAddress });
        /**
         * Prepare the swap transaction with the given parameters.
         */
        const swapInst = await raydiumSwap.getSwapTransaction(tokenBAddress, tokenAAmount, poolInfo, swapConfig_1.default.maxLamports, swapConfig_1.default.useVersionedTransaction, swapConfig_1.default.direction);
        instructions.push(...swapInst);
        tlog.debug("instructions prepared", { count: instructions.length });
        const { versionedTransaction: tx, recentBlockhashForSwap: recentBlockhash } = await raydiumSwap.createVersionedTransaction(instructions);
        // console.log("versionedTransaction", tx);
        /**
         * Depending on the configuration, execute or simulate the swap.
         */
        if (swapConfig_1.default.executeSwap) {
            /**
             * Send the transaction to the network and log the transaction ID.
             */
            const res = await raydiumSwap.sendVersionedTransaction(tx, swapConfig_1.default.maxRetries, recentBlockhash);
            if (res) { //&& await raydiumSwap.checkTranactionSuccess(txid)
                tlog.info('Swap success');
                await (0, notifier_1.notifySwapResult)({ action: sell ? 'sell' : 'buy', token: sell ? tokenAAddress : tokenBAddress, amount: sell ? undefined : tokenAAmount, success: true, txid: String(res) });
                if (!sell) {
                    /**
                     * Get token account if new token account was created.
                     */
                    if (accountAddress?.value[0]?.pubkey === undefined) {
                        while (1) {
                            accountAddress = await (0, helper_1.getTokenAccountByOwnerAndMint)(config_1.solanaWallets[0], tokenBAddress);
                            if (accountAddress != "empty")
                                break;
                        }
                    }
                    const afterBalance = await (0, helper_1.getTokenBalance)(accountAddress.value[0].pubkey);
                    tlog.info(`tokenB balance after buy`, { afterBalance });
                    const tokenUsdPrice = (tokenAPrice?.usdPrice || 0) * tokenAAmount / ((afterBalance ? afterBalance : 0) - initialBalance) * (10 ** (2 * poolInfo.quoteDecimals - 9));
                    /**
                     * Save buy result.
                     */
                    db_1.buyActions.push({
                        signalNumber: signalNumber,
                        contractAdress: tokenBAddress,
                        price: tokenUsdPrice,
                        platform: signal.platform.toString(),
                        chain: "solana",
                    });
                }
                else {
                    /**
                     * Save sell result.
                     */
                    db_1.sellActions.push({
                        id: signal.id,
                        contractAddress: signal.contractAddress,
                        priceFactor: signal.priceFactor
                    });
                }
            }
        }
        else {
            /**
             * Simulate the transaction and log the result.
             */
            const simRes = await raydiumSwap.simulateVersionedTransaction(tx);
            const err = simRes.value?.err;
            tlog.warn("Simulation result", { err });
            await (0, notifier_1.notifySwapResult)({ action: sell ? 'sell' : 'buy', token: sell ? tokenAAddress : tokenBAddress, amount: sell ? undefined : tokenAAmount, success: !Boolean(err), simulated: true, error: err });
            tlog.debug("Simulation detail", simRes);
        }
    }
    catch (err) {
        (0, helper_2.Delay)(5000);
        const tlog = (0, logger_1.childLogger)(logger_1.tradeLogger, 'Raydium');
        tlog.error('Raydium swap error', err);
        try {
            await (0, notifier_1.notifySwapResult)({ action: signal?.action || 'buy', token: signal?.contractAddress?.toString?.() ?? 'unknown', amount: Number(String(signal?.amount || '').split(' ')[0] || '0'), success: false, error: err });
        }
        catch { }
    }
};
/**
 * Implment raydium trading.
 * @param {string} signal signal for trading
 * @param {number} signalNumber signal number in valid signal group.
 */
const raydiumToken = async (signal, signalNumber) => {
    try {
        if (signal.action.toString().toLowerCase().trim().includes("sell")) {
            await raydiumSwap(signal, true, signalNumber);
        }
        else {
            await raydiumSwap(signal, false, signalNumber);
        }
    }
    catch (err) {
        (0, logger_1.childLogger)(logger_1.tradeLogger, 'Raydium').error('raydiumToken error', err);
    }
};
exports.default = raydiumToken;
