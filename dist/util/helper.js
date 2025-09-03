"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokenBalance = exports.getTokenAccountByOwnerAndMint = exports.convertAsSignal = exports.getSolanaTokenPrice = exports.MoralisStart = exports.Delay = exports.getRandomArbitrary = exports.verifyAddress = void 0;
const web3_js_1 = require("@solana/web3.js");
const types_1 = require("./types");
const moralis_1 = __importDefault(require("moralis"));
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = require("./logger");
dotenv_1.default.config();
const config_1 = require("../config");
const anchor_1 = require("@coral-xyz/anchor");
const bs58_1 = __importDefault(require("bs58"));
const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
const verifySolanaAddress = (address) => {
    if (address.length < 32 || address.length > 44) {
        return false;
    }
    try {
        const publicKey = new web3_js_1.PublicKey(address);
        return web3_js_1.PublicKey.isOnCurve(publicKey);
    }
    catch (error) {
        return false;
    }
};
const verifyAddress = (address) => {
    if (verifySolanaAddress(address)) {
        return types_1.addressType.SOLANA;
    }
    return types_1.addressType.INVALID;
};
exports.verifyAddress = verifyAddress;
const getRandomArbitrary = (min, max) => {
    return Math.random() * (max - min) + min;
};
exports.getRandomArbitrary = getRandomArbitrary;
const Delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
exports.Delay = Delay;
const MoralisStart = async () => {
    await moralis_1.default.start({ apiKey: MORALIS_API_KEY });
};
exports.MoralisStart = MoralisStart;
const getSolanaTokenPrice = async (address) => {
    await (0, exports.Delay)(200);
    (0, logger_1.childLogger)(logger_1.tradeLogger, 'Price').debug("token mint address", { address });
    for (let i = 0; i < 5; i++) {
        try {
            const response = await moralis_1.default.SolApi.token.getTokenPrice({
                "network": "mainnet",
                "address": address
            });
            if (response.raw)
                return response.raw;
        }
        catch (err) {
            await (0, exports.Delay)(1000);
            (0, logger_1.childLogger)(logger_1.tradeLogger, 'Price').error("solana token price", err);
        }
    }
    // Shaped return to avoid spread errors if price lookup fails
    return { usdPrice: undefined };
};
exports.getSolanaTokenPrice = getSolanaTokenPrice;
// Bitquery support removed; Moralis is the sole price provider
const convertAsSignal = async (histories, solana = false) => {
    try {
        const data = histories.map((item) => {
            return {
                address: item.contractAddress,
                chain: item.chain
            };
        }).flat();
        const uniqueData = [...new Set(data)];
        (0, logger_1.childLogger)(logger_1.tradeLogger, 'Signals').debug("unique data", uniqueData);
        const newPrice = [];
        let priceResult = [];
        for (let i = 0; i < uniqueData.length; i++) {
            const priceData = await (0, exports.getSolanaTokenPrice)(uniqueData[i].address);
            priceResult[i] = {
                usdPrice: priceData === null || priceData === void 0 ? void 0 : priceData.usdPrice,
                tokenAddress: uniqueData[i].address
            };
        }
        priceResult.forEach(e => {
            (0, logger_1.childLogger)(logger_1.tradeLogger, 'Signals').debug("token price", { tokenAddress: e.tokenAddress.toString().toLowerCase(), usdPrice: e.usdPrice });
        });
        priceResult.forEach(one => newPrice[one.tokenAddress.toString().toLowerCase()] = one.usdPrice);
        const signales = [];
        histories.forEach((item) => {
            (0, logger_1.childLogger)(logger_1.tradeLogger, 'Signals').debug("price compare", {
                contractAddress: item.contractAddress.toLocaleLowerCase(),
                purchasePrice: item.purchasedPrice,
                currentPrice: newPrice[item.contractAddress.toLocaleLowerCase()],
                rate: newPrice[item.contractAddress.toLocaleLowerCase()] / item.purchasedPrice
            });
            if (newPrice[item.contractAddress.toLocaleLowerCase()] != undefined && newPrice[item.contractAddress.toLocaleLowerCase()] >= item.purchasedPrice * config_1.priceFactor[item.priceFactor]) {
                if (item.priceFactor == 2) {
                    signales.push({
                        "id": item.id,
                        "contractAddress": item.contractAddress,
                        "action": "sell",
                        "amount": "100",
                        "platform": item.platform,
                        "chain": item.chain,
                        "priceFactor": item.priceFactor
                    });
                }
                else {
                    signales.push({
                        "id": item.id,
                        "contractAddress": item.contractAddress,
                        "action": "sell",
                        "amount": "50",
                        "platform": item.platform,
                        "chain": item.chain,
                        "priceFactor": item.priceFactor
                    });
                }
            }
        });
        return signales;
    }
    catch (err) {
        (0, logger_1.childLogger)(logger_1.tradeLogger, 'Signals').error('convertAsSignal error', err);
        return [];
    }
};
exports.convertAsSignal = convertAsSignal;
const getTokenAccountByOwnerAndMint = async (WALLET_PRIVATE_KEY, mintAddress) => {
    const wallet = new anchor_1.Wallet(web3_js_1.Keypair.fromSecretKey(Uint8Array.from(bs58_1.default.decode(WALLET_PRIVATE_KEY))));
    for (let i = 0; i < 3; i++) {
        try {
            const accountAddress = await config_1.connection.getTokenAccountsByOwner(wallet.publicKey, {
                mint: new web3_js_1.PublicKey(mintAddress)
            });
            return accountAddress;
        }
        catch (err) {
            (0, logger_1.childLogger)(logger_1.tradeLogger, 'Wallet').warn("Empty token account");
        }
    }
    return "empty";
};
exports.getTokenAccountByOwnerAndMint = getTokenAccountByOwnerAndMint;
const getTokenBalance = async (accountAddress) => {
    const balance = await config_1.connection.getTokenAccountBalance(accountAddress);
    return balance.value.amount;
};
exports.getTokenBalance = getTokenBalance;
