import { Connection } from "@solana/web3.js";
import dotenv from "dotenv";
dotenv.config();

export const solBuyAmountRange: number[] = [0.00001, 0.00005];
export const msgCatchInternalDuration = 20000;
export const sellInternalDuration = 10000;
export const priceFactor: number[] =  [0.01, 2, 10];

const RPC_URL: string = process.env.RPC_URL as string; // ENTER YOUR RPC
const WEBSOCKET_URL: string = process.env.WEBSOCKET_URL as string;

export const connection = new Connection(RPC_URL, { wsEndpoint: WEBSOCKET_URL, confirmTransactionInitialTimeout: 30000, commitment: 'confirmed' })

// Load Solana wallet(s) from environment
// Preferred: `SOLANA_WALLETS` as a comma-separated list of base58 secret keys
// Fallback: single `SOL_PRIVATE_KEY` or `WALLET_PRIVATE_KEY`
const envWallets = (process.env.SOLANA_WALLETS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const singleWallet = (process.env.SOL_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || "").trim();

export const solanaWallets: string[] = envWallets.length > 0
  ? envWallets
  : (singleWallet ? [singleWallet] : []);

// Swap engine selection and tuning (default to Jupiter for Phantom-like behavior)
export const SWAP_ENGINE = (process.env.SWAP_ENGINE || 'jupiter').toLowerCase();
export const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS || 1500); // 15%
export const JUPITER_BASE_URL = (process.env.JUPITER_BASE_URL || 'https://quote-api.jup.ag').trim();
// 'auto' or a number (lamports)
export const PRIORITY_FEE_LAMPORTS: 'auto' | number = (() => {
  const v = (process.env.PRIORITY_FEE_LAMPORTS || 'auto').trim();
  if (v === 'auto') return 'auto';
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 'auto';
})();
