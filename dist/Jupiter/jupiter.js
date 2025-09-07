"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const axios_1 = __importDefault(require("axios"));
const bs58_1 = __importDefault(require("bs58"));
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@coral-xyz/anchor");
const config_1 = require("../config");
const logger_1 = require("../util/logger");
const helper_1 = require("../util/helper");
const notifier_1 = require("../util/notifier");
const db_1 = require("../util/db");
const WSOL = "So11111111111111111111111111111111111111112";
function toLamports(sol) {
    return Math.floor(sol * 1e9);
}
async function getTokenAccountLamports(pubkey) {
    const bal = await config_1.connection.getTokenAccountBalance(pubkey);
    return {
        lamports: BigInt(bal.value.amount),
        decimals: bal.value.decimals,
    };
}
async function jupiterToken(signal, signalNumber) {
    const tlog = (0, logger_1.childLogger)(logger_1.tradeLogger, 'Jupiter');
    try {
        if (!config_1.solanaWallets[0]) {
            tlog.error("No Solana private key configured. Set `SOLANA_WALLETS` (comma-separated) or `SOL_PRIVATE_KEY`. ");
            return;
        }
        const wallet = new anchor_1.Wallet(web3_js_1.Keypair.fromSecretKey(Uint8Array.from(bs58_1.default.decode(config_1.solanaWallets[0]))));
        const isSell = signal.action.toLowerCase() === 'sell';
        const inputMint = isSell ? signal.contractAddress : WSOL;
        const outputMint = isSell ? WSOL : signal.contractAddress;
        // Amount in smallest units of input token
        let amountInLamports;
        let initialTokenLamports;
        let tokenDecimals;
        if (!isSell) {
            // Buy: signal.amount like "0.00123 SOL"
            const solStr = String(signal.amount || '').split(' ')[0];
            const sol = Number(solStr);
            if (!Number.isFinite(sol) || sol <= 0) {
                throw new Error(`Invalid SOL amount in signal: ${signal.amount}`);
            }
            amountInLamports = BigInt(toLamports(sol));
            // Track token account before buy to compute purchased amount later
            const accountAddress = await (0, helper_1.getTokenAccountByOwnerAndMint)(config_1.solanaWallets[0], outputMint);
            if (accountAddress !== 'empty' && accountAddress?.value?.[0]?.pubkey) {
                const { lamports, decimals } = await getTokenAccountLamports(accountAddress.value[0].pubkey);
                initialTokenLamports = lamports;
                tokenDecimals = decimals;
            }
            else {
                initialTokenLamports = 0n;
            }
        }
        else {
            // Sell: signal.amount is percent string (e.g., '100')
            const percent = Math.max(0, Math.min(100, Number(String(signal.amount || '100'))));
            // Fetch token balance of input mint
            const accountAddress = await (0, helper_1.getTokenAccountByOwnerAndMint)(config_1.solanaWallets[0], inputMint);
            if (accountAddress === 'empty' || !accountAddress?.value?.[0]?.pubkey) {
                await (0, notifier_1.notify)(`⚠️ No token account to sell for ${inputMint}`);
                return;
            }
            const { lamports, decimals } = await getTokenAccountLamports(accountAddress.value[0].pubkey);
            tokenDecimals = decimals;
            const sellLamports = (lamports * BigInt(Math.floor(percent))) / 100n;
            if (sellLamports <= 0) {
                await (0, notifier_1.notify)(`⚠️ Nothing to sell for ${inputMint}`);
                return;
            }
            amountInLamports = sellLamports;
        }
        const quoteUrl = new URL(`/v6/quote`, config_1.JUPITER_BASE_URL);
        quoteUrl.searchParams.set('inputMint', inputMint);
        quoteUrl.searchParams.set('outputMint', outputMint);
        quoteUrl.searchParams.set('amount', amountInLamports.toString());
        quoteUrl.searchParams.set('slippageBps', String(config_1.SLIPPAGE_BPS));
        quoteUrl.searchParams.set('swapMode', 'ExactIn');
        quoteUrl.searchParams.set('onlyDirectRoutes', 'false');
        quoteUrl.searchParams.set('asLegacyTransaction', 'false');
        tlog.info('Requesting quote');
        const quoteResp = await axios_1.default.get(quoteUrl.toString(), { timeout: 20000 }).then(r => r.data);
        if (!quoteResp || !quoteResp.routes || quoteResp.routes.length === 0) {
            await (0, notifier_1.notify)(`⚠️ No route found via Jupiter for ${inputMint} -> ${outputMint}`);
            return;
        }
        const route = quoteResp.routes[0];
        const swapUrl = new URL(`/v6/swap`, config_1.JUPITER_BASE_URL);
        const swapBody = {
            quoteResponse: route,
            userPublicKey: wallet.publicKey.toBase58(),
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: config_1.PRIORITY_FEE_LAMPORTS,
        };
        tlog.info('Building swap transaction');
        const swapResp = await axios_1.default.post(swapUrl.toString(), swapBody, { timeout: 20000 }).then(r => r.data);
        const swapTxB64 = swapResp?.swapTransaction;
        if (!swapTxB64)
            throw new Error('Jupiter: missing swapTransaction');
        const tx = web3_js_1.VersionedTransaction.deserialize(Buffer.from(swapTxB64, 'base64'));
        tx.sign([wallet.payer]);
        const sig = await config_1.connection.sendTransaction(tx, { skipPreflight: false });
        const conf = await config_1.connection.confirmTransaction(sig, 'confirmed');
        if (conf.value.err)
            throw new Error(`Transaction failed: ${JSON.stringify(conf.value.err)}`);
        tlog.info('Swap success', { url: `https://solscan.io/tx/${sig}` });
        await (0, notifier_1.notifySwapResult)({ action: isSell ? 'sell' : 'buy', token: isSell ? inputMint : outputMint, amount: isSell ? undefined : Number(String(signal.amount).split(' ')[0] || '0'), success: true, txid: String(sig) });
        if (!isSell) {
            try {
                // Derive purchased amount and store price
                // Fetch final balance of output token
                const accountAddress = await (0, helper_1.getTokenAccountByOwnerAndMint)(config_1.solanaWallets[0], outputMint);
                if (accountAddress !== 'empty' && accountAddress?.value?.[0]?.pubkey) {
                    const { lamports, decimals } = await getTokenAccountLamports(accountAddress.value[0].pubkey);
                    const prev = initialTokenLamports ?? 0n;
                    const boughtLamports = lamports > prev ? (lamports - prev) : 0n;
                    const bought = Number(boughtLamports) / 10 ** (decimals ?? tokenDecimals ?? 9);
                    const solPrice = (await (0, helper_1.getSolanaTokenPrice)(WSOL))?.usdPrice || 0;
                    const solSpent = Number(amountInLamports) / 1e9;
                    const tokenUsdPrice = bought > 0 ? (solPrice * solSpent) / bought : undefined;
                    const price = (tokenUsdPrice != null && Number.isFinite(tokenUsdPrice)) ? tokenUsdPrice : 0;
                    db_1.buyActions.push({
                        signalNumber: signalNumber,
                        contractAdress: outputMint,
                        price,
                        platform: signal.platform.toString(),
                        chain: 'solana'
                    });
                    await (0, notifier_1.notify)(`✅ Buy recorded\nToken: ${outputMint}\nEst. price: ${price ? `$${price.toFixed(8)}` : 'n/a'}\nTx: https://solscan.io/tx/${sig}`);
                }
            }
            catch (_) { }
        }
        else {
            // Record sell action like Raydium path so DB updateSells works
            db_1.sellActions.push({ id: signal.id, contractAddress: signal.contractAddress, priceFactor: signal.priceFactor });
        }
    }
    catch (err) {
        tlog.error('Jupiter swap error', err);
        try {
            await (0, notifier_1.notifySwapResult)({ action: signal?.action || 'buy', token: signal?.contractAddress?.toString?.() ?? 'unknown', amount: Number(String(signal?.amount || '').split(' ')[0] || '0'), success: false, error: err });
        }
        catch { }
    }
}
exports.default = jupiterToken;
