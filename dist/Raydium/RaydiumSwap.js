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
const swapConfig_1 = __importDefault(require("./swapConfig"));
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
     * Gets pool information for the given token pair using Raydium's official liquidity list.
     * @async
     * @param {string} mintA - The mint address of the first token.
     * @param {string} mintB - The mint address of the second token.
     * @returns {LiquidityPoolKeys | null}
     */
    async getPoolInfoByTokenPair(mintA, mintB) {
        const tlog = (0, logger_1.childLogger)(logger_1.tradeLogger, 'RaydiumSwap');
        tlog.debug("Using Raydium liquidity list", { url: swapConfig_1.default.liquidityFile });
        const normalize = (s) => s.trim();
        const a = normalize(mintA);
        const b = normalize(mintB);
        for (let i = 0; i < 3; i++) {
            try {
                const { data } = await axios_1.default.get(swapConfig_1.default.liquidityFile, { headers: { 'Cache-Control': 'no-cache' } });
                if (!Array.isArray(data)) {
                    tlog.warn('Unexpected Raydium liquidity response shape');
                    break;
                }
                // Prefer exact base/quote match; fall back to reversed order
                const match = data.find((p) => p.baseMint === a && p.quoteMint === b) ||
                    data.find((p) => p.baseMint === b && p.quoteMint === a);
                if (!match)
                    break;
                tlog.info('Found pool info');
                const poolInfoData = {
                    id: new web3_js_1.PublicKey(match.id),
                    baseMint: new web3_js_1.PublicKey(match.baseMint),
                    quoteMint: new web3_js_1.PublicKey(match.quoteMint),
                    lpMint: new web3_js_1.PublicKey(match.lpMint),
                    baseDecimals: match.baseDecimals,
                    quoteDecimals: match.quoteDecimals,
                    lpDecimals: match.lpDecimals,
                    version: match.version,
                    programId: new web3_js_1.PublicKey(match.programId),
                    authority: new web3_js_1.PublicKey(match.authority),
                    openOrders: new web3_js_1.PublicKey(match.openOrders),
                    targetOrders: new web3_js_1.PublicKey(match.targetOrders),
                    baseVault: new web3_js_1.PublicKey(match.baseVault),
                    quoteVault: new web3_js_1.PublicKey(match.quoteVault),
                    withdrawQueue: new web3_js_1.PublicKey(match.withdrawQueue),
                    lpVault: new web3_js_1.PublicKey(match.lpVault),
                    marketVersion: match.marketVersion,
                    marketProgramId: new web3_js_1.PublicKey(match.marketProgramId),
                    marketId: new web3_js_1.PublicKey(match.marketId),
                    marketAuthority: new web3_js_1.PublicKey(match.marketAuthority),
                    marketBaseVault: new web3_js_1.PublicKey(match.marketBaseVault),
                    marketQuoteVault: new web3_js_1.PublicKey(match.marketQuoteVault),
                    marketBids: new web3_js_1.PublicKey(match.marketBids),
                    marketAsks: new web3_js_1.PublicKey(match.marketAsks),
                    marketEventQueue: new web3_js_1.PublicKey(match.marketEventQueue),
                    lookupTableAccount: match.lookupTableAccount,
                };
                return poolInfoData;
            }
            catch (err) {
                await (0, helper_1.Delay)(1000);
                tlog.error("get Pool info", err);
            }
        }
        // Fallback: on-chain discovery via program accounts (new/unsynced pools)
        return await this.getPoolInfoOnChain(a, b);
    }
    /**
     * On-chain fallback: search Raydium AMM program accounts for a pool matching the mint pair.
     */
    async getPoolInfoOnChain(mintA, mintB) {
        const tlog = (0, logger_1.childLogger)(logger_1.tradeLogger, 'RaydiumSwap');
        try {
            const PROGRAMS = [
                new web3_js_1.PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'), // mainnet
                new web3_js_1.PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8'), // devnet
            ];
            const V4 = { base: 400, quote: 432, span: raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4.span };
            const V5 = { base: 432, quote: 464, span: raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V5.span };
            const tryFind = async (programId, v, mA, mB) => {
                const filters = [
                    { dataSize: v.span },
                    { memcmp: { offset: v.base, bytes: mA } },
                    { memcmp: { offset: v.quote, bytes: mB } },
                ];
                const accs = await config_1.connection.getProgramAccounts(programId, { filters });
                return accs?.[0];
            };
            for (const programId of PROGRAMS) {
                // Try V5 exact order, then reversed
                let found = await tryFind(programId, V5, mintA, mintB)
                    || await tryFind(programId, V5, mintB, mintA)
                    || await tryFind(programId, V4, mintA, mintB)
                    || await tryFind(programId, V4, mintB, mintA);
                if (!found)
                    continue;
                const isV4 = found.account.data.length === V4.span;
                const state = isV4 ? raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4.decode(found.account.data) : raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V5.decode(found.account.data);
                const version = (isV4 ? 4 : 5);
                const keys = raydium_sdk_1.Liquidity.getAssociatedPoolKeys({
                    version,
                    marketVersion: 3,
                    marketId: state.marketId,
                    marketProgramId: state.marketProgramId,
                    baseMint: state.baseMint,
                    baseDecimals: Number(state.baseDecimal.toNumber?.() ?? state.baseDecimal),
                    quoteMint: state.quoteMint,
                    quoteDecimals: Number(state.quoteDecimal.toNumber?.() ?? state.quoteDecimal),
                    programId,
                });
                // Basic sanity: derived LP must match state
                if (keys.lpMint.toBase58() !== state.lpMint.toBase58()) {
                    tlog.warn('On-chain fallback: derived keys mismatch lpMint');
                    continue;
                }
                // Derive market vaults and queues from market state
                const marketAccountInfo = await config_1.connection.getAccountInfo(keys.marketId);
                if (!marketAccountInfo) {
                    tlog.warn('On-chain fallback: market account not found');
                    continue;
                }
                const marketState = raydium_sdk_1.Market.getLayouts(keys.marketVersion).state.decode(marketAccountInfo.data);
                const poolInfoData = {
                    id: keys.id,
                    baseMint: keys.baseMint,
                    quoteMint: keys.quoteMint,
                    lpMint: keys.lpMint,
                    baseDecimals: keys.baseDecimals,
                    quoteDecimals: keys.quoteDecimals,
                    lpDecimals: keys.lpDecimals,
                    version: keys.version,
                    programId: keys.programId,
                    authority: keys.authority,
                    openOrders: keys.openOrders,
                    targetOrders: keys.targetOrders,
                    baseVault: keys.baseVault,
                    quoteVault: keys.quoteVault,
                    withdrawQueue: keys.withdrawQueue,
                    lpVault: keys.lpVault,
                    marketVersion: keys.marketVersion,
                    marketProgramId: keys.marketProgramId,
                    marketId: keys.marketId,
                    marketAuthority: keys.marketAuthority,
                    marketBaseVault: marketState.baseVault,
                    marketQuoteVault: marketState.quoteVault,
                    marketBids: marketState.bids,
                    marketAsks: marketState.asks,
                    marketEventQueue: marketState.eventQueue,
                    lookupTableAccount: keys.lookupTableAccount,
                };
                tlog.info('On-chain fallback: Found pool info');
                return poolInfoData;
            }
            tlog.warn('On-chain fallback: No pool found', { mintA, mintB });
            return null;
        }
        catch (err) {
            (0, logger_1.childLogger)(logger_1.tradeLogger, 'RaydiumSwap').error('On-chain pool discovery failed', err);
            return null;
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
        return txid;
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
