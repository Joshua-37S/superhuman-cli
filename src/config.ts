export const DEFAULT_CDP_PORT = 9333;
export const DEFAULT_SUPERHUMAN_APP_PATH = "/Applications/Superhuman.app/Contents/MacOS/Superhuman";

function parsePort(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return null;
  }

  return parsed;
}

function parseBoolean(value: string | undefined): boolean | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return null;
}

export function getDefaultCdpPort(): number {
  return parsePort(process.env.SUPERHUMAN_CDP_PORT) ?? DEFAULT_CDP_PORT;
}

export function getDefaultAppPath(): string {
  return process.env.SUPERHUMAN_APP_PATH?.trim() || DEFAULT_SUPERHUMAN_APP_PATH;
}

export function getDefaultAutoLaunch(): boolean {
  return parseBoolean(process.env.SUPERHUMAN_AUTO_LAUNCH) ?? true;
}

export function shouldUseColorByDefault(): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }
  return Boolean(process.stdout.isTTY);
}
