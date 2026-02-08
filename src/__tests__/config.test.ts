import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_CDP_PORT,
  DEFAULT_SUPERHUMAN_APP_PATH,
  getDefaultAppPath,
  getDefaultAutoLaunch,
  getDefaultCdpPort,
} from "../config";

describe("config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  test("uses defaults when env is not set", () => {
    delete process.env.SUPERHUMAN_CDP_PORT;
    delete process.env.SUPERHUMAN_APP_PATH;
    delete process.env.SUPERHUMAN_AUTO_LAUNCH;

    expect(getDefaultCdpPort()).toBe(DEFAULT_CDP_PORT);
    expect(getDefaultAppPath()).toBe(DEFAULT_SUPERHUMAN_APP_PATH);
    expect(getDefaultAutoLaunch()).toBe(true);
  });

  test("uses env overrides for port and app path", () => {
    process.env.SUPERHUMAN_CDP_PORT = "9444";
    process.env.SUPERHUMAN_APP_PATH = "/tmp/Superhuman";

    expect(getDefaultCdpPort()).toBe(9444);
    expect(getDefaultAppPath()).toBe("/tmp/Superhuman");
  });

  test("falls back when env port is invalid", () => {
    process.env.SUPERHUMAN_CDP_PORT = "-1";
    expect(getDefaultCdpPort()).toBe(DEFAULT_CDP_PORT);
  });

  test("parses auto-launch flag", () => {
    process.env.SUPERHUMAN_AUTO_LAUNCH = "false";
    expect(getDefaultAutoLaunch()).toBe(false);

    process.env.SUPERHUMAN_AUTO_LAUNCH = "1";
    expect(getDefaultAutoLaunch()).toBe(true);
  });
});
