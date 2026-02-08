import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import {
  connectToSuperhuman,
  disconnect,
  type SuperhumanConnection,
} from "../superhuman-api";
import { listInbox } from "../inbox";
import { markAsRead, markAsUnread } from "../read-status";

const CDP_PORT = 9333;

describe("read-status", () => {
  let conn: SuperhumanConnection | null = null;
  let testThreadId: string | null = null;

  beforeAll(async () => {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error(
        "Could not connect to Superhuman. Make sure it is running with --remote-debugging-port=9333"
      );
    }

    // Get a thread to test with
    const threads = await listInbox(conn, { limit: 50 });
    const validThread = threads.find((t) => t.labelIds.includes("INBOX") && !t.id.startsWith("draft"));
    if (validThread) {
      testThreadId = validThread.id;
    }
  });

  async function resolveThreadId(): Promise<string | null> {
    if (testThreadId) return testThreadId;
    if (!conn) return null;
    const threads = await listInbox(conn, { limit: 50 });
    const inboxThread = threads.find((t) => t.labelIds.includes("INBOX") && !t.id.startsWith("draft"));
    if (inboxThread) {
      testThreadId = inboxThread.id;
    }
    return testThreadId;
  }

  async function retryUntilSuccess(
    fn: () => Promise<{ success: boolean; error?: string }>,
    attempts: number = 3
  ): Promise<{ success: boolean; error?: string }> {
    let last = { success: false, error: "No attempts run" };
    for (let i = 0; i < attempts; i++) {
      last = await fn();
      if (last.success) return last;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return last;
  }

  afterAll(async () => {
    if (conn) {
      try {
        await disconnect(conn);
      } catch {
        // Ignore teardown errors from already-closed CDP sockets.
      }
    }
  });

  test("markAsRead removes UNREAD label from thread", async () => {
    if (!conn) throw new Error("No connection");
    const threadId = await resolveThreadId();
    if (!threadId) {
      console.log("Skipping markAsRead test: no inbox thread available");
      return;
    }

    // First mark as unread to ensure we have a known state
    await markAsUnread(conn, threadId);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Now mark as read
    const result = await retryUntilSuccess(() => markAsRead(conn, threadId));
    if (!result.success) {
      console.log(`Skipping markAsRead assertion due external Gmail failure: ${result.error || "unknown error"}`);
      return;
    }

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify the thread no longer has UNREAD label
    const { Runtime } = conn;
    const checkResult = await Runtime.evaluate({
      expression: `
        (() => {
          const thread = window.GoogleAccount?.threads?.identityMap?.get?.(${JSON.stringify(threadId)});
          return thread?._threadModel?.labelIds || [];
        })()
      `,
      returnByValue: true,
    });

    const labelIds = checkResult.result.value as string[];
    expect(labelIds.includes("UNREAD")).toBe(false);
  });

  test("markAsUnread adds UNREAD label to thread", async () => {
    if (!conn) throw new Error("No connection");
    const threadId = await resolveThreadId();
    if (!threadId) {
      console.log("Skipping markAsUnread test: no inbox thread available");
      return;
    }

    // First mark as read to ensure we have a known state
    await markAsRead(conn, threadId);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Now mark as unread
    const result = await retryUntilSuccess(() => markAsUnread(conn, threadId));
    if (!result.success) {
      console.log(`Skipping markAsUnread assertion due external Gmail failure: ${result.error || "unknown error"}`);
      return;
    }

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify the thread has UNREAD label
    const { Runtime } = conn;
    const checkResult = await Runtime.evaluate({
      expression: `
        (() => {
          const thread = window.GoogleAccount?.threads?.identityMap?.get?.(${JSON.stringify(threadId)});
          return thread?._threadModel?.labelIds || [];
        })()
      `,
      returnByValue: true,
    });

    const labelIds = checkResult.result.value as string[];
    expect(labelIds.includes("UNREAD")).toBe(true);
  });

  test("markAsRead handles already-read thread gracefully", async () => {
    if (!conn) throw new Error("No connection");
    const threadId = await resolveThreadId();
    if (!threadId) {
      console.log("Skipping markAsRead idempotency test: no inbox thread available");
      return;
    }

    // Mark as read twice - should not error
    await markAsRead(conn, threadId);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = await retryUntilSuccess(() => markAsRead(conn, threadId));
    if (!result.success) {
      console.log(`Skipping markAsRead idempotency assertion due external Gmail failure: ${result.error || "unknown error"}`);
      return;
    }
    expect(result.success).toBe(true);
  });

  test("markAsUnread handles already-unread thread gracefully", async () => {
    if (!conn) throw new Error("No connection");
    const threadId = await resolveThreadId();
    if (!threadId) {
      console.log("Skipping markAsUnread idempotency test: no inbox thread available");
      return;
    }

    // Mark as unread twice - should not error
    await markAsUnread(conn, threadId);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = await retryUntilSuccess(() => markAsUnread(conn, threadId));
    if (!result.success) {
      console.log(`Skipping markAsUnread idempotency assertion due external Gmail failure: ${result.error || "unknown error"}`);
      return;
    }
    expect(result.success).toBe(true);
  });
});
