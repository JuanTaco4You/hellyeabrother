import dotenv from 'dotenv';
dotenv.config();

import jupiterToken from '../Jupiter/jupiter';
import { signal } from '../util/types';
import { childLogger, tradeLogger } from '../util/logger';

async function main() {
  const log = childLogger(tradeLogger, 'JupiterTest');
  const mint = process.argv[2] || 'FH92SMAdri2SYzxUvYF6f7PxURjeaj9GWJQUZ8VUe2EU';
  const sol = Number(process.argv[3] || '0.001');
  if (!Number.isFinite(sol) || sol <= 0) {
    throw new Error('Provide a positive SOL amount, e.g., 0.001');
  }
  const sig: signal = {
    id: Date.now(),
    contractAddress: mint,
    action: 'buy',
    amount: `${sol} SOL`,
    platform: 'raydium',
    chain: 'solana',
    timestamp: new Date().toISOString()
  };
  log.info('Starting test swap', { mint, sol });
  await jupiterToken(sig, 0);
}

main().catch((e) => {
  const log = childLogger(tradeLogger, 'JupiterTest');
  log.error('Test swap failed', e);
  process.exit(1);
});

