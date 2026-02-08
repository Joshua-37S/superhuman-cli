#!/usr/bin/env bun

import { connectToSuperhuman, disconnect } from "./superhuman-api";
import { listInbox } from "./inbox";
import { listLabels } from "./labels";

const TEST_FILES = [
  "src/__tests__/inbox.test.ts",
  "src/__tests__/read.test.ts",
  "src/__tests__/attachments.test.ts",
  "src/__tests__/archive.test.ts",
  "src/__tests__/labels.test.ts",
  "src/__tests__/star.test.ts",
  "src/__tests__/read-status.test.ts",
  "src/__tests__/accounts.test.ts",
  "src/__tests__/calendar.test.ts",
  "src/__tests__/reply.test.ts",
  "src/__tests__/snooze.test.ts",
  "src/__tests__/cli-options.test.ts",
  "src/__tests__/config.test.ts",
  "src/__tests__/superhuman-api-text.test.ts",
];

async function printPreconditions() {
  const conn = await connectToSuperhuman();
  if (!conn) {
    console.error("[live-stable] Could not connect to Superhuman");
    process.exit(1);
  }

  try {
    const threads = await listInbox(conn, { limit: 100 });
    const inboxThreads = threads.filter((thread) => thread.labelIds.includes("INBOX"));
    const nonDraftInboxThreads = inboxThreads.filter((thread) => !thread.id.startsWith("draft"));
    const labels = await listLabels(conn);
    const userLabels = labels.filter((label) => label.id.startsWith("Label_"));

    console.log("[live-stable] Preconditions");
    console.log(`  Inbox threads sampled: ${threads.length}`);
    console.log(`  INBOX threads sampled: ${inboxThreads.length}`);
    console.log(`  Non-draft INBOX threads sampled: ${nonDraftInboxThreads.length}`);
    console.log(`  Labels available: ${labels.length} (${userLabels.length} user labels)`);
    console.log("  Note: integration tests will skip if mailbox preconditions are missing.");
    console.log("");
  } finally {
    await disconnect(conn);
  }
}

async function runSuite() {
  const child = Bun.spawn(["bun", "test", "--timeout=15000", ...TEST_FILES], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const code = await child.exited;
  process.exit(code);
}

async function main() {
  console.log("[live-stable] Running stable live integration test suite...\n");
  await printPreconditions();
  await runSuite();
}

main().catch((error) => {
  console.error(`[live-stable] Fatal error: ${(error as Error).message}`);
  process.exit(1);
});
