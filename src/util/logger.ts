import type { FastifyBaseLogger } from 'fastify';

/**
 * Minimal logger surface for the non-HTTP engines (watch scheduler, payment
 * poller, model extraction). Callers pass the message first and an optional
 * structured object (or Error) second — the same shape the historical
 * console.* calls used.
 */
export interface ServiceLogger {
  info(msg: string, obj?: unknown): void;
  warn(msg: string, obj?: unknown): void;
  error(msg: string, obj?: unknown): void;
}

/** Console-backed default: byte-identical output to the pre-structured console.* calls. */
export function consoleServiceLogger(): ServiceLogger {
  return {
    info(msg, obj) {
      if (obj === undefined) console.log(msg);
      else console.log(msg, obj);
    },
    warn(msg, obj) {
      if (obj === undefined) console.warn(msg);
      else console.warn(msg, obj);
    },
    error(msg, obj) {
      if (obj === undefined) console.error(msg);
      else console.error(msg, obj);
    },
  };
}

/**
 * pino-backed ServiceLogger over a Fastify logger. pino drops extra
 * (msg, arg) arguments, so the fields must be folded into the log object;
 * Error values go to the standard `err` key (pino's std err serializer keeps
 * the stack trace) instead of being spread away.
 */
export function pinoServiceLogger(log: FastifyBaseLogger): ServiceLogger {
  const write = (level: 'info' | 'warn' | 'error', msg: string, obj: unknown): void => {
    if (obj === undefined) {
      log[level](msg);
      return;
    }
    if (obj instanceof Error) {
      log[level]({ err: obj, msg });
      return;
    }
    if (typeof obj === 'object' && obj !== null) {
      log[level]({ ...(obj as Record<string, unknown>), msg });
      return;
    }
    log[level](msg);
  };
  return {
    info: (msg, obj) => write('info', msg, obj),
    warn: (msg, obj) => write('warn', msg, obj),
    error: (msg, obj) => write('error', msg, obj),
  };
}
