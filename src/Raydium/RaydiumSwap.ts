import {  
  PublicKey, 
  Keypair, 
  VersionedTransaction, 
  TransactionMessage, 
  TransactionInstruction,
} from '@solana/web3.js';
import {
  Liquidity,
  LiquidityPoolKeys,
  Token,
  TokenAmount,
  TOKEN_PROGRAM_ID,
  Percent,
  SPL_ACCOUNT_LAYOUT,
  LIQUIDITY_STATE_LAYOUT_V4,
  LIQUIDITY_STATE_LAYOUT_V5,
  Market as RayMarket,
} from '@raydium-io/raydium-sdk';
import axios from "axios"
import { Wallet } from '@coral-xyz/anchor';
import bs58 from 'bs58'
import dotenv from "dotenv";
dotenv.config();
import { tradeLogger, childLogger } from "../util/logger";

const FALCONHIT_API_KEY = process.env.FALCONHIT_API_KEY

import { connection } from '../config';  
import { Delay } from '../util/helper';
import { poolInfoDataType } from '../util/types';
import swapConfig from './swapConfig';
/**
 * Class representing a Raydium Swap operation.
 */
class RaydiumSwap {
  wallet: Wallet
   /**
   * Create a RaydiumSwap instance.
   * @param {string} WALLET_PRIVATE_KEY - The private key of the wallet in base58 format.
   */
  constructor(WALLET_PRIVATE_KEY: string) {
    this.wallet = new Wallet(Keypair.fromSecretKey(Uint8Array.from(bs58.decode(WALLET_PRIVATE_KEY))))
    childLogger(tradeLogger, 'RaydiumSwap').info("Wallet initialized", { publicKey: this.wallet.publicKey.toBase58() });
    this.wallet.payer
  }
  
  /**
   * Gets pool information for the given token pair using Raydium's official liquidity list.
   * @async
   * @param {string} mintA - The mint address of the first token.
   * @param {string} mintB - The mint address of the second token.
   * @returns {LiquidityPoolKeys | null}
   */
  async getPoolInfoByTokenPair(mintA: string, mintB: string) {
    const tlog = childLogger(tradeLogger, 'RaydiumSwap');
    tlog.debug("Using Raydium liquidity list", { url: swapConfig.liquidityFile });
    const normalize = (s: string) => s.trim();
    const a = normalize(mintA);
    const b = normalize(mintB);

    for (let i = 0; i < 3; i++) {
      try {
        const { data } = await axios.get(swapConfig.liquidityFile, { headers: { 'Cache-Control': 'no-cache' } });
        if (!Array.isArray(data)) {
          tlog.warn('Unexpected Raydium liquidity response shape');
          break;
        }

        // Prefer exact base/quote match; fall back to reversed order
        const match = data.find((p: any) => p.baseMint === a && p.quoteMint === b) ||
                      data.find((p: any) => p.baseMint === b && p.quoteMint === a);

        if (!match) break;

        tlog.info('Found pool info');
        const poolInfoData: LiquidityPoolKeys = {
          id: new PublicKey(match.id),
          baseMint: new PublicKey(match.baseMint),
          quoteMint: new PublicKey(match.quoteMint),
          lpMint: new PublicKey(match.lpMint),
          baseDecimals: match.baseDecimals,
          quoteDecimals: match.quoteDecimals,
          lpDecimals: match.lpDecimals,
          version: match.version,
          programId: new PublicKey(match.programId),
          authority: new PublicKey(match.authority),
          openOrders: new PublicKey(match.openOrders),
          targetOrders: new PublicKey(match.targetOrders),
          baseVault: new PublicKey(match.baseVault),
          quoteVault: new PublicKey(match.quoteVault),
          withdrawQueue: new PublicKey(match.withdrawQueue),
          lpVault: new PublicKey(match.lpVault),
          marketVersion: match.marketVersion,
          marketProgramId: new PublicKey(match.marketProgramId),
          marketId: new PublicKey(match.marketId),
          marketAuthority: new PublicKey(match.marketAuthority),
          marketBaseVault: new PublicKey(match.marketBaseVault),
          marketQuoteVault: new PublicKey(match.marketQuoteVault),
          marketBids: new PublicKey(match.marketBids),
          marketAsks: new PublicKey(match.marketAsks),
          marketEventQueue: new PublicKey(match.marketEventQueue),
          lookupTableAccount: match.lookupTableAccount,
        }
        return poolInfoData as LiquidityPoolKeys;
      } catch (err) {
        await Delay(1000);
        tlog.error("get Pool info", err);
      }
    }
    // Fallback: on-chain discovery via program accounts (new/unsynced pools)
    return await this.getPoolInfoOnChain(a, b);
  }

