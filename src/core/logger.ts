export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface LoggerOptions {
  quiet?: boolean;
  debug?: boolean;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return {
    info(message) {
      if (!options.quiet) {
        console.log(message);
      }
    },
    warn(message) {
      console.warn(message);
    },
    error(message) {
      console.error(message);
    },
    debug(message) {
      if (options.debug) {
        console.debug(message);
      }
    },
  };
}
