import { childLogger, appLogger, tradeLogger } from './logger';
import { loadAllSignalSeen, upsertSignalSeen } from './db';

type Action = 'buy' | 'sell';

type TrackEntry = {
  firstAt: number;
  lastAt: number;
  count: number; // 1 = initial, 2 = first update, etc.
};

// Tracks signals seen in-memory across process lifetime (seeded from DB)
const seen: Map<string, TrackEntry> = new Map();
let initialized = false;

function keyFor(tokenAddress: string, action: Action) {
  return `${action}:${tokenAddress.toLowerCase()}`;
}

export function classifySignal(tokenAddress: string, action: Action, at = Date.now()) {
  const k = keyFor(tokenAddress, action);
  const log = childLogger(tradeLogger, 'Signals');
  const entry = seen.get(k);
  if (!entry) {
    const next: TrackEntry = { firstAt: at, lastAt: at, count: 1 };
    seen.set(k, next);
    log.info('Classified signal as initial', { tokenAddress, action });
    // fire-and-forget persistence
    const atISO = new Date(at).toISOString();
    upsertSignalSeen(action, tokenAddress, atISO).catch((e) => childLogger(appLogger, 'Signals').error('Persist initial classify error', e));
    return { kind: 'initial' as const, version: 1, meta: next };
  }
  const next: TrackEntry = { firstAt: entry.firstAt, lastAt: at, count: entry.count + 1 };
  seen.set(k, next);
  log.info('Classified signal as update', { tokenAddress, action, version: next.count });
  // fire-and-forget persistence
  const atISO = new Date(at).toISOString();
  upsertSignalSeen(action, tokenAddress, atISO).catch((e) => childLogger(appLogger, 'Signals').error('Persist update classify error', e));
  return { kind: 'update' as const, version: next.count, meta: next };
}

export function getSignalMeta(tokenAddress: string, action: Action) {
  const k = keyFor(tokenAddress, action);
  return seen.get(k);
}

export async function initSignalState() {
  if (initialized) return;
  const log = childLogger(appLogger, 'Signals');
  try {
    const rows = await loadAllSignalSeen();
    for (const r of rows) {
      const k = keyFor(r.contractAddress, r.action);
      seen.set(k, {
        firstAt: Date.parse(r.firstAt) || Date.now(),
        lastAt: Date.parse(r.lastAt) || Date.now(),
        count: r.count || 1,
      });
    }
    initialized = true;
    log.info('Signal state initialized from DB', { entries: seen.size });
  } catch (e) {
    log.error('Failed to initialize signal state', e);
  }
}

