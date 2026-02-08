#!/usr/bin/env bun
/**
 * Superhuman CLI
 *
 * Command-line interface for composing and sending emails via Superhuman.
 *
 * Usage:
 *   superhuman compose --to <email> --subject <subject> --body <body>
 *   superhuman send --to <email> --subject <subject> --body <body>
 *   superhuman draft --to <email> --subject <subject> --body <body>
 *   superhuman status
 */

import {
  connectToSuperhuman,
  openCompose,
  getDraftState,
  setSubject,
  addRecipient,
  setBody,
  saveDraft,
  sendDraft,
  closeCompose,
  disconnect,
  textToHtml,
  type SuperhumanConnection,
} from "./superhuman-api";
import { listInbox, searchInbox } from "./inbox";
import { readThread } from "./read";
import { listAccounts, switchAccount, type Account } from "./accounts";
import { replyToThread, replyAllToThread, forwardThread } from "./reply";
import { archiveThread, deleteThread } from "./archive";
import { markAsRead, markAsUnread } from "./read-status";
import { listLabels, getThreadLabels, addLabel, removeLabel, starThread, unstarThread, listStarred } from "./labels";
import { snoozeThread, unsnoozeThread, listSnoozed, parseSnoozeTime } from "./snooze";
import { listAttachments, downloadAttachment, type Attachment } from "./attachments";
import {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent as deleteCalendarEvent,
  getFreeBusy,
  type CalendarEvent,
  type CreateEventInput,
  type UpdateEventInput,
} from "./calendar";
import { getDefaultAppPath, getDefaultCdpPort } from "./config";
import { CliParseError, parseArgs, type CliOptions } from "./cli-options";

const VERSION = "0.1.0";
const DEFAULT_CDP_PORT = getDefaultCdpPort();
const DEFAULT_APP_PATH = getDefaultAppPath();

const ansiColors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};
const colors = { ...ansiColors };

function setColorEnabled(enabled: boolean) {
  for (const key of Object.keys(ansiColors) as Array<keyof typeof ansiColors>) {
    colors[key] = enabled ? ansiColors[key] : "";
  }
}

function log(message: string) {
  console.log(message);
}

function success(message: string) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function error(message: string) {
  console.error(`${colors.red}✗${colors.reset} ${message}`);
}

function info(message: string) {
  console.log(`${colors.blue}ℹ${colors.reset} ${message}`);
}

/**
 * Format accounts list for human-readable output
 */
export function formatAccountsList(accounts: Account[]): string {
  if (accounts.length === 0) return "";

  return accounts
    .map((account, index) => {
      const marker = account.isCurrent ? "*" : " ";
      const suffix = account.isCurrent ? " (current)" : "";
      return `${marker} ${index + 1}. ${account.email}${suffix}`;
    })
    .join("\n");
}

/**
 * Format accounts list as JSON
 */
export function formatAccountsJson(accounts: Account[]): string {
  return JSON.stringify(accounts);
}

function emitJson(payload: unknown) {
  console.log(JSON.stringify(payload, null, 2));
}

function emitCommandJson(
  options: CliOptions,
  ok: boolean,
  data: Record<string, unknown> = {}
) {
  if (!options.json) {
    return;
  }

  emitJson({
    ok,
    command: options.command,
    dryRun: options.dryRun || undefined,
    ...data,
  });
}

function isBulkDestructiveCommand(command: string): boolean {
  return (
    command === "archive" ||
    command === "delete" ||
    command === "mark-read" ||
    command === "mark-unread" ||
    command === "add-label" ||
    command === "remove-label" ||
    command === "star" ||
    command === "unstar" ||
    command === "snooze" ||
    command === "unsnooze"
  );
}

function ensureBulkConfirmation(options: CliOptions): void {
  if (!isBulkDestructiveCommand(options.command) || options.threadIds.length <= 1) {
    return;
  }
  if (options.confirm || options.dryRun) {
    return;
  }

  const message = `Refusing to run ${options.command} on ${options.threadIds.length} threads without --yes`;
  if (options.json) {
    emitCommandJson(options, false, { error: message, threadIds: options.threadIds });
  } else {
    error(message);
    info("Use --yes to execute, or --dry-run to preview.");
  }
  process.exit(1);
}