  /**
   * On-chain fallback: search Raydium AMM program accounts for a pool matching the mint pair.
   */
  private async getPoolInfoOnChain(mintA: string, mintB: string): Promise<LiquidityPoolKeys | null> {
    const tlog = childLogger(tradeLogger, 'RaydiumSwap');
    try {
      const PROGRAMS = [
        new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'), // mainnet
        new PublicKey('HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8'), // devnet
      ];
      const V4 = { base: 400, quote: 432, span: LIQUIDITY_STATE_LAYOUT_V4.span } as const;
      const V5 = { base: 432, quote: 464, span: LIQUIDITY_STATE_LAYOUT_V5.span } as const;

      const tryFind = async (programId: PublicKey, v: { base: number, quote: number, span: number }, mA: string, mB: string) => {
        const filters: any[] = [
          { dataSize: v.span },
          { memcmp: { offset: v.base, bytes: mA } },
          { memcmp: { offset: v.quote, bytes: mB } },
        ];
        const accs = await connection.getProgramAccounts(programId, { filters });
        return accs?.[0];
      };

      for (const programId of PROGRAMS) {
        // Try V5 exact order, then reversed
        let found = await tryFind(programId, V5, mintA, mintB)
          || await tryFind(programId, V5, mintB, mintA)
          || await tryFind(programId, V4, mintA, mintB)
          || await tryFind(programId, V4, mintB, mintA);

        if (!found) continue;

        const isV4 = found.account.data.length === V4.span;
        const state = isV4 ? LIQUIDITY_STATE_LAYOUT_V4.decode(found.account.data) : LIQUIDITY_STATE_LAYOUT_V5.decode(found.account.data);
        const version = (isV4 ? 4 : 5) as 4 | 5;

        const keys = Liquidity.getAssociatedPoolKeys({
          version,
          marketVersion: 3,
          marketId: state.marketId,
          marketProgramId: state.marketProgramId,
          baseMint: state.baseMint,
          baseDecimals: Number((state.baseDecimal as any).toNumber?.() ?? state.baseDecimal),
          quoteMint: state.quoteMint,
          quoteDecimals: Number((state.quoteDecimal as any).toNumber?.() ?? state.quoteDecimal),
          programId,
        });

        // Basic sanity: derived LP must match state
        if (keys.lpMint.toBase58() !== state.lpMint.toBase58()) {
          tlog.warn('On-chain fallback: derived keys mismatch lpMint');
          continue;
        }
        // Derive market vaults and queues from market state
        const marketAccountInfo = await connection.getAccountInfo(keys.marketId);
        if (!marketAccountInfo) {
          tlog.warn('On-chain fallback: market account not found');
          continue;
        }
        const marketState = RayMarket.getLayouts(keys.marketVersion).state.decode(marketAccountInfo.data);
        const poolInfoData: LiquidityPoolKeys = {
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
    } catch (err) {
      childLogger(tradeLogger, 'RaydiumSwap').error('On-chain pool discovery failed', err);
      return null;
    }
  }

    /**
   * Retrieves token accounts owned by the wallet.
   * @async
   * @returns {Promise<TokenAccount[]>} An array of token accounts.
   */
  async getOwnerTokenAccounts() {
    const walletTokenAccount = await connection.getTokenAccountsByOwner(this.wallet.publicKey, {
      programId: TOKEN_PROGRAM_ID,
    })

    return walletTokenAccount.value.map((i) => ({
      pubkey: i.pubkey,
      programId: i.account.owner,
      accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
    }))
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
  async getSwapTransaction(
    toToken: string,
    // fromToken: string,
    amount: number,
    poolKeys: LiquidityPoolKeys,
    maxLamports: number = 100000,
    useVersionedTransaction = true,
    fixedSide: 'in' | 'out' = 'in'
  ) {
    const directionIn = poolKeys.quoteMint.toString() == toToken
    const { minAmountOut, amountIn } = await this.calcAmountOut(poolKeys, amount, directionIn)
    // console.log({ minAmountOut, amountIn });
    const userTokenAccounts = await this.getOwnerTokenAccounts()
    const swapTransaction = await Liquidity.makeSwapInstructionSimple({
      connection: connection,
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
    })

    // return swapTransaction.innerTransactions;
    const instructions: TransactionInstruction[] = swapTransaction.innerTransactions[0].instructions.filter(Boolean)
    return instructions as TransactionInstruction[]
  }

  /**
   * 
   */
  async createVersionedTransaction(instructions: TransactionInstruction[]) {

    const recentBlockhashForSwap = await connection.getLatestBlockhash()
    
    const versionedTransaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: this.wallet.publicKey,
        instructions: instructions,
        recentBlockhash: recentBlockhashForSwap.blockhash,
      }).compileToV0Message()
    )

    versionedTransaction.sign([this.wallet.payer])

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
  async sendVersionedTransaction(tx: VersionedTransaction, maxRetries: number, recentBlockhashForSwap: any) {
     
    const txid = await connection.sendTransaction(tx)

    // return txid;
   
    const confirmation = await connection.confirmTransaction({
      blockhash: recentBlockhashForSwap.blockhash,
      lastValidBlockHeight: recentBlockhashForSwap.lastValidBlockHeight,
      signature: txid,
    }, 'finalized');
    if (confirmation.value.err) { throw new Error("   ❌ - Transaction not confirmed.") }
    childLogger(tradeLogger, 'RaydiumSwap').info('Transaction confirmed', { url: `https://solscan.io/tx/${txid}` });
    return txid;
  }

    /**
   * Simulates a versioned transaction.
   * @async
   * @param {VersionedTransaction} tx - The versioned transaction to simulate.
   * @returns {Promise<any>} The simulation result.
   */
  async simulateVersionedTransaction(tx: VersionedTransaction) {
    const txid = await connection.simulateTransaction(tx)
    return txid
  }

    /**
   * Gets a token account by owner and mint address.
   * @param {PublicKey} mint - The mint address of the token.
   * @returns {TokenAccount} The token account.
   */
  getTokenAccountByOwnerAndMint(mint: PublicKey) {
    return {
      programId: TOKEN_PROGRAM_ID,
      pubkey: PublicKey.default,
      accountInfo: {
        mint: mint,
        amount: 0,
      },
    }
  }

  
    /**
   * Calculates the amount out for a swap.
   * @async
   * @param {LiquidityPoolKeys} poolKeys - The liquidity pool keys.
   * @param {number} rawAmountIn - The raw amount of the input token.
   * @param {boolean} swapInDirection - The direction of the swap (true for in, false for out).
   * @returns {Promise<Object>} The swap calculation result.
   */
  async calcAmountOut(poolKeys: LiquidityPoolKeys, rawAmountIn: number, swapInDirection: boolean) {
    const poolInfo = await Liquidity.fetchInfo({ connection: connection, poolKeys })

    let currencyInMint = poolKeys.baseMint
    let currencyInDecimals = poolInfo.baseDecimals
    let currencyOutMint = poolKeys.quoteMint
    let currencyOutDecimals = poolInfo.quoteDecimals

    if (!swapInDirection) {
      currencyInMint = poolKeys.quoteMint
      currencyInDecimals = poolInfo.quoteDecimals
      currencyOutMint = poolKeys.baseMint
      currencyOutDecimals = poolInfo.baseDecimals
    }

    const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals)
    const amountIn = new TokenAmount(currencyIn, rawAmountIn, false)
    const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals)
    const slippage = new Percent(1000, 10_000) // 20% slippage

    const { amountOut, minAmountOut, currentPrice, executionPrice, priceImpact, fee } = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut,
      slippage,
    })

    return {
      amountIn,
      amountOut,
      minAmountOut,
      currentPrice,
      executionPrice,
      priceImpact,
      fee,
    }
  }
}

export  default RaydiumSwap;
