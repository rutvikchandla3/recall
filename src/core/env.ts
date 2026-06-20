export function getEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

export function getEnvBoolean(name: string): boolean | undefined {
  const value = getEnv(name)?.toLowerCase();

  if (value === undefined) {
    return undefined;
  }

  if (['1', 'true', 'yes', 'on'].includes(value)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(value)) {
    return false;
  }

  return undefined;
}

export function getEnvInteger(name: string): number | undefined {
  const value = getEnv(name);
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
