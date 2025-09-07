"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRIORITY_FEE_LAMPORTS = exports.JUPITER_BASE_URL = exports.SLIPPAGE_BPS = exports.SWAP_ENGINE = exports.solanaWallets = exports.connection = exports.priceFactor = exports.sellInternalDuration = exports.msgCatchInternalDuration = exports.solBuyAmountRange = void 0;
const web3_js_1 = require("@solana/web3.js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.solBuyAmountRange = [0.00001, 0.00005];
exports.msgCatchInternalDuration = 20000;
exports.sellInternalDuration = 10000;
exports.priceFactor = [0.01, 2, 10];
const RPC_URL = process.env.RPC_URL; // ENTER YOUR RPC
const WEBSOCKET_URL = process.env.WEBSOCKET_URL;
exports.connection = new web3_js_1.Connection(RPC_URL, { wsEndpoint: WEBSOCKET_URL, confirmTransactionInitialTimeout: 30000, commitment: 'confirmed' });
// Load Solana wallet(s) from environment
// Preferred: `SOLANA_WALLETS` as a comma-separated list of base58 secret keys
// Fallback: single `SOL_PRIVATE_KEY` or `WALLET_PRIVATE_KEY`
const envWallets = (process.env.SOLANA_WALLETS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const singleWallet = (process.env.SOL_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || "").trim();
exports.solanaWallets = envWallets.length > 0
    ? envWallets
    : (singleWallet ? [singleWallet] : []);
// Swap engine selection and tuning (default to Jupiter for Phantom-like behavior)
exports.SWAP_ENGINE = (process.env.SWAP_ENGINE || 'jupiter').toLowerCase();
exports.SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS || 1500); // 15%
exports.JUPITER_BASE_URL = (process.env.JUPITER_BASE_URL || 'https://quote-api.jup.ag').trim();
// 'auto' or a number (lamports)
exports.PRIORITY_FEE_LAMPORTS = (() => {
    const v = (process.env.PRIORITY_FEE_LAMPORTS || 'auto').trim();
    if (v === 'auto')
        return 'auto';
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 'auto';
})();
