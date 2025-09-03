import { Keypair, PublicKey } from "@solana/web3.js"
import { addressType, signal } from "./types";
import Moralis from "moralis";
import axios from 'axios';
import dotenv from "dotenv";
import { appLogger, tradeLogger, childLogger } from "./logger";
dotenv.config();

import { priceFactor, connection } from "../config";
import { Wallet } from "@coral-xyz/anchor";
import bs58 from "bs58";

const MORALIS_API_KEY = process.env.MORALIS_API_KEY;
const BITQUERY_V2_TOKEN = process.env.BITQUERY_V2_TOKEN;
const BITQUERY_V1_TOKEN = process.env.BITQUERY_V1_TOKEN;
const PRICE_PROVIDER = (process.env.PRICE_PROVIDER || 'auto').toLowerCase();



const verifySolanaAddress = (address: string) : any => {
    if (address.length < 32 || address.length > 44) {
        return false;
    }
    try {
        const publicKey = new PublicKey(address);
        return PublicKey.isOnCurve(publicKey);
    } catch (error) {
        return false;
    }
}

export const verifyAddress = (address: string): addressType => {
    if (verifySolanaAddress(address)) {
        return addressType.SOLANA;
    }
    return addressType.INVALID;
}
export const getRandomArbitrary = (min: number, max: number): number => {
    return Math.random() * (max - min) + min;
}

export const Delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const MoralisStart = async () => {
    await Moralis.start({ apiKey: MORALIS_API_KEY });
}

export const getSolanaTokenPrice = async (address: string) => {
    await Delay(200);
    childLogger(tradeLogger, 'Price').debug("token mint address", { address })
    for (let i = 0; i < 5; i++) {
        try {
            const response = await Moralis.SolApi.token.getTokenPrice({
                "network": "mainnet",
                "address": address
            });
            if (response.raw) return response.raw;    
        } catch(err) {
            await Delay(1000);
            childLogger(tradeLogger, 'Price').error("solana token price", err);
        }
    }
}

export const getSolanaTokenPriceBitquery = async (address: string) => {
    // Allow opting out of Bitquery entirely
    if (PRICE_PROVIDER === 'moralis') {
      const m = await getSolanaTokenPrice(address);
      return { usdPrice: (m as any)?.usdPrice };
    }
    await Delay(200);
    childLogger(tradeLogger, 'Price').debug("token mint address", { address })

    const query = `{
      Solana {
        DEXTradeByTokens(
          where: {Trade: {Currency: {MintAddress: {is: "${address}"}}}}
          orderBy: {descending: Trade_Side_Currency_Decimals}
          limit: {count: 1}
        ) { Trade { PriceInUSD } }
      }
    }`;

    const useEap = Boolean(BITQUERY_V1_TOKEN && BITQUERY_V2_TOKEN && BITQUERY_V1_TOKEN !== '...' && BITQUERY_V2_TOKEN !== '...')
    const url = useEap ? 'https://streaming.bitquery.io/eap' : 'https://graphql.bitquery.io';
    const headers: any = {
      'Content-Type': 'application/json',
    };
    if (BITQUERY_V1_TOKEN && BITQUERY_V1_TOKEN !== '...') headers['X-API-KEY'] = BITQUERY_V1_TOKEN;
    if (useEap) headers['Authorization'] = `Bearer ${BITQUERY_V2_TOKEN}`;

    const config = {
      method: 'post' as const,
      maxBodyLength: Infinity,
      url,
      headers,
      data: JSON.stringify({ query, variables: '{}' }),
    };

    for (let i = 0; i < 5; i++) {
      try {
        const response = await axios.request(config);
        childLogger(tradeLogger, 'Price').debug("bitquery response", response.data);
        const price = response?.data?.data?.Solana?.DEXTradeByTokens?.[0]?.Trade?.PriceInUSD;
        if (price != null) {
          return { usdPrice: price };
        } else {
          childLogger(tradeLogger, 'Price').warn("Bitquery: no DEX price for token", { address });
        }
      } catch (err: any) {
        const status = err?.response?.status;
        const msg = err?.response?.data || err?.message;
        childLogger(tradeLogger, 'Price').warn("Bitquery price fetch error", { address, status, msg });
      }
      await Delay(1000);
    }

    // Fallback to Moralis if Bitquery failed
    try {
      const m = await getSolanaTokenPrice(address);
      const usdPrice = (m as any)?.usdPrice;
      if (usdPrice != null) {
        childLogger(tradeLogger, 'Price').info("Fallback: Moralis price used", { address, usdPrice });
        return { usdPrice };
      }
    } catch (err) {
      childLogger(tradeLogger, 'Price').warn("Moralis fallback failed", { address });
    }

    // Final: return a shaped object to avoid spread errors upstream
    return { usdPrice: undefined as unknown as number } as any;
}

