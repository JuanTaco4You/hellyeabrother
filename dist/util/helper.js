"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokenBalance = exports.getTokenAccountByOwnerAndMint = exports.convertAsSignal = exports.getSolanaTokenPriceBitquery = exports.getSolanaTokenPrice = exports.MoralisStart = exports.Delay = exports.getRandomArbitrary = exports.verifyAddress = void 0;
const web3_js_1 = require("@solana/web3.js");
const types_1 = require("./types");
const moralis_1 = __importDefault(require("moralis"));
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = require("./logger");
dotenv_1.default.config();
const config_1 = require("../config");
const anchor_1 = require("@coral-xyz/anchor");
const bs58_1 = __importDefault(require("bs58"));
const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
const BITQUERY_V2_TOKEN = process.env.BITQUERY_V2_TOKEN;
const BITQUERY_V1_TOKEN = process.env.BITQUERY_V1_TOKEN;
const PRICE_PROVIDER = (process.env.PRICE_PROVIDER || 'auto').toLowerCase();
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
};
exports.getSolanaTokenPrice = getSolanaTokenPrice;
const getSolanaTokenPriceBitquery = async (address) => {
    // Allow opting out of Bitquery entirely
    if (PRICE_PROVIDER === 'moralis') {
        const m = await (0, exports.getSolanaTokenPrice)(address);
        return { usdPrice: m?.usdPrice };
    }
    await (0, exports.Delay)(200);
    (0, logger_1.childLogger)(logger_1.tradeLogger, 'Price').debug("token mint address", { address });
    const query = `{
      Solana {
        DEXTradeByTokens(
          where: {Trade: {Currency: {MintAddress: {is: "${address}"}}}}
          orderBy: {descending: Trade_Side_Currency_Decimals}
          limit: {count: 1}
        ) { Trade { PriceInUSD } }
      }
    }`;
    const useEap = Boolean(BITQUERY_V1_TOKEN && BITQUERY_V2_TOKEN && BITQUERY_V1_TOKEN !== '...' && BITQUERY_V2_TOKEN !== '...');
    const url = useEap ? 'https://streaming.bitquery.io/eap' : 'https://graphql.bitquery.io';
    const headers = {
        'Content-Type': 'application/json',
    };
    if (BITQUERY_V1_TOKEN && BITQUERY_V1_TOKEN !== '...')
        headers['X-API-KEY'] = BITQUERY_V1_TOKEN;
    if (useEap)
        headers['Authorization'] = `Bearer ${BITQUERY_V2_TOKEN}`;
    const config = {
        method: 'post',
        maxBodyLength: Infinity,
        url,
        headers,
        data: JSON.stringify({ query, variables: '{}' }),
    };
    for (let i = 0; i < 5; i++) {
        try {
            const response = await axios_1.default.request(config);
            (0, logger_1.childLogger)(logger_1.tradeLogger, 'Price').debug("bitquery response", response.data);
            const price = response?.data?.data?.Solana?.DEXTradeByTokens?.[0]?.Trade?.PriceInUSD;
            if (price != null) {
                return { usdPrice: price };
            }
            else {
                (0, logger_1.childLogger)(logger_1.tradeLogger, 'Price').warn("Bitquery: no DEX price for token", { address });
            }
        }
        catch (err) {
            const status = err?.response?.status;
            const msg = err?.response?.data || err?.message;
            (0, logger_1.childLogger)(logger_1.tradeLogger, 'Price').warn("Bitquery price fetch error", { address, status, msg });
        }
        await (0, exports.Delay)(1000);
    }
    // Fallback to Moralis if Bitquery failed
    try {
        const m = await (0, exports.getSolanaTokenPrice)(address);
        const usdPrice = m?.usdPrice;
        if (usdPrice != null) {
            (0, logger_1.childLogger)(logger_1.tradeLogger, 'Price').info("Fallback: Moralis price used", { address, usdPrice });
            return { usdPrice };
        }
    }
    catch (err) {
        (0, logger_1.childLogger)(logger_1.tradeLogger, 'Price').warn("Moralis fallback failed", { address });
    }
    // Final: return a shaped object to avoid spread errors upstream
    return { usdPrice: undefined };
};
exports.getSolanaTokenPriceBitquery = getSolanaTokenPriceBitquery;
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
            priceResult[i] = {
                ...await (0, exports.getSolanaTokenPriceBitquery)(uniqueData[i].address),
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
