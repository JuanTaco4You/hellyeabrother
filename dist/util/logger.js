"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.childLogger = exports.tradeLogger = exports.appLogger = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function ensureDir(dir) {
    try {
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
    }
    catch (_) { }
}
function errorToPOJO(err) {
    if (!err)
        return err;
    return {
        name: err.name,
        message: err.message,
        stack: err.stack,
        ...err,
    };
}
function stringifyMeta(meta) {
    try {
        if (meta instanceof Error) {
            return JSON.stringify(errorToPOJO(meta));
        }
        // Handle nested Error objects anywhere in the meta structure
        const replacer = (_key, value) => {
            return value instanceof Error ? errorToPOJO(value) : value;
        };
        return JSON.stringify(meta, replacer);
    }
    catch (_a) {
        try {
            // Last resort best‑effort fallback
            return String(meta);
        }
        catch (_b) {
            return '[Unserializable meta]';
        }
    }
}
function fmt(level, context, msg, meta) {
    const time = new Date().toISOString();
    const base = `[${time}] [${level.toUpperCase()}] [${context}] ${msg}`;
    if (meta === undefined)
        return base + "\n";
    return base + ' ' + stringifyMeta(meta) + "\n";
}
class FileLogger {
    constructor(filePath, context, echoToConsole = true) {
        ensureDir(path_1.default.dirname(filePath));
        this.stream = fs_1.default.createWriteStream(filePath, { flags: 'a' });
        this.context = context;
        this.echo = echoToConsole;
    }
    write(level, msg, meta) {
        const line = fmt(level, this.context, msg, meta);
        try {
            this.stream.write(line);
        }
        catch (_) { }
        if (this.echo) {
            const out = line.trimEnd();
            if (level === 'error' || level === 'warn')
                console.error(out);
            else
                console.log(out);
        }
    }
    debug(msg, meta) { this.write('debug', msg, meta); }
    info(msg, meta) { this.write('info', msg, meta); }
    warn(msg, meta) { this.write('warn', msg, meta); }
    error(msg, meta) { this.write('error', msg, meta); }
}
// Paths: logs/app.log and logs/trade.log at repo root
const LOG_DIR = path_1.default.join(process.cwd(), 'logs');
exports.appLogger = new FileLogger(path_1.default.join(LOG_DIR, 'app.log'), 'APP');
exports.tradeLogger = new FileLogger(path_1.default.join(LOG_DIR, 'trade.log'), 'TRADE');
function childLogger(base, childContext) {
    // Create a lightweight wrapper with enriched context
    return {
        debug: (m, meta) => base.debug(childContext + ': ' + m, meta),
        info: (m, meta) => base.info(childContext + ': ' + m, meta),
        warn: (m, meta) => base.warn(childContext + ': ' + m, meta),
        error: (m, meta) => base.error(childContext + ': ' + m, meta),
    };
}
exports.childLogger = childLogger;
