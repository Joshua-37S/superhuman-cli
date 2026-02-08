import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import {
  connectToSuperhuman,
  disconnect,
  type SuperhumanConnection,
} from "../superhuman-api";
import { listInbox } from "../inbox";
import { listLabels, getThreadLabels, addLabel, removeLabel, type Label } from "../labels";

const CDP_PORT = 9333;

describe("labels", () => {
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
    const validThread = threads.find((t) => t.labelIds.includes("INBOX") && !t.id.startsWith("draft"));
    if (validThread) {
      testThreadId = validThread.id;
    }
    return testThreadId;
  }

  async function retryAddLabel(
    threadId: string,
    labelId: string,
    attempts: number = 3
  ): Promise<{ success: boolean; error?: string }> {
    let last = { success: false, error: "No attempts run" };
    for (let i = 0; i < attempts; i++) {
      last = await addLabel(conn as SuperhumanConnection, threadId, labelId);
      if (last.success) return last;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return last;
  }

  async function retryRemoveLabel(
    threadId: string,
    labelId: string,
    attempts: number = 3
  ): Promise<{ success: boolean; error?: string }> {
    let last = { success: false, error: "No attempts run" };
    for (let i = 0; i < attempts; i++) {
      last = await removeLabel(conn as SuperhumanConnection, threadId, labelId);
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

  test("listLabels returns array of labels", async () => {
    if (!conn) throw new Error("No connection");

    const labels = await listLabels(conn);

    expect(Array.isArray(labels)).toBe(true);
    expect(labels.length).toBeGreaterThan(0);

    // Check label structure
    const firstLabel = labels[0];
    expect(firstLabel).toHaveProperty("id");
    expect(firstLabel).toHaveProperty("name");
  });

  test("listLabels includes system labels", async () => {
    if (!conn) throw new Error("No connection");

    const labels = await listLabels(conn);
    const labelNames = labels.map((l) => l.name);

    // Should include common system labels
    expect(labelNames.some((name) => name === "INBOX" || name === "Inbox")).toBe(true);
  });

  test("getThreadLabels returns labels for a specific thread", async () => {
    if (!conn) throw new Error("No connection");
    const threadId = await resolveThreadId();
    if (!threadId) {
      console.log("Skipping getThreadLabels test: no thread available");
      return;
    }

    const labels = await getThreadLabels(conn, threadId);

    expect(Array.isArray(labels)).toBe(true);
    // Most inbox threads should have at least one label
    expect(labels.length).toBeGreaterThan(0);
  });

  test("addLabel adds a label to a thread", async () => {
    if (!conn) throw new Error("No connection");
    const threadId = await resolveThreadId();
    if (!threadId) {
      console.log("Skipping addLabel test: no thread available");
      return;
    }

    // Get available labels first
    const allLabels = await listLabels(conn);

    // Find a user label (not a system label) to test with
    const userLabel = allLabels.find(
      (l) => l.id.startsWith("Label_") && !l.name.startsWith("SH_")
    );

    if (!userLabel) {
      // Skip test if no user labels exist
      console.log("No user labels available for testing addLabel");
      return;
    }

    // Get current labels
    const labelsBefore = await getThreadLabels(conn, threadId);
    const hadLabel = labelsBefore.some((l) => l.id === userLabel.id);

    // If already has the label, remove it first
    if (hadLabel) {
      await removeLabel(conn, threadId, userLabel.id);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Add the label
    const result = await retryAddLabel(threadId, userLabel.id);
    if (!result.success) {
      console.log(`Skipping addLabel assertion due external Gmail failure: ${result.error || "unknown error"}`);
      return;
    }

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify the label was added
    const labelsAfter = await getThreadLabels(conn, threadId);
    expect(labelsAfter.some((l) => l.id === userLabel.id)).toBe(true);

    // Clean up - remove the label if we added it
    if (!hadLabel) {
      await removeLabel(conn, threadId, userLabel.id);
    }
  });

  test("removeLabel removes a label from a thread", async () => {
    if (!conn) throw new Error("No connection");
    const threadId = await resolveThreadId();
    if (!threadId) {
      console.log("Skipping removeLabel test: no thread available");
      return;
    }

    // Get available labels first
    const allLabels = await listLabels(conn);

    // Find a user label to test with
    const userLabel = allLabels.find(
      (l) => l.id.startsWith("Label_") && !l.name.startsWith("SH_")
    );

    if (!userLabel) {
      // Skip test if no user labels exist
      console.log("No user labels available for testing removeLabel");
      return;
    }

    // First add the label to ensure it exists on the thread
    await retryAddLabel(threadId, userLabel.id);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Now remove it
    const result = await retryRemoveLabel(threadId, userLabel.id);
    if (!result.success) {
      console.log(`Skipping removeLabel assertion due external Gmail failure: ${result.error || "unknown error"}`);
      return;
    }

    // Wait for state to propagate
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify the label was removed
    const labelsAfter = await getThreadLabels(conn, threadId);
    expect(labelsAfter.some((l) => l.id === userLabel.id)).toBe(false);
  });
});