export const convertAsSignal = async (histories: any, solana = false) => {
    try {
        const data = histories.map((item: any) => {
            return {
                address: item.contractAddress,
                chain: item.chain
            }
        }).flat();
        const uniqueData: any = [...new Set(data)];
        childLogger(tradeLogger, 'Signals').debug("unique data", uniqueData);
        const newPrice: any = []
        let priceResult = []
     
        for (let i = 0; i < uniqueData.length; i++) {
            priceResult[i] = {
                ...await getSolanaTokenPriceBitquery(uniqueData[i].address),
                tokenAddress: uniqueData[i].address
            }
        }
        priceResult.forEach(e => {
            childLogger(tradeLogger, 'Signals').debug("token price", { tokenAddress: e.tokenAddress.toString().toLowerCase(), usdPrice: e.usdPrice });
        })
        priceResult.forEach(one => newPrice[one.tokenAddress.toString().toLowerCase()] = one.usdPrice);
    
        const signales: signal[] = [];
        
        histories.forEach((item: any) => {
            childLogger(tradeLogger, 'Signals').debug("price compare", {
                contractAddress: item.contractAddress.toLocaleLowerCase(),
                purchasePrice: item.purchasedPrice,
                currentPrice: newPrice[item.contractAddress.toLocaleLowerCase()],
                rate: newPrice[item.contractAddress.toLocaleLowerCase()] / item.purchasedPrice
            });
            if (newPrice[item.contractAddress.toLocaleLowerCase()] != undefined && newPrice[item.contractAddress.toLocaleLowerCase()] >= item.purchasedPrice * priceFactor[item.priceFactor]) {
            if (item.priceFactor == 2) {
                signales.push({
                "id": item.id,
                "contractAddress": item.contractAddress,
                "action": "sell",
                "amount": "100",
                "platform": item.platform,
                "chain": item.chain,
                "priceFactor": item.priceFactor
                } as signal);
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
                } as signal);
            }
            }
        })
        return signales
    }
    catch (err) {
      childLogger(tradeLogger, 'Signals').error('convertAsSignal error', err)
      return []
    }
}

export const getTokenAccountByOwnerAndMint = async (WALLET_PRIVATE_KEY: string, mintAddress: string) => {
    const wallet = new Wallet(Keypair.fromSecretKey(Uint8Array.from(bs58.decode(WALLET_PRIVATE_KEY))))
    for (let i = 0; i < 3; i++) {
        try {
            const accountAddress = await connection.getTokenAccountsByOwner(
                wallet.publicKey,
                {
                    mint: new PublicKey(mintAddress)
                }
            );
            return accountAddress;
        } catch (err) {
            childLogger(tradeLogger, 'Wallet').warn("Empty token account");
        } 
    }
    return "empty"
}

export const getTokenBalance = async (accountAddress: PublicKey) => {
    const balance = await connection.getTokenAccountBalance(
        accountAddress,
    )
    return balance.value.amount;
} 
  
