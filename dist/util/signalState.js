"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSignalState = exports.getSignalMeta = exports.classifySignal = void 0;
const logger_1 = require("./logger");
const db_1 = require("./db");
// Tracks signals seen in-memory across process lifetime (seeded from DB)
const seen = new Map();
let initialized = false;
function keyFor(tokenAddress, action) {
    return `${action}:${tokenAddress.toLowerCase()}`;
}
function classifySignal(tokenAddress, action, at = Date.now()) {
    const k = keyFor(tokenAddress, action);
    const log = (0, logger_1.childLogger)(logger_1.tradeLogger, 'Signals');
    const entry = seen.get(k);
    if (!entry) {
        const next = { firstAt: at, lastAt: at, count: 1 };
        seen.set(k, next);
        log.info('Classified signal as initial', { tokenAddress, action });
        // fire-and-forget persistence
        const atISO = new Date(at).toISOString();
        (0, db_1.upsertSignalSeen)(action, tokenAddress, atISO).catch((e) => (0, logger_1.childLogger)(logger_1.appLogger, 'Signals').error('Persist initial classify error', e));
        return { kind: 'initial', version: 1, meta: next };
    }
    const next = { firstAt: entry.firstAt, lastAt: at, count: entry.count + 1 };
    seen.set(k, next);
    log.info('Classified signal as update', { tokenAddress, action, version: next.count });
    // fire-and-forget persistence
    const atISO = new Date(at).toISOString();
    (0, db_1.upsertSignalSeen)(action, tokenAddress, atISO).catch((e) => (0, logger_1.childLogger)(logger_1.appLogger, 'Signals').error('Persist update classify error', e));
    return { kind: 'update', version: next.count, meta: next };
}
exports.classifySignal = classifySignal;
function getSignalMeta(tokenAddress, action) {
    const k = keyFor(tokenAddress, action);
    return seen.get(k);
}
exports.getSignalMeta = getSignalMeta;
async function initSignalState() {
    if (initialized)
        return;
    const log = (0, logger_1.childLogger)(logger_1.appLogger, 'Signals');
    try {
        const rows = await (0, db_1.loadAllSignalSeen)();
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
    }
    catch (e) {
        log.error('Failed to initialize signal state', e);
    }
}
exports.initSignalState = initSignalState;
