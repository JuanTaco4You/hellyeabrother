import dotenv from "dotenv";
dotenv.config();

import axios from "axios";
import bs58 from "bs58";
import { VersionedTransaction, PublicKey, Keypair } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";

import { connection, solanaWallets, SLIPPAGE_BPS, JUPITER_BASE_URL, PRIORITY_FEE_LAMPORTS } from "../config";
import { childLogger, tradeLogger } from "../util/logger";
import { getTokenAccountByOwnerAndMint, getTokenBalance, getSolanaTokenPrice } from "../util/helper";
import { signal } from "../util/types";
import { notify, notifySwapResult } from "../util/notifier";
import { buyActions, sellActions } from "../util/db";

const WSOL = "So11111111111111111111111111111111111111112";

function toLamports(sol: number): number {
  return Math.floor(sol * 1e9);
}

async function getTokenAccountLamports(pubkey: PublicKey) {
  const bal = await connection.getTokenAccountBalance(pubkey);
  return {
    lamports: BigInt(bal.value.amount),
    decimals: bal.value.decimals,
  };
}

export default async function jupiterToken(signal: signal, signalNumber: number) {
  const tlog = childLogger(tradeLogger, 'Jupiter');
  try {
    if (!solanaWallets[0]) {
      tlog.error("No Solana private key configured. Set `SOLANA_WALLETS` (comma-separated) or `SOL_PRIVATE_KEY`. ");
      return;
    }

    const wallet = new Wallet(Keypair.fromSecretKey(Uint8Array.from(bs58.decode(solanaWallets[0]))));

    const isSell = signal.action.toLowerCase() === 'sell';
    const inputMint = isSell ? signal.contractAddress : WSOL;
    const outputMint = isSell ? WSOL : signal.contractAddress;

    // Amount in smallest units of input token
    let amountInLamports: bigint;
    let initialTokenLamports: bigint | undefined;
    let tokenDecimals: number | undefined;

    if (!isSell) {
      // Buy: signal.amount like "0.00123 SOL"
      const solStr = String(signal.amount || '').split(' ')[0];
      const sol = Number(solStr);
      if (!Number.isFinite(sol) || sol <= 0) {
        throw new Error(`Invalid SOL amount in signal: ${signal.amount}`);
      }
      amountInLamports = BigInt(toLamports(sol));
      // Track token account before buy to compute purchased amount later
      const accountAddress = await getTokenAccountByOwnerAndMint(solanaWallets[0], outputMint);
      if (accountAddress !== 'empty' && accountAddress?.value?.[0]?.pubkey) {
        const { lamports, decimals } = await getTokenAccountLamports(accountAddress.value[0].pubkey);
        initialTokenLamports = lamports;
        tokenDecimals = decimals;
      } else {
        initialTokenLamports = 0n;
      }
    } else {
      // Sell: signal.amount is percent string (e.g., '100')
      const percent = Math.max(0, Math.min(100, Number(String(signal.amount || '100'))));
      // Fetch token balance of input mint
      const accountAddress = await getTokenAccountByOwnerAndMint(solanaWallets[0], inputMint);
      if (accountAddress === 'empty' || !accountAddress?.value?.[0]?.pubkey) {
        await notify(`⚠️ No token account to sell for ${inputMint}`);
        return;
      }
      const { lamports, decimals } = await getTokenAccountLamports(accountAddress.value[0].pubkey);
      tokenDecimals = decimals;
      const sellLamports = (lamports * BigInt(Math.floor(percent))) / 100n;
      if (sellLamports <= 0) {
        await notify(`⚠️ Nothing to sell for ${inputMint}`);
        return;
      }
      amountInLamports = sellLamports;
    }

    const quoteUrl = new URL(`/v6/quote`, JUPITER_BASE_URL);
    quoteUrl.searchParams.set('inputMint', inputMint);
    quoteUrl.searchParams.set('outputMint', outputMint);
    quoteUrl.searchParams.set('amount', amountInLamports.toString());
    quoteUrl.searchParams.set('slippageBps', String(SLIPPAGE_BPS));
    quoteUrl.searchParams.set('swapMode', 'ExactIn');
    quoteUrl.searchParams.set('onlyDirectRoutes', 'false');
    quoteUrl.searchParams.set('asLegacyTransaction', 'false');

    tlog.info('Requesting quote');
    const quoteResp = await axios.get(quoteUrl.toString(), { timeout: 20000 }).then(r => r.data);
    if (!quoteResp || !quoteResp.routes || quoteResp.routes.length === 0) {
      await notify(`⚠️ No route found via Jupiter for ${inputMint} -> ${outputMint}`);
      return;
    }

    const route = quoteResp.routes[0];
    const swapUrl = new URL(`/v6/swap`, JUPITER_BASE_URL);
    const swapBody: any = {
      quoteResponse: route,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: PRIORITY_FEE_LAMPORTS,
    };

    tlog.info('Building swap transaction');
    const swapResp = await axios.post(swapUrl.toString(), swapBody, { timeout: 20000 }).then(r => r.data);
    const swapTxB64 = swapResp?.swapTransaction;
    if (!swapTxB64) throw new Error('Jupiter: missing swapTransaction');

    const tx = VersionedTransaction.deserialize(Buffer.from(swapTxB64, 'base64'));
    tx.sign([wallet.payer]);

    const sig = await connection.sendTransaction(tx, { skipPreflight: false });
    const conf = await connection.confirmTransaction(sig, 'confirmed');
    if (conf.value.err) throw new Error(`Transaction failed: ${JSON.stringify(conf.value.err)}`);

    tlog.info('Swap success', { url: `https://solscan.io/tx/${sig}` });
    await notifySwapResult({ action: isSell ? 'sell' : 'buy', token: isSell ? inputMint : outputMint, amount: isSell ? undefined : Number(String(signal.amount).split(' ')[0] || '0'), success: true, txid: String(sig) });

    if (!isSell) {
      try {
        // Derive purchased amount and store price
        // Fetch final balance of output token
        const accountAddress = await getTokenAccountByOwnerAndMint(solanaWallets[0], outputMint);
        if (accountAddress !== 'empty' && accountAddress?.value?.[0]?.pubkey) {
          const { lamports, decimals } = await getTokenAccountLamports(accountAddress.value[0].pubkey);
          const prev = initialTokenLamports ?? 0n;
          const boughtLamports = lamports > prev ? (lamports - prev) : 0n;
          const bought = Number(boughtLamports) / 10 ** (decimals ?? tokenDecimals ?? 9);
          const solPrice = (await getSolanaTokenPrice(WSOL))?.usdPrice || 0;
          const solSpent = Number(amountInLamports) / 1e9;
          const tokenUsdPrice = bought > 0 ? (solPrice * solSpent) / bought : undefined;
          const price = (tokenUsdPrice != null && Number.isFinite(tokenUsdPrice)) ? tokenUsdPrice : 0;
          buyActions.push({
            signalNumber: signalNumber,
            contractAdress: outputMint,
            price,
            platform: signal.platform.toString(),
            chain: 'solana'
          });
          await notify(`✅ Buy recorded\nToken: ${outputMint}\nEst. price: ${price ? `$${price.toFixed(8)}` : 'n/a'}\nTx: https://solscan.io/tx/${sig}`);
        }
      } catch (_) {}
    } else {
      // Record sell action like Raydium path so DB updateSells works
      sellActions.push({ id: signal.id, contractAddress: signal.contractAddress, priceFactor: signal.priceFactor });
    }
  } catch (err) {
    tlog.error('Jupiter swap error', err);
    try {
      await notifySwapResult({ action: (signal?.action as any) || 'buy', token: (signal?.contractAddress as any)?.toString?.() ?? 'unknown', amount: Number(String(signal?.amount || '').split(' ')[0] || '0'), success: false, error: err });
    } catch {}
  }
}