function printHelp() {
  console.log(`
${colors.bold}Superhuman CLI${colors.reset} v${VERSION}

${colors.bold}USAGE${colors.reset}
  superhuman <command> [options]

${colors.bold}COMMANDS${colors.reset}
  ${colors.cyan}accounts${colors.reset}   List all linked accounts
  ${colors.cyan}account${colors.reset}    Switch to a different account
  ${colors.cyan}inbox${colors.reset}      List recent emails from inbox
  ${colors.cyan}search${colors.reset}     Search emails
  ${colors.cyan}read${colors.reset}       Read a specific email thread
  ${colors.cyan}reply${colors.reset}      Reply to an email thread
  ${colors.cyan}reply-all${colors.reset}  Reply-all to an email thread
  ${colors.cyan}forward${colors.reset}    Forward an email thread
  ${colors.cyan}archive${colors.reset}    Archive email thread(s)
  ${colors.cyan}delete${colors.reset}     Delete (trash) email thread(s)
  ${colors.cyan}mark-read${colors.reset}  Mark thread(s) as read
  ${colors.cyan}mark-unread${colors.reset} Mark thread(s) as unread
  ${colors.cyan}labels${colors.reset}     List all available labels
  ${colors.cyan}get-labels${colors.reset} Get labels on a specific thread
  ${colors.cyan}add-label${colors.reset}  Add a label to thread(s)
  ${colors.cyan}remove-label${colors.reset} Remove a label from thread(s)
  ${colors.cyan}star${colors.reset}       Star thread(s)
  ${colors.cyan}unstar${colors.reset}     Unstar thread(s)
  ${colors.cyan}starred${colors.reset}    List all starred threads
  ${colors.cyan}snooze${colors.reset}     Snooze thread(s) until a specific time
  ${colors.cyan}unsnooze${colors.reset}   Unsnooze (cancel snooze) thread(s)
  ${colors.cyan}snoozed${colors.reset}    List all snoozed threads
  ${colors.cyan}attachments${colors.reset} List attachments for a thread
  ${colors.cyan}download${colors.reset}   Download attachments from a thread
  ${colors.cyan}calendar${colors.reset}   List calendar events
  ${colors.cyan}calendar-create${colors.reset} Create a calendar event
  ${colors.cyan}calendar-update${colors.reset} Update a calendar event
  ${colors.cyan}calendar-delete${colors.reset} Delete a calendar event
  ${colors.cyan}calendar-free${colors.reset} Check free/busy availability
  ${colors.cyan}compose${colors.reset}    Open compose window and fill in email (keeps window open)
  ${colors.cyan}draft${colors.reset}      Create and save a draft
  ${colors.cyan}send${colors.reset}       Compose and send an email immediately
  ${colors.cyan}status${colors.reset}     Check Superhuman connection status
  ${colors.cyan}help${colors.reset}       Show this help message

${colors.bold}OPTIONS${colors.reset}
  --to <email>       Recipient email address (required for compose/draft/send/forward)
  --cc <email>       CC recipient (can be used multiple times)
  --bcc <email>      BCC recipient (can be used multiple times)
  --subject <text>   Email subject
  --body <text>      Email body (plain text, converted to HTML)
  --html <text>      Email body as HTML
  --send             Send immediately instead of saving as draft (for reply/reply-all/forward)
  --label <id>       Label ID to add or remove (for add-label/remove-label)
  --until <time>     Snooze until time: preset (tomorrow, next-week, weekend, evening) or ISO datetime
  --output <path>    Output directory or file path (for download)
  --attachment <id>  Specific attachment ID (for download)
  --message <id>     Message ID (required with --attachment)
  --limit <number>   Number of results (default: 10, for inbox/search)
  --json             Output as JSON (for inbox/search/read)
  --date <date>      Date for calendar (YYYY-MM-DD or "today", "tomorrow")
  --range <days>     Days to show for calendar (default: 1)
  --start <time>     Event start time (ISO datetime or natural: "2pm", "tomorrow 3pm")
  --end <time>       Event end time (ISO datetime, optional if --duration)
  --duration <mins>  Event duration in minutes (default: 30)
  --title <text>     Event title (for calendar-create/update)
  --event <id>       Event ID (for calendar-update/delete)
  --port <number>    CDP port (default: ${DEFAULT_CDP_PORT} or $SUPERHUMAN_CDP_PORT)
  --yes              Confirm bulk destructive operations
  --dry-run          Preview destructive operations without changing data
  --no-auto-launch   Do not auto-launch Superhuman when disconnected
  --no-color         Disable ANSI colors
  --version, -v      Show version

${colors.bold}EXAMPLES${colors.reset}
  ${colors.dim}# List linked accounts${colors.reset}
  superhuman accounts
  superhuman accounts --json

  ${colors.dim}# Switch account${colors.reset}
  superhuman account 2
  superhuman account user@example.com

  ${colors.dim}# List recent emails${colors.reset}
  superhuman inbox
  superhuman inbox --limit 5 --json

  ${colors.dim}# Search emails${colors.reset}
  superhuman search "from:john subject:meeting"
  superhuman search "project update" --limit 20

  ${colors.dim}# Read an email thread${colors.reset}
  superhuman read <thread-id>
  superhuman read <thread-id> --json

  ${colors.dim}# Reply to an email${colors.reset}
  superhuman reply <thread-id> --body "Thanks for the update!"
  superhuman reply <thread-id> --body "Got it!" --send

  ${colors.dim}# Reply-all to an email${colors.reset}
  superhuman reply-all <thread-id> --body "Thanks everyone!"

  ${colors.dim}# Forward an email${colors.reset}
  superhuman forward <thread-id> --to colleague@example.com --body "FYI"
  superhuman forward <thread-id> --to colleague@example.com --send

  ${colors.dim}# Archive emails${colors.reset}
  superhuman archive <thread-id>
  superhuman archive <thread-id1> <thread-id2> <thread-id3>

  ${colors.dim}# Delete (trash) emails${colors.reset}
  superhuman delete <thread-id>
  superhuman delete <thread-id1> <thread-id2> <thread-id3>

  ${colors.dim}# Mark as read/unread${colors.reset}
  superhuman mark-read <thread-id>
  superhuman mark-unread <thread-id1> <thread-id2>

  ${colors.dim}# List all labels${colors.reset}
  superhuman labels
  superhuman labels --json

  ${colors.dim}# Get labels on a thread${colors.reset}
  superhuman get-labels <thread-id>
  superhuman get-labels <thread-id> --json

  ${colors.dim}# Add/remove labels${colors.reset}
  superhuman add-label <thread-id> --label Label_123
  superhuman remove-label <thread-id> --label Label_123

  ${colors.dim}# Star/unstar threads${colors.reset}
  superhuman star <thread-id>
  superhuman star <thread-id1> <thread-id2>
  superhuman unstar <thread-id>
  superhuman starred
  superhuman starred --json

  ${colors.dim}# Snooze/unsnooze threads${colors.reset}
  superhuman snooze <thread-id> --until tomorrow
  superhuman snooze <thread-id> --until next-week
  superhuman snooze <thread-id> --until "2024-02-15T14:00:00Z"
  superhuman unsnooze <thread-id>
  superhuman snoozed
  superhuman snoozed --json

  ${colors.dim}# List and download attachments${colors.reset}
  superhuman attachments <thread-id>
  superhuman attachments <thread-id> --json
  superhuman download <thread-id>
  superhuman download <thread-id> --output ./downloads
  superhuman download --attachment <attachment-id> --message <message-id> --output ./file.pdf

  ${colors.dim}# List calendar events${colors.reset}
  superhuman calendar
  superhuman calendar --date tomorrow
  superhuman calendar --range 7 --json

  ${colors.dim}# Create calendar event${colors.reset}
  superhuman calendar-create --title "Meeting" --start "2pm" --duration 30
  superhuman calendar-create --title "All Day" --date 2026-02-05

  ${colors.dim}# Update/delete calendar event${colors.reset}
  superhuman calendar-update --event <event-id> --title "New Title"
  superhuman calendar-delete --event <event-id>

  ${colors.dim}# Check availability${colors.reset}
  superhuman calendar-free
  superhuman calendar-free --date tomorrow --range 7

  ${colors.dim}# Create a draft${colors.reset}
  superhuman draft --to user@example.com --subject "Hello" --body "Hi there!"

  ${colors.dim}# Open compose window with pre-filled content${colors.reset}
  superhuman compose --to user@example.com --subject "Meeting"

  ${colors.dim}# Send an email immediately${colors.reset}
  superhuman send --to user@example.com --subject "Quick note" --body "FYI"

${colors.bold}REQUIREMENTS${colors.reset}
  Superhuman must be running with remote debugging enabled:
  ${colors.dim}${DEFAULT_APP_PATH} --remote-debugging-port=${DEFAULT_CDP_PORT}${colors.reset}
`);
}

async function checkConnection(port: number, autoLaunch: boolean): Promise<SuperhumanConnection | null> {
  try {
    const conn = await connectToSuperhuman(port, autoLaunch);
    if (!conn) {
      error("Could not connect to Superhuman");
      if (!autoLaunch) {
        info(`Launch Superhuman manually or rerun without --no-auto-launch`);
      } else {
        info(`Superhuman may not be installed at ${DEFAULT_APP_PATH}`);
      }
      return null;
    }
    return conn;
  } catch (e) {
    error(`Connection failed: ${(e as Error).message}`);
    info(`Superhuman may not be installed at ${DEFAULT_APP_PATH}`);
    return null;
  }
}

async function cmdStatus(options: CliOptions) {
  info(`Checking connection to Superhuman on port ${options.port}...`);

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  success("Connected to Superhuman");

  // Get current state
  const state = await getDraftState(conn);
  if (options.json) {
    emitCommandJson(options, true, {
      connected: true,
      port: options.port,
      draft: state,
    });
    await disconnect(conn);
    return;
  }

  if (state) {
    log(`\n${colors.bold}Current compose state:${colors.reset}`);
    log(`  Draft ID: ${state.id}`);
    log(`  From: ${state.from}`);
    log(`  To: ${state.to.join(", ") || "(none)"}`);
    log(`  Subject: ${state.subject || "(none)"}`);
    log(`  Dirty: ${state.isDirty}`);
  } else {
    log("\nNo active compose window");
  }

  await disconnect(conn);
}

