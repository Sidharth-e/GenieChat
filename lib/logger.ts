import pino, { type Logger as PinoLogger } from "pino";

const isProduction = process.env.NODE_ENV === "production";
const isBrowser = typeof window !== "undefined";

declare global {
  var __logger: PinoLogger | undefined;
}

type LooseLogger = Omit<
  PinoLogger,
  "fatal" | "error" | "warn" | "info" | "debug" | "trace"
> & {
  fatal: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
};

/**
 * Structured logger for the application.
 * In development, it uses pino-pretty for readable console output.
 * In production, it outputs raw JSON for log aggregation services (e.g., Application Insights).
 */
function createLogger(): PinoLogger {
  return pino({
    level: isProduction ? "info" : "debug",
    ...(isBrowser
      ? {
          browser: {
            asObject: true,
          },
        }
      : isProduction
        ? {}
        : {
            transport: {
              target: "pino-pretty",
              options: {
                colorize: true,
              },
            },
          }),
  }) as PinoLogger;
}

const pinoLogger = isBrowser
  ? createLogger()
  : (globalThis.__logger ??= createLogger());

export const logger = pinoLogger as unknown as LooseLogger;
logger.log = (...args: unknown[]) =>
  (pinoLogger.info as (...values: unknown[]) => void)(...args);
