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
dotenv_1.default.config();
const config_1 = require("../config");
const anchor_1 = require("@coral-xyz/anchor");
const bs58_1 = __importDefault(require("bs58"));
const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
const BITQUERY_V2_TOKEN = process.env.BITQUERY_V2_TOKEN;
const BITQUERY_V1_TOKEN = process.env.BITQUERY_V1_TOKEN;
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
    (0, exports.Delay)(200);
    console.log("token mint address", address);
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
            (0, exports.Delay)(1000);
            console.error("solana token price", err);
        }
    }
};
exports.getSolanaTokenPrice = getSolanaTokenPrice;
const getSolanaTokenPriceBitquery = async (address) => {
    (0, exports.Delay)(200);
    console.log("token mint address", address);
    let data = JSON.stringify({
        "query": `{
            Solana {
            DEXTradeByTokens(
                where: {Trade: {Currency: {MintAddress: {is: "${address}"}}}}
                orderBy: {descending: Trade_Side_Currency_Decimals}
                limit: {count: 1}
            ) {
                Trade {
                PriceInUSD
                }
            }
            }
        }`,
        "variables": "{}"
    });
    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://streaming.bitquery.io/eap',
        headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': BITQUERY_V1_TOKEN,
            'Authorization': `Bearer ${BITQUERY_V2_TOKEN}`
        },
        data: data
    };
    for (let i = 0; i < 5; i++) {
        try {
            const response = await axios_1.default.request(config);
            console.log(JSON.stringify(response.data));
            return {
                usdPrice: response.data.data.Solana.DEXTradeByTokens[0].Trade.PriceInUSD
            };
        }
        catch (err) {
            (0, exports.Delay)(1000);
            console.log("getting token price on Raydium error");
        }
    }
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
        console.log("unique data", uniqueData);
        const newPrice = [];
        let priceResult = [];
        for (let i = 0; i < uniqueData.length; i++) {
            priceResult[i] = {
                ...await (0, exports.getSolanaTokenPriceBitquery)(uniqueData[i].address),
                tokenAddress: uniqueData[i].address
            };
        }
        priceResult.forEach(e => {
            console.log("tokenAddress", e.tokenAddress.toString().toLowerCase(), "tokenprice", e.usdPrice);
        });
        priceResult.forEach(one => newPrice[one.tokenAddress.toString().toLowerCase()] = one.usdPrice);
        const signales = [];
        histories.forEach((item) => {
            console.log("contract Address => ", item.contractAddress.toLocaleLowerCase(), "purchase price =>", item.purchasedPrice, "current price =>", newPrice[item.contractAddress.toLocaleLowerCase()], "rate =>", newPrice[item.contractAddress.toLocaleLowerCase()] / item.purchasedPrice);
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
        console.error(err);
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
            console.log("Empyt token account");
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
