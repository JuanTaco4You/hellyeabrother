"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.swap = exports.sendAndConfirmTransaction = exports.getPubkeyFromStr = exports.sleep = void 0;
const anchor_1 = require("@project-serum/anchor");
const web3_js_1 = require("@solana/web3.js");
const raydium_sdk_1 = require("@raydium-io/raydium-sdk");
const spl_token_1 = require("@solana/spl-token");
const anchor_2 = require("@project-serum/anchor");
const bigint_buffer_1 = require("bigint-buffer");
const dotenv_1 = __importDefault(require("dotenv"));
const logger_1 = require("../util/logger");
dotenv_1.default.config();
const tlog = (0, logger_1.childLogger)(logger_1.tradeLogger, 'RaydiumDEX');
const log = (...args) => tlog.debug('log', args);
// Configure RPC endpoints from env with sensible defaults
const RPC_ENDPOINT = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_URL || undefined;
const DEV_NET_RPC = "https://api.devnet.solana.com";
const solanaConnection = new web3_js_1.Connection(RPC_ENDPOINT, {
    wsEndpoint: WEBSOCKET_ENDPOINT,
    confirmTransactionInitialTimeout: 30000,
    commitment: "confirmed",
});
const devConnection = new web3_js_1.Connection(DEV_NET_RPC);
class BaseRay {
    constructor(input) {
        this.reInit = () => this.cacheIxs = [];
        this.connection = new anchor_1.web3.Connection(input.rpcEndpointUrl, { commitment: "confirmed", confirmTransactionInitialTimeout: 60000 });
        this.cacheIxs = [];
        this.cachedPoolKeys = new Map();
        this.pools = new Map();
        if (input.rpcEndpointUrl == "https://api.devnet.solana.com" || input.rpcEndpointUrl == DEV_NET_RPC) {
            this.ammProgramId = new anchor_1.web3.PublicKey("HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8");
            this.feeDestinationId = new anchor_1.web3.PublicKey("3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR");
            this.orderBookProgramId = new anchor_1.web3.PublicKey("EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj");
        }
        else {
            this.ammProgramId = new anchor_1.web3.PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
            this.feeDestinationId = new anchor_1.web3.PublicKey("7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5");
            this.orderBookProgramId = new anchor_1.web3.PublicKey("srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX");
        }
    }
    async getPoolKeys(poolId) {
        if (!this.pools)
            this.pools = new Map();
        if (!this.cachedPoolKeys)
            this.cachedPoolKeys = new Map();
        const cache2 = this.cachedPoolKeys.get(poolId.toBase58());
        if (cache2) {
            return cache2;
        }
        // const cache = this.pools.get(poolId.toBase58())
        // if (cache) {
        //   return jsonInfo2PoolKeys(cache) as LiquidityPoolKeys
        // }
        const accountInfo = await this.connection.getAccountInfo(poolId);
        if (!accountInfo)
            throw "Pool info not found";
        let poolState = undefined;
        let version = undefined;
        let poolAccountOwner = accountInfo.owner;
        if (accountInfo.data.length == raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4.span) {
            poolState = raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo.data);
            version = 4;
        }
        else if (accountInfo.data.length == raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V5.span) {
            poolState = raydium_sdk_1.LIQUIDITY_STATE_LAYOUT_V5.decode(accountInfo.data);
            version = 5;
        }
        else
            throw "Invalid Pool data length";
        if (!poolState || !version)
            throw "Invalid pool address";
        let { authority, baseDecimals, baseMint, baseVault, configId, id, lookupTableAccount, lpDecimals, lpMint, lpVault, marketAuthority, marketId, marketProgramId, marketVersion, nonce, openOrders, programId, quoteDecimals, quoteMint, quoteVault, targetOrders, 
        // version,
        withdrawQueue, } = raydium_sdk_1.Liquidity.getAssociatedPoolKeys({
            baseMint: poolState.baseMint,
            baseDecimals: poolState.baseDecimal.toNumber(),
            quoteMint: poolState.quoteMint,
            quoteDecimals: poolState.quoteDecimal.toNumber(),
            marketId: poolState.marketId,
            marketProgramId: poolState.marketProgramId,
            marketVersion: 3,
            programId: poolAccountOwner,
            version,
        });
        if (lpMint.toBase58() != poolState.lpMint.toBase58()) {
            throw "Found some invalid keys";
        }
        // log({ version, baseMint: baseMint.toBase58(), quoteMint: quoteMint.toBase58(), lpMint: lpMint.toBase58(), marketId: marketId.toBase58(), marketProgramId: marketProgramId.toBase58() })
        let marketState = undefined;
        const marketAccountInfo = await this.connection.getAccountInfo(marketId).catch((error) => null);
        if (!marketAccountInfo)
            throw "Market not found";
        try {
            marketState = raydium_sdk_1.Market.getLayouts(marketVersion).state.decode(marketAccountInfo.data);
            // if (mProgramIdStr != _SERUM_PROGRAM_ID_V3 && mProgramIdStr != _OPEN_BOOK_DEX_PROGRAM) {
            // }
        }
        catch (parseMeketDataError) {
            log({ parseMeketDataError });
        }
        if (!marketState)
            throw "MarketState not found";
        const { baseVault: marketBaseVault, quoteVault: marketQuoteVault, eventQueue: marketEventQueue, bids: marketBids, asks: marketAsks } = marketState;
        const res = {
            baseMint,
            quoteMint,
            quoteDecimals,
            baseDecimals,
            authority,
            baseVault,
            quoteVault,
            id,
            lookupTableAccount,
            lpDecimals,
            lpMint,
            lpVault,
            marketAuthority,
            marketId,
            marketProgramId,
            marketVersion,
            openOrders,
            programId,
            targetOrders,
            version,
            withdrawQueue,
            marketAsks,
            marketBids,
            marketBaseVault,
            marketQuoteVault,
            marketEventQueue,
        };
        this.cachedPoolKeys.set(poolId.toBase58(), res);
        // log({ poolKeys: res })
        return res;
    }
    async computeBuyAmount(input, etc) {
        const { amount, buyToken, inputAmountType, poolKeys, user } = input;
        const slippage = input.slippage ?? new raydium_sdk_1.Percent(1, 100);
        const base = poolKeys.baseMint;
        const baseMintDecimals = poolKeys.baseDecimals;
        const quote = poolKeys.quoteMint;
        const quoteMintDecimals = poolKeys.quoteDecimals;
        const baseTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(base, user);
        const quoteTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(quote, user);
        const baseR = new raydium_sdk_1.Token(spl_token_1.TOKEN_PROGRAM_ID, base, baseMintDecimals);
        const quoteR = new raydium_sdk_1.Token(spl_token_1.TOKEN_PROGRAM_ID, quote, quoteMintDecimals);
        let amountIn;
        let amountOut;
        let tokenAccountIn;
        let tokenAccountOut;
        const [lpAccountInfo, baseVAccountInfo, quoteVAccountInfo] = await this.connection.getMultipleAccountsInfo([poolKeys.lpMint, poolKeys.baseVault, poolKeys.quoteVault].map((e) => new anchor_1.web3.PublicKey(e))).catch(() => [null, null, null, null]);
        if (!lpAccountInfo || !baseVAccountInfo || !quoteVAccountInfo)
            throw "Failed to fetch some data";
        // const lpSupply = new BN(Number(MintLayout.decode(lpAccountInfo.data).supply.toString()))
        // const baseReserve = new BN(Number(AccountLayout.decode(baseVAccountInfo.data).amount.toString()))
        // const quoteReserve = new BN(Number(AccountLayout.decode(quoteVAccountInfo.data).amount.toString()))
        const lpSupply = new anchor_2.BN((0, bigint_buffer_1.toBufferBE)(spl_token_1.MintLayout.decode(lpAccountInfo.data).supply, 8)).addn(etc?.extraLpSupply ?? 0);
        const baseReserve = new anchor_2.BN((0, bigint_buffer_1.toBufferBE)(spl_token_1.AccountLayout.decode(baseVAccountInfo.data).amount, 8)).addn(etc?.extraBaseResever ?? 0);
        const quoteReserve = new anchor_2.BN((0, bigint_buffer_1.toBufferBE)(spl_token_1.AccountLayout.decode(quoteVAccountInfo.data).amount, 8)).addn(etc?.extraQuoteReserve ?? 0);
        let fixedSide;
        const poolInfo = {
            baseDecimals: poolKeys.baseDecimals,
            quoteDecimals: poolKeys.quoteDecimals,
            lpDecimals: poolKeys.lpDecimals,
            lpSupply,
            baseReserve,
            quoteReserve,
            startTime: null,
            status: null
        };
        if (inputAmountType == 'send') {
            fixedSide = 'in';
            if (buyToken == 'base') {
                amountIn = new raydium_sdk_1.TokenAmount(quoteR, amount.toString(), false);
                // amountOut = Liquidity.computeAmountOut({ amountIn, currencyOut: baseR, poolInfo, poolKeys, slippage }).amountOut
                amountOut = raydium_sdk_1.Liquidity.computeAmountOut({ amountIn, currencyOut: baseR, poolInfo, poolKeys, slippage }).minAmountOut;
            }
            else {
                amountIn = new raydium_sdk_1.TokenAmount(baseR, amount.toString(), false);
                // amountOut = Liquidity.computeAmountOut({ amountIn, currencyOut: quoteR, poolInfo, poolKeys, slippage }).amountOut
                amountOut = raydium_sdk_1.Liquidity.computeAmountOut({ amountIn, currencyOut: quoteR, poolInfo, poolKeys, slippage }).minAmountOut;
            }
        }
        else {
            fixedSide = 'out';
            if (buyToken == 'base') {
                amountOut = new raydium_sdk_1.TokenAmount(baseR, amount.toString(), false);
                // amountIn = Liquidity.computeAmountIn({ amountOut, currencyIn: quoteR, poolInfo, poolKeys, slippage }).amountIn
                amountIn = raydium_sdk_1.Liquidity.computeAmountIn({ amountOut, currencyIn: quoteR, poolInfo, poolKeys, slippage }).maxAmountIn;
            }
            else {
                amountOut = new raydium_sdk_1.TokenAmount(quoteR, amount.toString(), false);
                // amountIn = Liquidity.computeAmountIn({ amountOut, currencyIn: baseR, poolInfo, poolKeys, slippage }).amountIn
                amountIn = raydium_sdk_1.Liquidity.computeAmountIn({ amountOut, currencyIn: baseR, poolInfo, poolKeys, slippage }).maxAmountIn;
            }
        }
        if (buyToken == 'base') {
            tokenAccountOut = baseTokenAccount;
            tokenAccountIn = quoteTokenAccount;
        }
        else {
            tokenAccountOut = quoteTokenAccount;
            tokenAccountIn = baseTokenAccount;
        }
        return {
            amountIn,
            amountOut,
            tokenAccountIn,
            tokenAccountOut,
            fixedSide
        };
    }
    async buyFromPool(input) {
        this.reInit();
        const { amountIn, amountOut, poolKeys, user, fixedSide, tokenAccountIn, tokenAccountOut } = input;
        const inToken = amountIn.token.mint;
        tlog.debug('token accounts', { inToken: inToken.toBase58(), tokenAccountIn: tokenAccountIn.toBase58?.() ?? String(tokenAccountIn), tokenAccountOut: tokenAccountOut.toBase58?.() ?? String(tokenAccountOut) });
        if (inToken.toBase58() == spl_token_1.NATIVE_MINT.toBase58()) {
            let lamports = BigInt(amountIn.raw.toNumber());
            const sendSolIx = anchor_1.web3.SystemProgram.transfer({
                fromPubkey: user,
                toPubkey: tokenAccountIn,
                lamports
            });
            const syncWSolAta = (0, spl_token_1.createSyncNativeInstruction)(tokenAccountIn, spl_token_1.TOKEN_PROGRAM_ID);
            const idemportent = (0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(user, tokenAccountOut, user, poolKeys.baseMint);
            this.cacheIxs.push(sendSolIx, syncWSolAta, idemportent);
        }
        else {
            if (!await this.connection.getAccountInfo(tokenAccountOut))
                this.cacheIxs.push((0, spl_token_1.createAssociatedTokenAccountInstruction)(user, tokenAccountOut, user, spl_token_1.NATIVE_MINT));
        }
        let rayIxs = raydium_sdk_1.Liquidity.makeSwapInstruction({
            poolKeys,
            amountIn: amountIn.raw,
            amountOut: 0,
            fixedSide: 'in',
            userKeys: { owner: user, tokenAccountIn, tokenAccountOut },
        }).innerTransaction;
        if (inToken.toBase58() != spl_token_1.NATIVE_MINT.toBase58()) {
            const unwrapSol = (0, spl_token_1.createCloseAccountInstruction)(tokenAccountOut, user, user);
            rayIxs.instructions.push(unwrapSol);
        }
        const recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
        const message = new anchor_1.web3.TransactionMessage({
            instructions: [...this.cacheIxs, ...rayIxs.instructions],
            payerKey: user,
            recentBlockhash
        }).compileToV0Message();
        const mainTx = new anchor_1.web3.VersionedTransaction(message);
        const buysimRes = (await this.connection.simulateTransaction(mainTx));
        tlog.debug('inner buy simulation', buysimRes);
        if (rayIxs.signers)
            mainTx.signatures.push(...rayIxs.signers);
        return {
            ixs: [...this.cacheIxs, ...rayIxs.instructions],
            signers: [...rayIxs.signers]
        };
    }
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
exports.sleep = sleep;
function getPubkeyFromStr(str) {
    try {
        return new anchor_1.web3.PublicKey((str ?? "").trim());
    }
    catch (error) {
        return null;
    }
}
exports.getPubkeyFromStr = getPubkeyFromStr;
async function sendAndConfirmTransaction(tx, connection) {
    const rawTx = tx.serialize();
    const txSignature = (await anchor_1.web3.sendAndConfirmRawTransaction(connection, Buffer.from(rawTx), { commitment: 'confirmed', maxRetries: 4 })
        .catch(async () => {
        await sleep(500);
        return await anchor_1.web3.sendAndConfirmRawTransaction(connection, Buffer.from(rawTx), { commitment: 'confirmed' })
            .catch((txError) => {
            log({ txError });
            return null;
        });
    }));
    return txSignature;
}
exports.sendAndConfirmTransaction = sendAndConfirmTransaction;
async function swap(input) {
    if (input.sellToken) {
        if (input.sellToken == 'base') {
            input.buyToken = "quote";
        }
        else {
            input.buyToken = "base";
        }
    }
    const user = input.keypair.publicKey;
    const connection = new anchor_1.web3.Connection(input.url == 'mainnet' ? solanaConnection.rpcEndpoint : devConnection.rpcEndpoint, { commitment: "confirmed", confirmTransactionInitialTimeout: 60000 });
    const baseRay = new BaseRay({ rpcEndpointUrl: connection.rpcEndpoint });
    const slippage = input.slippage;
    const poolKeys = await baseRay.getPoolKeys(input.poolId).catch(getPoolKeysError => { log({ getPoolKeysError }); return null; });
    if (!poolKeys) {
        return { Err: "Pool info not found" };
    }
    log({
        baseToken: poolKeys.baseMint.toBase58(),
        quoteToken: poolKeys.quoteMint.toBase58(),
    });
    const { amount, amountSide, buyToken, } = input;
    const swapAmountInfo = await baseRay.computeBuyAmount({
        amount, buyToken, inputAmountType: amountSide, poolKeys, user, slippage
    }).catch((computeBuyAmountError => log({ computeBuyAmountError })));
    if (!swapAmountInfo)
        return { Err: "failed to calculate the amount" };
    const { amountIn, amountOut, fixedSide, tokenAccountIn, tokenAccountOut, } = swapAmountInfo;
    tlog.debug('swapAmountInfo', { amountIn, amountOut, fixedSide, tokenAccountIn, tokenAccountOut, });
    const txInfo = await baseRay.buyFromPool({ amountIn, amountOut, fixedSide, poolKeys, tokenAccountIn, tokenAccountOut, user }).catch(buyFromPoolError => { log({ buyFromPoolError }); return null; });
    if (!txInfo)
        return { Err: "failed to prepare swap transaction" };
    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const txMsg = new anchor_1.web3.TransactionMessage({
        instructions: txInfo.ixs,
        payerKey: user,
        recentBlockhash,
    }).compileToV0Message();
    const tx = new anchor_1.web3.VersionedTransaction(txMsg);
    tx.sign([input.keypair, ...txInfo.signers]);
    const buysimRes = (await connection.simulateTransaction(tx));
    tlog.debug('tx handler buy sim res', buysimRes);
    const txSignature = await sendAndConfirmTransaction(tx, connection).catch((sendAndConfirmTransactionError) => {
        log({ sendAndConfirmTransactionError });
        return null;
    });
    // const txSignature = await connection.sendTransaction(tx).catch((error) => { log({ createPoolTxError: error }); return null });
    if (!txSignature) {
        return { Err: "Failed to send transaction" };
    }
    return {
        Ok: {
            txSignature,
        }
    };
}
exports.swap = swap;
