"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const jupiter_1 = __importDefault(require("../Jupiter/jupiter"));
const logger_1 = require("../util/logger");
async function main() {
    const log = (0, logger_1.childLogger)(logger_1.tradeLogger, 'JupiterTest');
    const mint = process.argv[2] || 'FH92SMAdri2SYzxUvYF6f7PxURjeaj9GWJQUZ8VUe2EU';
    const sol = Number(process.argv[3] || '0.001');
    if (!Number.isFinite(sol) || sol <= 0) {
        throw new Error('Provide a positive SOL amount, e.g., 0.001');
    }
    const sig = {
        id: Date.now(),
        contractAddress: mint,
        action: 'buy',
        amount: `${sol} SOL`,
        platform: 'raydium',
        chain: 'solana',
        timestamp: new Date().toISOString()
    };
    log.info('Starting test swap', { mint, sol });
    await (0, jupiter_1.default)(sig, 0);
}
main().catch((e) => {
    const log = (0, logger_1.childLogger)(logger_1.tradeLogger, 'JupiterTest');
    log.error('Test swap failed', e);
    process.exit(1);
});
