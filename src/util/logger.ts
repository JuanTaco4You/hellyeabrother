import fs from 'fs';
import path from 'path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function ensureDir(dir: string) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
}

function errorToPOJO(err: any) {
  if (!err) return err;
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
    ...err,
  };
}

function stringifyMeta(meta: unknown): string {
  try {
    if (meta instanceof Error) {
      return JSON.stringify(errorToPOJO(meta));
    }
    // Handle nested Error objects anywhere in the meta structure
    const replacer = (_key: string, value: unknown) => {
      return value instanceof Error ? errorToPOJO(value) : value;
    };
    return JSON.stringify(meta as any, replacer);
  } catch {
    try {
      // Last resort best‑effort fallback
      return String(meta);
    } catch {
      return '[Unserializable meta]';
    }
  }
}

function fmt(level: LogLevel, context: string, msg: string, meta?: unknown) {
  const time = new Date().toISOString();
  const base = `[${time}] [${level.toUpperCase()}] [${context}] ${msg}`;
  if (meta === undefined) return base + "\n";
  return base + ' ' + stringifyMeta(meta) + "\n";
}

class FileLogger {
  private stream: fs.WriteStream;
  private context: string;
  private echo: boolean;

  constructor(filePath: string, context: string, echoToConsole = true) {
    ensureDir(path.dirname(filePath));
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    this.context = context;
    this.echo = echoToConsole;
  }

  private write(level: LogLevel, msg: string, meta?: unknown) {
    const line = fmt(level, this.context, msg, meta);
    try { this.stream.write(line); } catch (_) {}
    if (this.echo) {
      const out = line.trimEnd();
      if (level === 'error' || level === 'warn') console.error(out);
      else console.log(out);
    }
  }

  debug(msg: string, meta?: unknown) { this.write('debug', msg, meta); }
  info(msg: string, meta?: unknown) { this.write('info', msg, meta); }
  warn(msg: string, meta?: unknown) { this.write('warn', msg, meta); }
  error(msg: string, meta?: unknown) { this.write('error', msg, meta); }
}

// Paths: logs/app.log and logs/trade.log at repo root
const LOG_DIR = path.join(process.cwd(), 'logs');

export const appLogger = new FileLogger(path.join(LOG_DIR, 'app.log'), 'APP');
export const tradeLogger = new FileLogger(path.join(LOG_DIR, 'trade.log'), 'TRADE');

export function childLogger(base: FileLogger, childContext: string) {
  // Create a lightweight wrapper with enriched context
  return {
    debug: (m: string, meta?: unknown) => base.debug(childContext + ': ' + m, meta),
    info: (m: string, meta?: unknown) => base.info(childContext + ': ' + m, meta),
    warn: (m: string, meta?: unknown) => base.warn(childContext + ': ' + m, meta),
    error: (m: string, meta?: unknown) => base.error(childContext + ': ' + m, meta),
  };
}
