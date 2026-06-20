export interface RedactionResult {
  text: string;
  count: number;
}

interface RedactionRule {
  pattern: RegExp;
  replacement: string;
}

const REDACTION_RULES: RedactionRule[] = [
  { pattern: /\bghp_[A-Za-z0-9_]{20,}\b/g, replacement: '<REDACTED_GITHUB_TOKEN>' },
  { pattern: /\bgho_[A-Za-z0-9_]{20,}\b/g, replacement: '<REDACTED_GITHUB_TOKEN>' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: '<REDACTED_GITHUB_TOKEN>' },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, replacement: '<REDACTED_SLACK_TOKEN>' },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: '<REDACTED_API_KEY>' },
  { pattern: /\b(?:[A-Z0-9]+[_-])*(?:API[_-]?KEY|TOKEN)\s*[:=]\s*['\"]?[^\s'\"]{16,}/gi, replacement: 'API_KEY=<REDACTED_API_KEY>' },
  { pattern: /\b(authorization\s*:\s*bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, replacement: '$1<REDACTED_BEARER_TOKEN>' },
  { pattern: /\b(password|secret|token|api[_-]?key)\s*[:=]\s*['\"]?(?!<REDACTED_)[^\s'\"]{12,}/gi, replacement: '$1=<REDACTED_SECRET>' },
  { pattern: /\b[A-Za-z0-9+/]{48,}={0,2}\b/g, replacement: '<REDACTED_HIGH_ENTROPY_STRING>' },
];

export function redactForEmbedding(input: string): RedactionResult {
  let text = input;
  let count = 0;

  for (const rule of REDACTION_RULES) {
    const matches = text.match(rule.pattern);
    if (matches) {
      count += matches.length;
      text = text.replace(rule.pattern, rule.replacement);
    }
  }

  return { text, count };
}
