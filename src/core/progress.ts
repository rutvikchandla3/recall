export interface ProgressReporterOptions {
  label: string;
  total: number;
  enabled?: boolean;
  minIntervalMs?: number;
  stream?: ProgressStream;
}

export interface ProgressReporter {
  update(current: number, detail?: string): void;
  increment(delta?: number, detail?: string): void;
  finish(message?: string): void;
  fail(message?: string): void;
}

interface ProgressStream {
  write(chunk: string): void;
  isTTY?: boolean;
  columns?: number;
}

export function createProgressReporter(options: ProgressReporterOptions): ProgressReporter {
  const enabled = options.enabled ?? true;
  const stream = options.stream ?? process.stderr;
  const total = Math.max(0, Math.trunc(options.total));
  const minIntervalMs = options.minIntervalMs ?? 250;
  const interactive = Boolean(stream.isTTY);
  let current = 0;
  let lastRenderedAt = 0;
  let lastLineLength = 0;
  let finished = false;

  function render(force = false, detail?: string): void {
    if (!enabled || finished) {
      return;
    }

    const now = Date.now();
    if (!force && now - lastRenderedAt < minIntervalMs && current < total) {
      return;
    }

    lastRenderedAt = now;
    const line = formatProgressLine(options.label, current, total, detail);

    if (interactive) {
      const clear = lastLineLength > line.length ? ' '.repeat(lastLineLength - line.length) : '';
      stream.write(`\r${line}${clear}`);
      lastLineLength = line.length;
      return;
    }

    stream.write(`${line}\n`);
  }

  function complete(prefix: string, message?: string): void {
    if (!enabled || finished) {
      finished = true;
      return;
    }

    finished = true;
    const line = message ?? `${prefix} ${options.label}: ${current}/${total}`;

    if (interactive) {
      const clear = lastLineLength > line.length ? ' '.repeat(lastLineLength - line.length) : '';
      stream.write(`\r${line}${clear}\n`);
      lastLineLength = 0;
      return;
    }

    stream.write(`${line}\n`);
  }

  return {
    update(nextCurrent, detail) {
      current = clampProgress(nextCurrent, total);
      render(false, detail);
    },
    increment(delta = 1, detail) {
      current = clampProgress(current + delta, total);
      render(false, detail);
    },
    finish(message) {
      current = total > 0 ? total : current;
      complete('Done', message);
    },
    fail(message) {
      complete('Failed', message);
    },
  };
}

function clampProgress(value: number, total: number): number {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  return total > 0 ? Math.min(normalized, total) : normalized;
}

function formatProgressLine(label: string, current: number, total: number, detail?: string): string {
  const percent = total > 0 ? ` (${Math.floor((current / total) * 100)}%)` : '';
  return `${label}: ${current}/${total}${percent}${detail ? ` · ${detail}` : ''}`;
}
