"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const axios_1 = __importDefault(require("axios"));
const anchor_1 = require("@coral-xyz/anchor");
const bs58_1 = __importDefault(require("bs58"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const logger_1 = require("../util/logger");
const FALCONHIT_API_KEY = process.env.FALCONHIT_API_KEY;
const config_1 = require("../config");
const helper_1 = require("../util/helper");
/**
 * Class representing a Raydium Swap operation.
 */
class RaydiumSwap {
    /**
    * Create a RaydiumSwap instance.
    * @param {string} WALLET_PRIVATE_KEY - The private key of the wallet in base58 format.
    */
    constructor(WALLET_PRIVATE_KEY) {
        this.wallet = new anchor_1.Wallet(web3_js_1.Keypair.fromSecretKey(Uint8Array.from(bs58_1.default.decode(WALLET_PRIVATE_KEY))));
        (0, logger_1.childLogger)(logger_1.tradeLogger, 'RaydiumSwap').info("Wallet initialized", { publicKey: this.wallet.publicKey.toBase58() });
        this.wallet.payer;
    }
    /**
     * Gets pool information for the given token pair using FalconHit api
     * @async
     * @param {string} mintA - The mint address of the first token.
     * @param {string} mintB - The mint address of the second token
     * @returns {LiquidityPoolKeys | null}
     */
    async getPoolInfoByTokenPair(mintA, mintB) {
        (0, logger_1.childLogger)(logger_1.tradeLogger, 'RaydiumSwap').debug("Falconhit api key present", { present: Boolean(FALCONHIT_API_KEY) });
        for (let i = 0; i < 3; i++) {
            try {
                const response = await axios_1.default.get(`https://valguibs.com/api/pool/pair/${mintA}/${mintB}`, {
                    headers: {
                        Authorization: FALCONHIT_API_KEY
                    }
                });
                (0, logger_1.childLogger)(logger_1.tradeLogger, 'RaydiumSwap').debug("pool pair response", response.data);
                const poolInfoData = {
                    id: new web3_js_1.PublicKey(response.data[0].id),
                    baseMint: new web3_js_1.PublicKey(response.data[0].baseMint),
                    quoteMint: new web3_js_1.PublicKey(response.data[0].quoteMint),
                    lpMint: new web3_js_1.PublicKey(response.data[0].lpMint),
                    baseDecimals: response.data[0].baseDecimals,
                    quoteDecimals: response.data[0].quoteDecimals,
                    lpDecimals: response.data[0].lpDecimals,
                    version: response.data[0].version,
                    programId: new web3_js_1.PublicKey(response.data[0].programId),
                    authority: new web3_js_1.PublicKey(response.data[0].authority),
                    openOrders: new web3_js_1.PublicKey(response.data[0].openOrders),
                    targetOrders: new web3_js_1.PublicKey(response.data[0].targetOrders),
                    baseVault: new web3_js_1.PublicKey(response.data[0].baseVault),
                    quoteVault: new web3_js_1.PublicKey(response.data[0].quoteVault),
                    withdrawQueue: new web3_js_1.PublicKey(response.data[0].withdrawQueue),
                    lpVault: new web3_js_1.PublicKey(response.data[0].lpVault),
                    marketVersion: response.data[0].marketVersion,
                    marketProgramId: new web3_js_1.PublicKey(response.data[0].marketProgramId),
                    marketId: new web3_js_1.PublicKey(response.data[0].marketId),
                    marketAuthority: new web3_js_1.PublicKey(response.data[0].marketAuthority),
                    marketBaseVault: new web3_js_1.PublicKey(response.data[0].marketBaseVault),
                    marketQuoteVault: new web3_js_1.PublicKey(response.data[0].marketQuoteVault),
                    marketBids: new web3_js_1.PublicKey(response.data[0].marketBids),
                    marketAsks: new web3_js_1.PublicKey(response.data[0].marketAsks),
                    marketEventQueue: new web3_js_1.PublicKey(response.data[0].marketEventQueue),
                    lookupTableAccount: response.data[0].lookupTableAccount,
                };
                return poolInfoData;
            }
            catch (err) {
                await (0, helper_1.Delay)(1000);
                (0, logger_1.childLogger)(logger_1.tradeLogger, 'RaydiumSwap').error("get Pool info", err);
            }
        }
    }
    /**
   * Retrieves token accounts owned by the wallet.
   * @async
   * @returns {Promise<TokenAccount[]>} An array of token accounts.
   */
    async getOwnerTokenAccounts() {
        const walletTokenAccount = await config_1.connection.getTokenAccountsByOwner(this.wallet.publicKey, {
            programId: raydium_sdk_1.TOKEN_PROGRAM_ID,
        });
        return walletTokenAccount.value.map((i) => ({
            pubkey: i.pubkey,
            programId: i.account.owner,
            accountInfo: raydium_sdk_1.SPL_ACCOUNT_LAYOUT.decode(i.account.data),
        }));
    }
    /**
   * Builds a swap transaction.
   * @async
   * @param {string} toToken - The mint address of the token to receive.
   * @param {number} amount - The amount of the token to swap.
   * @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
   * @param {number} [maxLamports=100000] - The maximum lamports to use for transaction fees.
   * @param {boolean} [useVersionedTransaction=true] - Whether to use a versioned transaction.
   * @param {'in' | 'out'} [fixedSide='in'] - The fixed side of the swap ('in' or 'out').
   * @returns {Promise<TransactionInstruction[]>} The constructed swap transaction.
   */
    async getSwapTransaction(toToken, 
    // fromToken: string,
    amount, poolKeys, maxLamports = 100000, useVersionedTransaction = true, fixedSide = 'in') {
        const directionIn = poolKeys.quoteMint.toString() == toToken;
        const { minAmountOut, amountIn } = await this.calcAmountOut(poolKeys, amount, directionIn);
        // console.log({ minAmountOut, amountIn });
        const userTokenAccounts = await this.getOwnerTokenAccounts();
        const swapTransaction = await raydium_sdk_1.Liquidity.makeSwapInstructionSimple({
            connection: config_1.connection,
            makeTxVersion: useVersionedTransaction ? 0 : 1,
            poolKeys: {
                ...poolKeys,
            },
            userKeys: {
                tokenAccounts: userTokenAccounts,
                owner: this.wallet.publicKey,
            },
            amountIn: amountIn,
            amountOut: minAmountOut,
            fixedSide: fixedSide,
            config: {
                bypassAssociatedCheck: false,
            },
            computeBudgetConfig: {
                microLamports: maxLamports,
            },
        });
        // return swapTransaction.innerTransactions;
        const instructions = swapTransaction.innerTransactions[0].instructions.filter(Boolean);
        return instructions;
    }
    /**
     *
     */
    async createVersionedTransaction(instructions) {
        const recentBlockhashForSwap = await config_1.connection.getLatestBlockhash();
        const versionedTransaction = new web3_js_1.VersionedTransaction(new web3_js_1.TransactionMessage({
            payerKey: this.wallet.publicKey,
            instructions: instructions,
            recentBlockhash: recentBlockhashForSwap.blockhash,
        }).compileToV0Message());
        versionedTransaction.sign([this.wallet.payer]);
        return { versionedTransaction, recentBlockhashForSwap };
    }
    /**
   * Sends a versioned transaction.
   * @async
   * @param {VersionedTransaction} tx - The versioned transaction to send.
   * @param {number} maxRetries
   * @param {any} recentBlockhashForSwap
   * @returns {Promise<boolean>} The transaction ID.
   */
    async sendVersionedTransaction(tx, maxRetries, recentBlockhashForSwap) {
        const txid = await config_1.connection.sendTransaction(tx);
        // return txid;
        const confirmation = await config_1.connection.confirmTransaction({
            blockhash: recentBlockhashForSwap.blockhash,
            lastValidBlockHeight: recentBlockhashForSwap.lastValidBlockHeight,
            signature: txid,
        }, 'finalized');
        if (confirmation.value.err) {
            throw new Error("   ❌ - Transaction not confirmed.");
        }
        (0, logger_1.childLogger)(logger_1.tradeLogger, 'RaydiumSwap').info('Transaction confirmed', { url: `https://solscan.io/tx/${txid}` });
        return true;
    }
    /**
   * Simulates a versioned transaction.
   * @async
   * @param {VersionedTransaction} tx - The versioned transaction to simulate.
   * @returns {Promise<any>} The simulation result.
   */
    async simulateVersionedTransaction(tx) {
        const txid = await config_1.connection.simulateTransaction(tx);
        return txid;
    }
    /**
   * Gets a token account by owner and mint address.
   * @param {PublicKey} mint - The mint address of the token.
   * @returns {TokenAccount} The token account.
   */
    getTokenAccountByOwnerAndMint(mint) {
        return {
            programId: raydium_sdk_1.TOKEN_PROGRAM_ID,
            pubkey: web3_js_1.PublicKey.default,
            accountInfo: {
                mint: mint,
                amount: 0,
            },
        };
    }
    /**
   * Calculates the amount out for a swap.
   * @async
   * @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
   * @param {number} rawAmountIn - The raw amount of the input token.
   * @param {boolean} swapInDirection - The direction of the swap (true for in, false for out).
   * @returns {Promise<Object>} The swap calculation result.
   */
    async calcAmountOut(poolKeys, rawAmountIn, swapInDirection) {
        const poolInfo = await raydium_sdk_1.Liquidity.fetchInfo({ connection: config_1.connection, poolKeys });
        let currencyInMint = poolKeys.baseMint;
        let currencyInDecimals = poolInfo.baseDecimals;
        let currencyOutMint = poolKeys.quoteMint;
        let currencyOutDecimals = poolInfo.quoteDecimals;
        if (!swapInDirection) {
            currencyInMint = poolKeys.quoteMint;
            currencyInDecimals = poolInfo.quoteDecimals;
            currencyOutMint = poolKeys.baseMint;
            currencyOutDecimals = poolInfo.baseDecimals;
        }
        const currencyIn = new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals);
        const amountIn = new raydium_sdk_1.TokenAmount(currencyIn, rawAmountIn, false);
        const currencyOut = new raydium_sdk_1.Token(raydium_sdk_1.TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals);
        const slippage = new raydium_sdk_1.Percent(1000, 10000); // 20% slippage
        const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } = raydium_sdk_1.Liquidity.computeAmountOut({
            poolKeys,
            poolInfo,
            amountIn,
            currencyOut,
            slippage,
        });
        return {
            amountIn,
            amountOut,
            minAmountOut,
            currentPrice,
            executionPrice,
            priceImpact,
            fee,
        };
    }
}
exports.default = RaydiumSwap;
