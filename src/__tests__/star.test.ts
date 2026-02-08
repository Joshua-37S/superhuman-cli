import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import {
  connectToSuperhuman,
  disconnect,
  type SuperhumanConnection,
} from "../superhuman-api";
import { listInbox } from "../inbox";
import { getThreadLabels, starThread, unstarThread, listStarred } from "../labels";

const CDP_PORT = 9333;

describe("star", () => {
  let conn: SuperhumanConnection | null = null;
  let testThreadId: string | null = null;
  let isMicrosoft: boolean = false;

  beforeAll(async () => {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error(
        "Could not connect to Superhuman. Make sure it is running with --remote-debugging-port=9333"
      );
    }

    // Check if this is a Microsoft account
    const { Runtime } = conn;
    const accountCheck = await Runtime.evaluate({
      expression: `(async () => {
        const ga = window.GoogleAccount;
        const di = ga?.di;
        return { isMicrosoft: !!di?.get?.('isMicrosoft') };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    isMicrosoft = (accountCheck.result.value as { isMicrosoft: boolean })?.isMicrosoft ?? false;
    console.log("Account type:", isMicrosoft ? "Microsoft" : "Gmail");

    // Get a thread to test with - filter out drafts which have invalid Gmail thread IDs
    const threads = await listInbox(conn, { limit: 20 });
    const validThread = threads.find((t) => !t.id.startsWith("draft"));
    if (validThread) {
      testThreadId = validThread.id;
    }
  });

  async function requireTestThread(): Promise<string | null> {
    if (testThreadId) return testThreadId;
    if (!conn) return null;

    const threads = await listInbox(conn, { limit: 50 });
    const validThread = threads.find((t) => t.labelIds.includes("INBOX") && !t.id.startsWith("draft"));
    if (validThread) {
      testThreadId = validThread.id;
    }
    return testThreadId;
  }

  afterAll(async () => {
    if (conn) {
      await disconnect(conn);
    }
  });

  test("starThread stars a thread", async () => {
    if (!conn) throw new Error("No connection");
    const threadId = await requireTestThread();
    if (!threadId) {
      console.log("Skipping starThread test: no suitable inbox thread");
      return;
    }

    // Unstar first to ensure clean state
    await unstarThread(conn, threadId);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Star the thread
    const result = await starThread(conn, threadId);
    expect(result.success).toBe(true);

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // For Gmail, verify the STARRED label was added
    if (!isMicrosoft) {
      const labelsAfter = await getThreadLabels(conn, threadId);
      expect(labelsAfter.some((l) => l.id === "STARRED")).toBe(true);
    }

    // Clean up
    await unstarThread(conn, threadId);
  });

  test("unstarThread unstars a thread", async () => {
    if (!conn) throw new Error("No connection");
    const threadId = await requireTestThread();
    if (!threadId) {
      console.log("Skipping unstarThread test: no suitable inbox thread");
      return;
    }

    // First star the thread
    const starResult = await starThread(conn, threadId);
    expect(starResult.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Now unstar it
    const result = await unstarThread(conn, threadId);
    expect(result.success).toBe(true);

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // For Gmail, verify the STARRED label was removed
    if (!isMicrosoft) {
      const labelsAfter = await getThreadLabels(conn, threadId);
      expect(labelsAfter.some((l) => l.id === "STARRED")).toBe(false);
    }
  });

  test("listStarred returns starred threads", async () => {
    if (!conn) throw new Error("No connection");
    const threadId = await requireTestThread();
    if (!threadId) {
      console.log("Skipping listStarred test: no suitable inbox thread");
      return;
    }

    // First star the thread
    const starResult = await starThread(conn, threadId);
    expect(starResult.success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // List starred threads
    const starredThreads = await listStarred(conn);

    // Verify we got an array
    expect(Array.isArray(starredThreads)).toBe(true);

    // For Gmail, verify the thread is in the starred list
    // (For Microsoft, the filter query might not work as expected)
    if (!isMicrosoft) {
      expect(starredThreads.some((t) => t.id === threadId)).toBe(true);
    }

    // Clean up - unstar the thread
    await unstarThread(conn, threadId);
  });
});
