import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface JsonlParseIssue {
  path: string;
  lineNumber: number;
  raw: string;
  error: Error;
}

export interface JsonlEntry<T = unknown> {
  lineNumber: number;
  raw: string;
  value: T;
}

export interface StreamJsonlOptions {
  onError?: (issue: JsonlParseIssue) => void;
  maxInvalidRate?: number;
  maxInvalidLines?: number;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function* streamJsonl<T = unknown>(
  filePath: string,
  options: StreamJsonlOptions = {},
): AsyncGenerator<JsonlEntry<T>> {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const reader = createInterface({
    input,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  let invalidLines = 0;
  const maxInvalidRate = options.maxInvalidRate ?? 0.35;
  const maxInvalidLines = options.maxInvalidLines ?? 25;

  try {
    for await (const rawLine of reader) {
      lineNumber += 1;
      const line = rawLine.trim();

      if (line.length === 0) {
        continue;
      }

      try {
        yield {
          lineNumber,
          raw: rawLine,
          value: JSON.parse(rawLine) as T,
        };
      } catch (error) {
        invalidLines += 1;
        const issue = {
          path: filePath,
          lineNumber,
          raw: rawLine,
          error: toError(error),
        } satisfies JsonlParseIssue;

        options.onError?.(issue);

        if (lineNumber === 1) {
          return;
        }

        const invalidRate = invalidLines / lineNumber;
        if (invalidLines >= maxInvalidLines || invalidRate > maxInvalidRate) {
          return;
        }
      }
    }
  } finally {
    reader.close();
    input.destroy();
  }
}

export async function peekFirstJsonValue<T = unknown>(filePath: string): Promise<T | null> {
  for await (const entry of streamJsonl<T>(filePath)) {
    return entry.value;
  }

  return null;
}
