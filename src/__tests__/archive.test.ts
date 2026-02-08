import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import {
  connectToSuperhuman,
  disconnect,
  type SuperhumanConnection,
} from "../superhuman-api";
import { listInbox } from "../inbox";
import { archiveThread, deleteThread } from "../archive";

const CDP_PORT = 9333;

describe("archive", () => {
  let conn: SuperhumanConnection | null = null;
  let testThreadId: string | null = null;

  beforeAll(async () => {
    conn = await connectToSuperhuman(CDP_PORT);
    if (!conn) {
      throw new Error(
        "Could not connect to Superhuman. Make sure it is running with --remote-debugging-port=9333"
      );
    }

    // Get a thread ID to test with - must be an actual inbox thread (not a draft)
    const threads = await listInbox(conn, { limit: 20 });
    // Find a thread that has INBOX label (real inbox thread, not draft)
    const inboxThread = threads.find((t) => t.labelIds.includes("INBOX"));
    if (inboxThread) {
      testThreadId = inboxThread.id;
    }
  });

  async function getInboxThreads(min: number = 1) {
    if (!conn) return [];
    const threads = await listInbox(conn, { limit: 50 });
    const inboxThreads = threads.filter((t) => t.labelIds.includes("INBOX") && !t.id.startsWith("draft"));
    if (inboxThreads.length < min) {
      return [];
    }
    return inboxThreads;
  }

  afterAll(async () => {
    if (conn) {
      await disconnect(conn);
    }
  });

  test("archiveThread removes thread from inbox", async () => {
    if (!conn) throw new Error("No connection");
    const candidates = await getInboxThreads(1);
    if (candidates.length === 0) {
      console.log("Skipping archiveThread test: no inbox thread available");
      return;
    }
    const targetThreadId = testThreadId && candidates.some((t) => t.id === testThreadId)
      ? testThreadId
      : candidates[0].id;

    // Get inbox before archive
    const inboxBefore = await listInbox(conn, { limit: 50 });
    const threadInInboxBefore = inboxBefore.some((t) => t.id === targetThreadId);
    expect(threadInInboxBefore).toBe(true);

    // Archive the thread
    const result = await archiveThread(conn, targetThreadId);
    expect(result.success).toBe(true);

    // Wait a moment for the UI to update
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Get inbox after archive
    const inboxAfter = await listInbox(conn, { limit: 50 });
    const threadInInboxAfter = inboxAfter.some((t) => t.id === targetThreadId);

    // Thread should NOT be in inbox after archiving
    expect(threadInInboxAfter).toBe(false);
  });

  test("deleteThread moves thread to trash", async () => {
    if (!conn) throw new Error("No connection");

    // Get a fresh thread from inbox
    const inboxThreads = await getInboxThreads(1);
    if (inboxThreads.length === 0) {
      console.log("Skipping deleteThread test: no inbox thread available");
      return;
    }

    const deleteThreadId = inboxThreads[0].id;

    // Delete (trash) the thread
    const result = await deleteThread(conn, deleteThreadId);
    expect(result.success).toBe(true);

    // Wait a moment for the UI to update
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Get inbox after delete
    const inboxAfter = await listInbox(conn, { limit: 50 });
    const threadInInboxAfter = inboxAfter.some((t) => t.id === deleteThreadId);

    // Thread should NOT be in inbox after deleting (moved to trash)
    expect(threadInInboxAfter).toBe(false);
  });

  test("archiveThread handles multiple threads (bulk operation)", async () => {
    if (!conn) throw new Error("No connection");

    // Get fresh threads from inbox for bulk archive
    const inboxThreads = await getInboxThreads(3);
    if (inboxThreads.length < 3) {
      console.log("Skipping bulk archive test: need at least 3 inbox threads");
      return;
    }

    // Take 3 threads to archive
    const threadsToArchive = inboxThreads.slice(0, 3);
    const threadIds = threadsToArchive.map((t) => t.id);

    // Verify all threads are in inbox before archiving
    const inboxBefore = await listInbox(conn, { limit: 50 });
    for (const threadId of threadIds) {
      const isInInbox = inboxBefore.some((t) => t.id === threadId);
      expect(isInInbox).toBe(true);
    }

    // Archive each thread
    for (const threadId of threadIds) {
      const result = await archiveThread(conn, threadId);
      expect(result.success).toBe(true);
      // Small delay between operations
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Wait for UI to update
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify all threads are removed from inbox
    const inboxAfter = await listInbox(conn, { limit: 50 });
    for (const threadId of threadIds) {
      const isInInbox = inboxAfter.some((t) => t.id === threadId);
      expect(isInInbox).toBe(false);
    }
  });

  test("deleteThread handles multiple threads (bulk operation)", async () => {
    if (!conn) throw new Error("No connection");

    // Get fresh threads from inbox for bulk delete
    const inboxThreads = await getInboxThreads(3);
    if (inboxThreads.length < 3) {
      console.log("Skipping bulk delete test: need at least 3 inbox threads");
      return;
    }

    // Take 3 threads to delete
    const threadsToDelete = inboxThreads.slice(0, 3);
    const threadIds = threadsToDelete.map((t) => t.id);

    // Verify all threads are in inbox before deleting
    const inboxBefore = await listInbox(conn, { limit: 50 });
    for (const threadId of threadIds) {
      const isInInbox = inboxBefore.some((t) => t.id === threadId);
      expect(isInInbox).toBe(true);
    }

    // Delete each thread
    for (const threadId of threadIds) {
      const result = await deleteThread(conn, threadId);
      expect(result.success).toBe(true);
      // Small delay between operations
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Wait for UI to update
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify all threads are removed from inbox (moved to trash)
    const inboxAfter = await listInbox(conn, { limit: 50 });
    for (const threadId of threadIds) {
      const isInInbox = inboxAfter.some((t) => t.id === threadId);
      expect(isInInbox).toBe(false);
    }
  });
});
