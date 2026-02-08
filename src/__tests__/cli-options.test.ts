import { beforeEach, describe, expect, test } from "bun:test";
import { CliParseError, parseArgs } from "../cli-options";

describe("cli-options", () => {
  beforeEach(() => {
    delete process.env.SUPERHUMAN_CDP_PORT;
    delete process.env.SUPERHUMAN_AUTO_LAUNCH;
    delete process.env.NO_COLOR;
  });

  test("parses positional command args and thread IDs", () => {
    const options = parseArgs(["archive", "thread-1", "thread-2", "--yes"]);
    expect(options.command).toBe("archive");
    expect(options.threadIds).toEqual(["thread-1", "thread-2"]);
    expect(options.confirm).toBe(true);
  });

  test("parses search positional query", () => {
    const options = parseArgs(["search", "from:me", "--limit", "5"]);
    expect(options.command).toBe("search");
    expect(options.query).toBe("from:me");
    expect(options.limit).toBe(5);
  });

  test("parses runtime and safety flags", () => {
    const options = parseArgs([
      "delete",
      "thread-1",
      "--dry-run",
      "--no-auto-launch",
      "--no-color",
      "--json",
    ]);

    expect(options.dryRun).toBe(true);
    expect(options.autoLaunch).toBe(false);
    expect(options.noColor).toBe(true);
    expect(options.json).toBe(true);
  });

  test("resolves env-configured default port", () => {
    process.env.SUPERHUMAN_CDP_PORT = "9339";
    const options = parseArgs(["status"]);
    expect(options.port).toBe(9339);
  });

  test("throws for missing option value", () => {
    expect(() => parseArgs(["send", "--to"]))
      .toThrow(CliParseError);
  });

  test("throws for invalid numeric options", () => {
    expect(() => parseArgs(["inbox", "--limit", "0"])).toThrow(CliParseError);
    expect(() => parseArgs(["status", "--port", "99999"])).toThrow(CliParseError);
  });

  test("supports version flag", () => {
    const options = parseArgs(["--version"]);
    expect(options.showVersion).toBe(true);
  });
});