async function cmdCompose(options: CliOptions, keepOpen = true, suppressJson = false) {
  if (options.to.length === 0) {
    error("At least one recipient is required (--to)");
    process.exit(1);
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  info("Opening compose window...");
  const draftKey = await openCompose(conn);
  if (!draftKey) {
    error("Failed to open compose window");
    await disconnect(conn);
    process.exit(1);
  }
  success(`Compose opened (${draftKey})`);

  // Add recipients
  const recipientResults: Array<{ email: string; success: boolean }> = [];
  for (const email of options.to) {
    info(`Adding recipient: ${email}`);
    const added = await addRecipient(conn, email);
    recipientResults.push({ email, success: added });
    if (added) {
      success(`Added: ${email}`);
    } else {
      error(`Failed to add: ${email}`);
    }
  }

  // Set subject
  let subjectSet = true;
  if (options.subject) {
    info(`Setting subject: ${options.subject}`);
    subjectSet = await setSubject(conn, options.subject);
    if (subjectSet) {
      success("Subject set");
    } else {
      error("Failed to set subject");
    }
  }

  // Set body
  const bodyContent = options.html || options.body;
  let bodySet = true;
  if (bodyContent) {
    info("Setting body...");
    bodySet = await setBody(conn, textToHtml(bodyContent));
    if (bodySet) {
      success("Body set");
    } else {
      error("Failed to set body");
    }
  }

  // Get final state
  const state = await getDraftState(conn);
  if (state) {
    log(`\n${colors.bold}Draft:${colors.reset}`);
    log(`  To: ${state.to.join(", ")}`);
    log(`  Subject: ${state.subject}`);
    log(`  Body: ${state.body.substring(0, 100)}${state.body.length > 100 ? "..." : ""}`);
  }

  if (!keepOpen) {
    await closeCompose(conn);
  }

  const failedRecipients = recipientResults.filter((r) => !r.success);
  const ok = failedRecipients.length === 0 && subjectSet && bodySet;

  if (options.json && !suppressJson) {
    emitCommandJson(options, ok, {
      draftId: draftKey,
      recipients: recipientResults,
      subjectSet,
      bodySet,
      draft: state,
      keepOpen,
    });
  }

  if (!ok) {
    process.exitCode = 1;
  }

  await disconnect(conn);
  return state;
}

async function cmdDraft(options: CliOptions) {
  const state = await cmdCompose(options, true, true);

  if (!state) {
    process.exit(1);
  }

  // Reconnect to save
  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  info("Saving draft...");
  const saved = await saveDraft(conn);
  if (saved) {
    success("Draft saved");
  } else {
    error("Failed to save draft");
    process.exitCode = 1;
  }

  emitCommandJson(options, saved, {
    draftId: state.id,
    saved,
  });

  await disconnect(conn);
}

async function cmdSend(options: CliOptions) {
  if (options.to.length === 0) {
    error("At least one recipient is required (--to)");
    process.exit(1);
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  info("Opening compose window...");
  const draftKey = await openCompose(conn);
  if (!draftKey) {
    error("Failed to open compose window");
    await disconnect(conn);
    process.exit(1);
  }

  // Add recipients
  for (const email of options.to) {
    await addRecipient(conn, email);
  }

  // Set subject
  if (options.subject) {
    await setSubject(conn, options.subject);
  }

  // Set body
  const bodyContent = options.html || options.body;
  if (bodyContent) {
    await setBody(conn, textToHtml(bodyContent));
  }

  // Send the email
  info("Sending email...");
  const sent = await sendDraft(conn);

  if (sent) {
    success("Email sent!");
  } else {
    error("Failed to send email");
    process.exitCode = 1;
  }

  emitCommandJson(options, sent, {
    sent,
    draftId: draftKey,
    to: options.to,
  });

  await disconnect(conn);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function truncate(str: string | null | undefined, maxLen: number): string {
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

async function cmdInbox(options: CliOptions) {
  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  let threads: Awaited<ReturnType<typeof listInbox>>;
  try {
    threads = await listInbox(conn, { limit: options.limit });
  } catch (e) {
    const message = (e as Error).message;
    if (options.json) {
      emitCommandJson(options, false, { error: message });
    } else {
      error(`Failed to list inbox: ${message}`);
    }
    await disconnect(conn);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(threads, null, 2));
  } else {
    if (threads.length === 0) {
      info("No emails in inbox");
    } else {
      // Print header
      console.log(
        `${colors.dim}${"From".padEnd(25)} ${"Subject".padEnd(40)} ${"Date".padEnd(10)}${colors.reset}`
      );
      console.log(colors.dim + "─".repeat(78) + colors.reset);

      for (const thread of threads) {
        const from = truncate(thread.from.name || thread.from.email, 24);
        const subject = truncate(thread.subject, 39);
        const date = formatDate(thread.date);
        console.log(`${from.padEnd(25)} ${subject.padEnd(40)} ${date}`);
      }
    }
  }

  await disconnect(conn);
}

async function cmdSearch(options: CliOptions) {
  if (!options.query) {
    error("Search query is required");
    console.log(`Usage: superhuman search <query>`);
    process.exit(1);
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  let threads: Awaited<ReturnType<typeof searchInbox>>;
  try {
    threads = await searchInbox(conn, {
      query: options.query,
      limit: options.limit,
    });
  } catch (e) {
    const message = (e as Error).message;
    if (options.json) {
      emitCommandJson(options, false, { error: message, query: options.query });
    } else {
      error(`Search failed: ${message}`);
    }
    await disconnect(conn);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(threads, null, 2));
  } else {
    if (threads.length === 0) {
      info(`No results for "${options.query}"`);
    } else {
      info(`Found ${threads.length} result(s) for "${options.query}":\n`);
      console.log(
        `${colors.dim}${"From".padEnd(25)} ${"Subject".padEnd(40)} ${"Date".padEnd(10)}${colors.reset}`
      );
      console.log(colors.dim + "─".repeat(78) + colors.reset);

      for (const thread of threads) {
        const from = truncate(thread.from.name || thread.from.email, 24);
        const subject = truncate(thread.subject, 39);
        const date = formatDate(thread.date);
        console.log(`${from.padEnd(25)} ${subject.padEnd(40)} ${date}`);
      }
    }
  }

  await disconnect(conn);
}

async function cmdRead(options: CliOptions) {
  if (!options.threadId) {
    error("Thread ID is required");
    console.log(`Usage: superhuman read <thread-id>`);
    process.exit(1);
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  let messages: Awaited<ReturnType<typeof readThread>>;
  try {
    messages = await readThread(conn, options.threadId);
  } catch (e) {
    const message = (e as Error).message;
    if (options.json) {
      emitCommandJson(options, false, { error: message, threadId: options.threadId });
    } else {
      error(`Failed to read thread ${options.threadId}: ${message}`);
    }
    await disconnect(conn);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(messages, null, 2));
  } else {
    if (messages.length === 0) {
      error("Thread not found or no messages");
    } else {
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (i > 0) {
          console.log("\n" + colors.dim + "─".repeat(60) + colors.reset + "\n");
        }
        console.log(`${colors.bold}${msg.subject}${colors.reset}`);
        console.log(`${colors.cyan}From:${colors.reset} ${msg.from.name} <${msg.from.email}>`);
        console.log(
          `${colors.cyan}To:${colors.reset} ${msg.to.map((r) => r.email).join(", ")}`
        );
        if (msg.cc.length > 0) {
          console.log(
            `${colors.cyan}Cc:${colors.reset} ${msg.cc.map((r) => r.email).join(", ")}`
          );
        }
        console.log(`${colors.cyan}Date:${colors.reset} ${new Date(msg.date).toLocaleString()}`);
        console.log();
        console.log(msg.snippet);
      }
    }
  }

  await disconnect(conn);
}

async function cmdReply(options: CliOptions) {
  if (!options.threadId) {
    error("Thread ID is required");
    console.log(`Usage: superhuman reply <thread-id> [--body "text"] [--send]`);
    process.exit(1);
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const body = options.body || "";
  const action = options.send ? "Sending" : "Creating draft for";
  info(`${action} reply to thread ${options.threadId}...`);

  const result = await replyToThread(conn, options.threadId, body, options.send);

  if (result.success) {
    if (options.send) {
      success("Reply sent!");
    } else {
      success(`Draft saved (${result.draftId})`);
    }
  } else {
    error(result.error || "Failed to create reply");
    process.exitCode = 1;
  }

  emitCommandJson(options, result.success, {
    threadId: options.threadId,
    sent: options.send,
    draftId: result.draftId,
    error: result.error,
  });

  await disconnect(conn);
}

async function cmdReplyAll(options: CliOptions) {
  if (!options.threadId) {
    error("Thread ID is required");
    console.log(`Usage: superhuman reply-all <thread-id> [--body "text"] [--send]`);
    process.exit(1);
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const body = options.body || "";
  const action = options.send ? "Sending" : "Creating draft for";
  info(`${action} reply-all to thread ${options.threadId}...`);

  const result = await replyAllToThread(conn, options.threadId, body, options.send);

  if (result.success) {
    if (options.send) {
      success("Reply-all sent!");
    } else {
      success(`Draft saved (${result.draftId})`);
    }
  } else {
    error(result.error || "Failed to create reply-all");
    process.exitCode = 1;
  }

  emitCommandJson(options, result.success, {
    threadId: options.threadId,
    sent: options.send,
    draftId: result.draftId,
    error: result.error,
  });

  await disconnect(conn);
}

async function cmdForward(options: CliOptions) {
  if (!options.threadId) {
    error("Thread ID is required");
    console.log(`Usage: superhuman forward <thread-id> --to <email> [--body "text"] [--send]`);
    process.exit(1);
  }

  if (options.to.length === 0) {
    error("Recipient is required (--to)");
    console.log(`Usage: superhuman forward <thread-id> --to <email> [--body "text"] [--send]`);
    process.exit(1);
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const body = options.body || "";
  const toEmail = options.to[0]; // Use first recipient for forward
  const action = options.send ? "Sending" : "Creating draft for";
  info(`${action} forward to ${toEmail}...`);

  const result = await forwardThread(conn, options.threadId, toEmail, body, options.send);

  if (result.success) {
    if (options.send) {
      success("Forward sent!");
    } else {
      success(`Draft saved (${result.draftId})`);
    }
  } else {
    error(result.error || "Failed to create forward");
    process.exitCode = 1;
  }

  emitCommandJson(options, result.success, {
    threadId: options.threadId,
    to: toEmail,
    sent: options.send,
    draftId: result.draftId,
    error: result.error,
  });

  await disconnect(conn);
}

interface ThreadActionResult {
  success: boolean;
  error?: string;
}

interface ThreadActionConfig {
  usage: string;
  summaryVerb: string;
  dryRunVerb: string;
  onSuccess: (threadId: string) => string;
  onFailure: (threadId: string, error?: string) => string;
  run: (conn: SuperhumanConnection, threadId: string) => Promise<ThreadActionResult>;
  extraJson?: Record<string, unknown>;
}

async function runThreadActionCommand(options: CliOptions, config: ThreadActionConfig) {
  if (options.threadIds.length === 0) {
    error("At least one thread ID is required");
    console.log(config.usage);
    process.exit(1);
  }

  if (options.dryRun) {
    for (const threadId of options.threadIds) {
      info(`[dry-run] Would ${config.dryRunVerb}: ${threadId}`);
    }
    emitCommandJson(options, true, {
      summary: {
        total: options.threadIds.length,
        successCount: options.threadIds.length,
        failCount: 0,
      },
      results: options.threadIds.map((threadId) => ({
        threadId,
        success: true,
        dryRun: true,
      })),
      ...config.extraJson,
    });
    return;
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  let successCount = 0;
  let failCount = 0;
  const results: Array<{ threadId: string; success: boolean; error?: string }> = [];

  for (const threadId of options.threadIds) {
    const result = await config.run(conn, threadId);
    if (result.success) {
      success(config.onSuccess(threadId));
      successCount++;
      results.push({ threadId, success: true });
    } else {
      error(config.onFailure(threadId, result.error));
      failCount++;
      results.push({ threadId, success: false, error: result.error });
    }
  }

  if (options.threadIds.length > 1 && !options.json) {
    log(`\n${successCount} ${config.summaryVerb}, ${failCount} failed`);
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }

  emitCommandJson(options, failCount === 0, {
    summary: {
      total: options.threadIds.length,
      successCount,
      failCount,
    },
    results,
    ...config.extraJson,
  });

  await disconnect(conn);
}

async function cmdArchive(options: CliOptions) {
  await runThreadActionCommand(options, {
    usage: "Usage: superhuman archive <thread-id> [thread-id...] [--yes] [--dry-run]",
    summaryVerb: "archived",
    dryRunVerb: "archive",
    onSuccess: (threadId) => `Archived: ${threadId}`,
    onFailure: (threadId, opError) => `Failed to archive: ${threadId}${opError ? ` (${opError})` : ""}`,
    run: archiveThread,
  });
}

async function cmdDelete(options: CliOptions) {
  await runThreadActionCommand(options, {
    usage: "Usage: superhuman delete <thread-id> [thread-id...] [--yes] [--dry-run]",
    summaryVerb: "deleted",
    dryRunVerb: "delete",
    onSuccess: (threadId) => `Deleted: ${threadId}`,
    onFailure: (threadId, opError) => `Failed to delete: ${threadId}${opError ? ` (${opError})` : ""}`,
    run: deleteThread,
  });
}

async function cmdMarkRead(options: CliOptions) {
  await runThreadActionCommand(options, {
    usage: "Usage: superhuman mark-read <thread-id> [thread-id...] [--yes] [--dry-run]",
    summaryVerb: "marked as read",
    dryRunVerb: "mark as read",
    onSuccess: (threadId) => `Marked as read: ${threadId}`,
    onFailure: (threadId, opError) => `Failed to mark as read: ${threadId}${opError ? ` (${opError})` : ""}`,
    run: markAsRead,
  });
}

async function cmdMarkUnread(options: CliOptions) {
  await runThreadActionCommand(options, {
    usage: "Usage: superhuman mark-unread <thread-id> [thread-id...] [--yes] [--dry-run]",
    summaryVerb: "marked as unread",
    dryRunVerb: "mark as unread",
    onSuccess: (threadId) => `Marked as unread: ${threadId}`,
    onFailure: (threadId, opError) => `Failed to mark as unread: ${threadId}${opError ? ` (${opError})` : ""}`,
    run: markAsUnread,
  });
}

async function cmdLabels(options: CliOptions) {
  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const labels = await listLabels(conn);

  if (options.json) {
    console.log(JSON.stringify(labels, null, 2));
  } else {
    if (labels.length === 0) {
      info("No labels found");
    } else {
      console.log(`${colors.bold}Labels:${colors.reset}\n`);
      for (const label of labels) {
        const typeInfo = label.type ? ` ${colors.dim}(${label.type})${colors.reset}` : "";
        console.log(`  ${label.name}${typeInfo}`);
        console.log(`    ${colors.dim}ID: ${label.id}${colors.reset}`);
      }
    }
  }

  await disconnect(conn);
}

async function cmdGetLabels(options: CliOptions) {
  if (!options.threadId) {
    error("Thread ID is required");
    console.log(`Usage: superhuman get-labels <thread-id>`);
    process.exit(1);
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const labels = await getThreadLabels(conn, options.threadId);

  if (options.json) {
    console.log(JSON.stringify(labels, null, 2));
  } else {
    if (labels.length === 0) {
      info("No labels on this thread");
    } else {
      console.log(`${colors.bold}Labels on thread:${colors.reset}\n`);
      for (const label of labels) {
        const typeInfo = label.type ? ` ${colors.dim}(${label.type})${colors.reset}` : "";
        console.log(`  ${label.name}${typeInfo}`);
        console.log(`    ${colors.dim}ID: ${label.id}${colors.reset}`);
      }
    }
  }

  await disconnect(conn);
}

async function cmdAddLabel(options: CliOptions) {
  if (options.threadIds.length === 0) {
    error("At least one thread ID is required");
    console.log(`Usage: superhuman add-label <thread-id> [thread-id...] --label <label-id>`);
    process.exit(1);
  }

  if (!options.labelId) {
    error("Label ID is required (--label)");
    console.log(`Usage: superhuman add-label <thread-id> [thread-id...] --label <label-id>`);
    process.exit(1);
  }

  await runThreadActionCommand(options, {
    usage: "Usage: superhuman add-label <thread-id> [thread-id...] --label <label-id> [--yes] [--dry-run]",
    summaryVerb: "labeled",
    dryRunVerb: `add label ${options.labelId}`,
    onSuccess: (threadId) => `Added label to: ${threadId}`,
    onFailure: (threadId, opError) => `Failed to add label to: ${threadId}${opError ? ` (${opError})` : ""}`,
    run: (conn, threadId) => addLabel(conn, threadId, options.labelId),
    extraJson: { labelId: options.labelId },
  });
}

async function cmdRemoveLabel(options: CliOptions) {
  if (options.threadIds.length === 0) {
    error("At least one thread ID is required");
    console.log(`Usage: superhuman remove-label <thread-id> [thread-id...] --label <label-id>`);
    process.exit(1);
  }

  if (!options.labelId) {
    error("Label ID is required (--label)");
    console.log(`Usage: superhuman remove-label <thread-id> [thread-id...] --label <label-id>`);
    process.exit(1);
  }

  await runThreadActionCommand(options, {
    usage: "Usage: superhuman remove-label <thread-id> [thread-id...] --label <label-id> [--yes] [--dry-run]",
    summaryVerb: "updated",
    dryRunVerb: `remove label ${options.labelId}`,
    onSuccess: (threadId) => `Removed label from: ${threadId}`,
    onFailure: (threadId, opError) => `Failed to remove label from: ${threadId}${opError ? ` (${opError})` : ""}`,
    run: (conn, threadId) => removeLabel(conn, threadId, options.labelId),
    extraJson: { labelId: options.labelId },
  });
}

async function cmdStar(options: CliOptions) {
  await runThreadActionCommand(options, {
    usage: "Usage: superhuman star <thread-id> [thread-id...] [--yes] [--dry-run]",
    summaryVerb: "starred",
    dryRunVerb: "star",
    onSuccess: (threadId) => `Starred thread: ${threadId}`,
    onFailure: (threadId, opError) => `Failed to star thread: ${threadId}${opError ? ` (${opError})` : ""}`,
    run: starThread,
  });
}

async function cmdUnstar(options: CliOptions) {
  await runThreadActionCommand(options, {
    usage: "Usage: superhuman unstar <thread-id> [thread-id...] [--yes] [--dry-run]",
    summaryVerb: "unstarred",
    dryRunVerb: "unstar",
    onSuccess: (threadId) => `Unstarred thread: ${threadId}`,
    onFailure: (threadId, opError) => `Failed to unstar thread: ${threadId}${opError ? ` (${opError})` : ""}`,
    run: unstarThread,
  });
}

async function cmdStarred(options: CliOptions) {
  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const threads = await listStarred(conn, options.limit);

  if (options.json) {
    console.log(JSON.stringify(threads, null, 2));
  } else {
    if (threads.length === 0) {
      info("No starred threads");
    } else {
      console.log(`${colors.bold}Starred threads:${colors.reset}\n`);
      for (const thread of threads) {
        console.log(`  ${thread.id}`);
      }
    }
  }

  await disconnect(conn);
}

async function cmdSnooze(options: CliOptions) {
  if (options.threadIds.length === 0) {
    error("At least one thread ID is required");
    console.log(`Usage: superhuman snooze <thread-id> [thread-id...] --until <time>`);
    process.exit(1);
  }

  if (!options.snoozeUntil) {
    error("Snooze time is required (--until)");
    console.log(`Usage: superhuman snooze <thread-id> --until <time>`);
    console.log(`  Presets: tomorrow, next-week, weekend, evening`);
    console.log(`  Or use ISO datetime: 2024-02-15T14:00:00Z`);
    process.exit(1);
  }

  let snoozeTime: Date;
  try {
    snoozeTime = parseSnoozeTime(options.snoozeUntil);
  } catch (e) {
    error(`Invalid snooze time: ${options.snoozeUntil}`);
    process.exit(1);
  }

  await runThreadActionCommand(options, {
    usage: "Usage: superhuman snooze <thread-id> [thread-id...] --until <time> [--yes] [--dry-run]",
    summaryVerb: "snoozed",
    dryRunVerb: `snooze until ${snoozeTime.toISOString()}`,
    onSuccess: (threadId) => `Snoozed thread: ${threadId} until ${snoozeTime.toLocaleString()}`,
    onFailure: (threadId, opError) => `Failed to snooze thread: ${threadId}${opError ? ` (${opError})` : ""}`,
    run: (conn, threadId) => snoozeThread(conn, threadId, snoozeTime),
    extraJson: {
      until: snoozeTime.toISOString(),
      untilDisplay: snoozeTime.toLocaleString(),
    },
  });
}

async function cmdUnsnooze(options: CliOptions) {
  await runThreadActionCommand(options, {
    usage: "Usage: superhuman unsnooze <thread-id> [thread-id...] [--yes] [--dry-run]",
    summaryVerb: "unsnoozed",
    dryRunVerb: "unsnooze",
    onSuccess: (threadId) => `Unsnoozed thread: ${threadId}`,
    onFailure: (threadId, opError) => `Failed to unsnooze thread: ${threadId}${opError ? ` (${opError})` : ""}`,
    run: unsnoozeThread,
  });
}

async function cmdSnoozed(options: CliOptions) {
  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const threads = await listSnoozed(conn, options.limit);

  if (options.json) {
    console.log(JSON.stringify(threads, null, 2));
  } else {
    if (threads.length === 0) {
      info("No snoozed threads");
    } else {
      console.log(`${colors.bold}Snoozed threads:${colors.reset}\n`);
      for (const thread of threads) {
        const untilStr = thread.snoozeUntil
          ? ` (until ${new Date(thread.snoozeUntil).toLocaleString()})`
          : "";
        console.log(`  ${thread.id}${untilStr}`);
      }
    }
  }

  await disconnect(conn);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function cmdAttachments(options: CliOptions) {
  if (!options.threadId) {
    error("Thread ID is required");
    console.log(`Usage: superhuman attachments <thread-id>`);
    process.exit(1);
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const attachments = await listAttachments(conn, options.threadId);

  if (options.json) {
    console.log(JSON.stringify(attachments, null, 2));
  } else {
    if (attachments.length === 0) {
      info("No attachments in this thread");
    } else {
      console.log(`${colors.bold}Attachments:${colors.reset}\n`);
      for (const att of attachments) {
        console.log(`  ${colors.cyan}${att.name}${colors.reset}`);
        console.log(`    ${colors.dim}Type: ${att.mimeType}${colors.reset}`);
        console.log(`    ${colors.dim}Attachment ID: ${att.attachmentId}${colors.reset}`);
        console.log(`    ${colors.dim}Message ID: ${att.messageId}${colors.reset}`);
      }
    }
  }

  await disconnect(conn);
}

async function cmdDownload(options: CliOptions) {
  // Mode 1: Download specific attachment with --attachment and --message
  if (options.attachmentId) {
    if (!options.messageId) {
      error("Message ID is required when using --attachment");
      console.log(`Usage: superhuman download --attachment <attachment-id> --message <message-id> --output <path>`);
      process.exit(1);
    }

    const conn = await checkConnection(options.port, options.autoLaunch);
    if (!conn) {
      process.exit(1);
    }

    try {
      info(`Downloading attachment ${options.attachmentId}...`);
      const content = await downloadAttachment(conn, options.messageId, options.attachmentId);
      const outputPath = options.outputPath || `attachment-${options.attachmentId}`;
      await Bun.write(outputPath, Buffer.from(content.data, "base64"));
      success(`Downloaded: ${outputPath} (${formatFileSize(content.size)})`);
      emitCommandJson(options, true, {
        attachmentId: options.attachmentId,
        messageId: options.messageId,
        outputPath,
        size: content.size,
      });
    } catch (e) {
      const message = (e as Error).message;
      error(`Failed to download: ${message}`);
      process.exitCode = 1;
      emitCommandJson(options, false, {
        attachmentId: options.attachmentId,
        messageId: options.messageId,
        error: message,
      });
    }

    await disconnect(conn);
    return;
  }

  // Mode 2: Download all attachments from a thread
  if (!options.threadId) {
    error("Thread ID is required, or use --attachment with --message");
    console.log(`Usage: superhuman download <thread-id> [--output <dir>]`);
    console.log(`       superhuman download --attachment <id> --message <id> --output <path>`);
    process.exit(1);
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const attachments = await listAttachments(conn, options.threadId);

  if (attachments.length === 0) {
    info("No attachments in this thread");
    await disconnect(conn);
    return;
  }

  const outputDir = options.outputPath || ".";
  let successCount = 0;
  let failCount = 0;
  const results: Array<{
    attachmentId: string;
    messageId: string;
    name: string;
    success: boolean;
    outputPath?: string;
    size?: number;
    error?: string;
  }> = [];

  for (const att of attachments) {
    try {
      info(`Downloading ${att.name}...`);
      const content = await downloadAttachment(
        conn,
        att.messageId,
        att.attachmentId,
        att.threadId,
        att.mimeType
      );
      const outputPath = `${outputDir}/${att.name}`;
      await Bun.write(outputPath, Buffer.from(content.data, "base64"));
      success(`Downloaded: ${outputPath} (${formatFileSize(content.size)})`);
      successCount++;
      results.push({
        attachmentId: att.attachmentId,
        messageId: att.messageId,
        name: att.name,
        success: true,
        outputPath,
        size: content.size,
      });
    } catch (e) {
      const message = (e as Error).message;
      error(`Failed to download ${att.name}: ${message}`);
      failCount++;
      results.push({
        attachmentId: att.attachmentId,
        messageId: att.messageId,
        name: att.name,
        success: false,
        error: message,
      });
    }
  }

  if (attachments.length > 1) {
    log(`\n${successCount} downloaded, ${failCount} failed`);
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }

  emitCommandJson(options, failCount === 0, {
    threadId: options.threadId,
    summary: {
      total: attachments.length,
      successCount,
      failCount,
    },
    results,
  });

  await disconnect(conn);
}

async function cmdAccounts(options: CliOptions) {
  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const accounts = await listAccounts(conn);

  if (options.json) {
    console.log(formatAccountsJson(accounts));
  } else {
    if (accounts.length === 0) {
      info("No linked accounts found");
    } else {
      console.log(formatAccountsList(accounts));
    }
  }

  await disconnect(conn);
}

async function cmdAccount(options: CliOptions) {
  if (!options.accountArg) {
    error("Account index or email is required");
    console.log(`Usage: superhuman account <index|email>`);
    process.exit(1);
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const accounts = await listAccounts(conn);

  // Determine target email: either by index (1-based) or by email
  let targetEmail: string | undefined;

  const indexMatch = options.accountArg.match(/^\d+$/);
  if (indexMatch) {
    const index = parseInt(options.accountArg, 10);
    if (index < 1 || index > accounts.length) {
      error(`Invalid account index: ${index}. Valid range: 1-${accounts.length}`);
      await disconnect(conn);
      process.exit(1);
    }
    targetEmail = accounts[index - 1].email;
  } else {
    // Treat as email
    const found = accounts.find(
      (a) => a.email.toLowerCase() === options.accountArg.toLowerCase()
    );
    if (!found) {
      error(`Account not found: ${options.accountArg}`);
      info("Available accounts:");
      console.log(formatAccountsList(accounts));
      await disconnect(conn);
      process.exit(1);
    }
    targetEmail = found.email;
  }

  // Check if already on this account
  const currentAccount = accounts.find((a) => a.isCurrent);
  if (currentAccount && currentAccount.email === targetEmail) {
    info(`Already on account: ${targetEmail}`);
    emitCommandJson(options, true, {
      switched: false,
      currentAccount: targetEmail,
    });
    await disconnect(conn);
    return;
  }

  // Switch to the target account
  const result = await switchAccount(conn, targetEmail);

  if (result.success) {
    success(`Switched to ${result.email}`);
  } else {
    error(`Failed to switch to ${targetEmail}`);
    if (result.email) {
      info(`Current account: ${result.email}`);
    }
    process.exitCode = 1;
  }

  emitCommandJson(options, result.success, {
    requestedAccount: targetEmail,
    currentAccount: result.email,
    switched: result.success,
  });

  await disconnect(conn);
}

/**
 * Parse a date string into a Date object
 * Supports: "today", "tomorrow", ISO date (YYYY-MM-DD), or any Date.parse-able string
 */
function parseCalendarDate(dateStr: string): Date {
  const now = new Date();
  const lowerDate = dateStr.toLowerCase();

  if (lowerDate === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (lowerDate === "tomorrow") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  }

  // Try parsing as-is
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  throw new Error(`Invalid date: ${dateStr}`);
}

/**
 * Parse a time string into a Date object
 * Supports: ISO datetime, or simple times like "2pm", "14:00", "tomorrow 3pm"
 */
function parseEventTime(timeStr: string): Date {
  const now = new Date();

  // Try ISO format first
  const iso = new Date(timeStr);
  if (!isNaN(iso.getTime())) {
    return iso;
  }

  // Simple time patterns
  const lowerTime = timeStr.toLowerCase();

  // Check for "tomorrow" prefix
  let baseDate = now;
  let timePart = lowerTime;
  if (lowerTime.startsWith("tomorrow")) {
    baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timePart = lowerTime.replace("tomorrow", "").trim();
  }

  // Parse time like "2pm", "14:00", "3:30pm"
  const timeMatch = timePart.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = timeMatch[3]?.toLowerCase();

    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;

    return new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate(),
      hours,
      minutes
    );
  }

  throw new Error(`Invalid time: ${timeStr}`);
}

/**
 * Format a calendar event for display
 */
function formatCalendarEvent(event: CalendarEvent & { account?: string }, showAccount = false): string {
  const lines: string[] = [];

  // Time
  let timeStr = "";
  if (event.allDay || event.start.date) {
    timeStr = "All Day";
  } else if (event.start.dateTime) {
    const start = new Date(event.start.dateTime);
    const end = event.end.dateTime ? new Date(event.end.dateTime) : null;
    timeStr = start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (end) {
      timeStr += ` - ${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }
  }

  // Account indicator (shortened)
  let accountTag = "";
  if (showAccount && event.account) {
    const shortAccount = event.account.split("@")[0].slice(0, 8);
    accountTag = ` ${colors.magenta}[${shortAccount}]${colors.reset}`;
  }

  lines.push(`${colors.cyan}${timeStr}${colors.reset} ${colors.bold}${event.summary || "(No title)"}${colors.reset}${accountTag}`);

  if (event.description) {
    lines.push(`  ${colors.dim}${event.description.substring(0, 80)}${event.description.length > 80 ? "..." : ""}${colors.reset}`);
  }

  if (event.attendees && event.attendees.length > 0) {
    const attendeeStr = event.attendees.map(a => a.email).slice(0, 3).join(", ");
    const more = event.attendees.length > 3 ? ` +${event.attendees.length - 3} more` : "";
    lines.push(`  ${colors.dim}With: ${attendeeStr}${more}${colors.reset}`);
  }

  lines.push(`  ${colors.dim}ID: ${event.id}${colors.reset}`);

  return lines.join("\n");
}

async function cmdCalendar(options: CliOptions) {
  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  // Parse date range
  let timeMin: Date;
  let timeMax: Date;

  if (options.calendarDate) {
    timeMin = parseCalendarDate(options.calendarDate);
  } else {
    timeMin = new Date();
    timeMin.setHours(0, 0, 0, 0);
  }

  timeMax = new Date(timeMin);
  timeMax.setDate(timeMax.getDate() + options.calendarRange);
  timeMax.setHours(23, 59, 59, 999);

  let allEvents: CalendarEvent[] = [];

  if (options.allAccounts) {
    // Get all accounts and query each
    const accounts = await listAccounts(conn);
    const originalAccount = accounts.find((a) => a.isCurrent)?.email;

    for (const account of accounts) {
      // Switch to this account
      await switchAccount(conn, account.email);
      // Small delay for account switch to take effect
      await new Promise(r => setTimeout(r, 300));

      const events = await listEvents(conn, { timeMin, timeMax });
      // Tag events with account info
      for (const event of events) {
        (event as CalendarEvent & { account?: string }).account = account.email;
      }
      allEvents.push(...events);
    }

    // Switch back to original account
    if (originalAccount) {
      await switchAccount(conn, originalAccount);
    }
  } else {
    allEvents = await listEvents(conn, { timeMin, timeMax });
  }

  // Sort all events by start time
  allEvents.sort((a, b) => {
    const aTime = a.start.dateTime || a.start.date || "";
    const bTime = b.start.dateTime || b.start.date || "";
    return aTime.localeCompare(bTime);
  });

  if (options.json) {
    console.log(JSON.stringify(allEvents, null, 2));
  } else {
    if (allEvents.length === 0) {
      info("No events found for the specified date range");
    } else {
      // Group events by date
      const byDate = new Map<string, CalendarEvent[]>();
      for (const event of allEvents) {
        const dateStr = event.start.date || (event.start.dateTime ? new Date(event.start.dateTime).toDateString() : "Unknown");
        if (!byDate.has(dateStr)) {
          byDate.set(dateStr, []);
        }
        byDate.get(dateStr)!.push(event);
      }

      for (const [date, dayEvents] of byDate) {
        console.log(`\n${colors.bold}${date}${colors.reset}`);
        for (const event of dayEvents) {
          console.log(formatCalendarEvent(event, options.allAccounts));
        }
      }
    }
  }

  await disconnect(conn);
}

async function cmdCalendarCreate(options: CliOptions) {
  if (!options.eventTitle && !options.subject) {
    error("Event title is required (--title)");
    process.exit(1);
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const title = options.eventTitle || options.subject;
  let startTime: Date;
  let endTime: Date;

  // Determine if this is an all-day event
  const isAllDay = options.calendarDate && !options.eventStart;

  if (isAllDay) {
    startTime = parseCalendarDate(options.calendarDate);
    endTime = new Date(startTime);
    endTime.setDate(endTime.getDate() + 1);
  } else {
    if (!options.eventStart) {
      error("Event start time is required (--start) or use --date for all-day event");
      await disconnect(conn);
      process.exit(1);
    }

    startTime = parseEventTime(options.eventStart);

    if (options.eventEnd) {
      endTime = parseEventTime(options.eventEnd);
    } else {
      endTime = new Date(startTime.getTime() + options.eventDuration * 60 * 1000);
    }
  }

  const eventInput: CreateEventInput = {
    summary: title,
    description: options.body || undefined,
    start: isAllDay
      ? { date: startTime.toISOString().split("T")[0] }
      : { dateTime: startTime.toISOString() },
    end: isAllDay
      ? { date: endTime.toISOString().split("T")[0] }
      : { dateTime: endTime.toISOString() },
  };

  // Add attendees from --to option
  if (options.to.length > 0) {
    eventInput.attendees = options.to.map(email => ({ email }));
  }

  const result = await createEvent(conn, eventInput);

  if (result.success) {
    success(`Event created: ${result.eventId}`);
  } else {
    error(`Failed to create event: ${result.error}`);
    if (result.error?.includes("no-auth")) {
      info("Calendar write access may not be authorized in Superhuman");
    }
    process.exitCode = 1;
  }

  emitCommandJson(options, result.success, {
    eventId: result.eventId,
    error: result.error,
  });

  await disconnect(conn);
}

async function cmdCalendarUpdate(options: CliOptions) {
  if (!options.eventId) {
    error("Event ID is required (--event)");
    process.exit(1);
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const updates: UpdateEventInput = {};

  if (options.eventTitle || options.subject) {
    updates.summary = options.eventTitle || options.subject;
  }
  if (options.body) {
    updates.description = options.body;
  }
  if (options.eventStart) {
    const startTime = parseEventTime(options.eventStart);
    updates.start = { dateTime: startTime.toISOString() };

    // Also update end if not specified
    if (!options.eventEnd) {
      const endTime = new Date(startTime.getTime() + options.eventDuration * 60 * 1000);
      updates.end = { dateTime: endTime.toISOString() };
    }
  }
  if (options.eventEnd) {
    const endTime = parseEventTime(options.eventEnd);
    updates.end = { dateTime: endTime.toISOString() };
  }
  if (options.to.length > 0) {
    updates.attendees = options.to.map(email => ({ email }));
  }

  if (Object.keys(updates).length === 0) {
    error("No updates specified. Use --title, --start, --end, --body, or --to");
    await disconnect(conn);
    process.exit(1);
  }

  const result = await updateEvent(conn, options.eventId, updates);

  if (result.success) {
    success(`Event updated: ${result.eventId}`);
  } else {
    error(`Failed to update event: ${result.error}`);
    if (result.error?.includes("no-auth")) {
      info("Calendar write access may not be authorized in Superhuman");
    }
    process.exitCode = 1;
  }

  emitCommandJson(options, result.success, {
    eventId: result.eventId || options.eventId,
    error: result.error,
  });

  await disconnect(conn);
}

async function cmdCalendarDelete(options: CliOptions) {
  if (!options.eventId) {
    error("Event ID is required (--event)");
    process.exit(1);
  }

  if (options.dryRun) {
    info(`[dry-run] Would delete calendar event: ${options.eventId}`);
    emitCommandJson(options, true, {
      eventId: options.eventId,
      deleted: false,
      dryRun: true,
    });
    return;
  }

  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  const result = await deleteCalendarEvent(conn, options.eventId);

  if (result.success) {
    success(`Event deleted: ${options.eventId}`);
  } else {
    error(`Failed to delete event: ${result.error}`);
    if (result.error?.includes("no-auth")) {
      info("Calendar write access may not be authorized in Superhuman");
    }
    process.exitCode = 1;
  }

  emitCommandJson(options, result.success, {
    eventId: options.eventId,
    deleted: result.success,
    error: result.error,
  });

  await disconnect(conn);
}

async function cmdCalendarFree(options: CliOptions) {
  const conn = await checkConnection(options.port, options.autoLaunch);
  if (!conn) {
    process.exit(1);
  }

  // Parse date range
  let timeMin: Date;
  let timeMax: Date;

  if (options.calendarDate) {
    timeMin = parseCalendarDate(options.calendarDate);
  } else {
    timeMin = new Date();
  }

  timeMax = new Date(timeMin);
  timeMax.setDate(timeMax.getDate() + options.calendarRange);

  const result = await getFreeBusy(conn, { timeMin, timeMax });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.busy.length === 0) {
      success("You are free for the specified time range!");
    } else {
      console.log(`\n${colors.bold}Busy times:${colors.reset}`);
      for (const slot of result.busy) {
        const start = new Date(slot.start);
        const end = new Date(slot.end);
        console.log(`  ${colors.red}●${colors.reset} ${start.toLocaleString()} - ${end.toLocaleTimeString()}`);
      }
    }
  }

  await disconnect(conn);
}

async function main() {
  const args = process.argv.slice(2);
  let options: CliOptions;

  if (args.length === 0) {
    setColorEnabled(true);
    printHelp();
    process.exit(0);
  }

  try {
    options = parseArgs(args);
  } catch (e) {
    if (e instanceof CliParseError) {
      setColorEnabled(true);
      error(e.message);
      printHelp();
      process.exit(1);
    }
    throw e;
  }

  setColorEnabled(!options.noColor);

  if (options.showVersion) {
    console.log(VERSION);
    process.exit(0);
  }

  ensureBulkConfirmation(options);

  switch (options.command) {
    case "help":
    case "":
      printHelp();
      break;

    case "status":
      await cmdStatus(options);
      break;

    case "accounts":
      await cmdAccounts(options);
      break;

    case "account":
      await cmdAccount(options);
      break;

    case "inbox":
      await cmdInbox(options);
      break;

    case "search":
      await cmdSearch(options);
      break;

    case "read":
      await cmdRead(options);
      break;

    case "reply":
      await cmdReply(options);
      break;

    case "reply-all":
      await cmdReplyAll(options);
      break;

    case "forward":
      await cmdForward(options);
      break;

    case "archive":
      await cmdArchive(options);
      break;

    case "delete":
      await cmdDelete(options);
      break;

    case "mark-read":
      await cmdMarkRead(options);
      break;

    case "mark-unread":
      await cmdMarkUnread(options);
      break;

    case "labels":
      await cmdLabels(options);
      break;

    case "get-labels":
      await cmdGetLabels(options);
      break;

    case "add-label":
      await cmdAddLabel(options);
      break;

    case "remove-label":
      await cmdRemoveLabel(options);
      break;

    case "star":
      await cmdStar(options);
      break;

    case "unstar":
      await cmdUnstar(options);
      break;

    case "starred":
      await cmdStarred(options);
      break;

    case "snooze":
      await cmdSnooze(options);
      break;

    case "unsnooze":
      await cmdUnsnooze(options);
      break;

    case "snoozed":
      await cmdSnoozed(options);
      break;

    case "attachments":
      await cmdAttachments(options);
      break;

    case "download":
      await cmdDownload(options);
      break;

    case "calendar":
      await cmdCalendar(options);
      break;

    case "calendar-create":
      await cmdCalendarCreate(options);
      break;

    case "calendar-update":
      await cmdCalendarUpdate(options);
      break;

    case "calendar-delete":
      await cmdCalendarDelete(options);
      break;

    case "calendar-free":
      await cmdCalendarFree(options);
      break;

    case "compose":
      await cmdCompose(options, true);
      log(`\n${colors.dim}Compose window left open for editing${colors.reset}`);
      break;

    case "draft":
      await cmdDraft(options);
      break;

    case "send":
      await cmdSend(options);
      break;

    default:
      error(`Unknown command: ${options.command}`);
      printHelp();
      process.exit(1);
  }
}

// Only run main when executed directly (not when imported for testing)
if (import.meta.main) {
  main().catch((e) => {
    error(`Fatal error: ${e.message}`);
    process.exit(1);
  });
}
