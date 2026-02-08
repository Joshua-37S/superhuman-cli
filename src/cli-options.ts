import { getDefaultAutoLaunch, getDefaultCdpPort, shouldUseColorByDefault } from "./config";

export interface CliOptions {
  command: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  html: string;
  port: number;
  // inbox/search/read options
  limit: number;
  query: string;
  threadId: string;
  threadIds: string[];
  json: boolean;
  // account switching
  accountArg: string;
  // reply/forward options
  send: boolean;
  // label options
  labelId: string;
  // snooze options
  snoozeUntil: string;
  // attachment options
  outputPath: string;
  attachmentId: string;
  messageId: string;
  // calendar options
  calendarDate: string;
  calendarRange: number;
  allAccounts: boolean;
  eventStart: string;
  eventEnd: string;
  eventDuration: number;
  eventTitle: string;
  eventId: string;
  // runtime options
  autoLaunch: boolean;
  noColor: boolean;
  confirm: boolean;
  dryRun: boolean;
  showVersion: boolean;
}

export class CliParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliParseError";
  }
}

function parseIntOption(flag: string, value: string, min: number, max?: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    const range = max === undefined ? `>= ${min}` : `between ${min} and ${max}`;
    throw new CliParseError(`Invalid value for ${flag}: ${value}. Expected integer ${range}.`);
  }
  return parsed;
}

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new CliParseError(`Missing value for ${flag}`);
  }
  return value;
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    command: "",
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    body: "",
    html: "",
    port: getDefaultCdpPort(),
    limit: 10,
    query: "",
    threadId: "",
    threadIds: [],
    json: false,
    accountArg: "",
    send: false,
    labelId: "",
    snoozeUntil: "",
    outputPath: "",
    attachmentId: "",
    messageId: "",
    calendarDate: "",
    calendarRange: 1,
    allAccounts: false,
    eventStart: "",
    eventEnd: "",
    eventDuration: 30,
    eventTitle: "",
    eventId: "",
    autoLaunch: getDefaultAutoLaunch(),
    noColor: !shouldUseColorByDefault(),
    confirm: false,
    dryRun: false,
    showVersion: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) {
      break;
    }

    if (arg === "-h") {
      options.command = "help";
      i += 1;
      continue;
    }

    if (arg === "-v") {
      options.showVersion = true;
      i += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);

      switch (key) {
        case "to":
          options.to.push(readOptionValue(args, i, arg));
          i += 2;
          break;
        case "cc":
          options.cc.push(readOptionValue(args, i, arg));
          i += 2;
          break;
        case "bcc":
          options.bcc.push(readOptionValue(args, i, arg));
          i += 2;
          break;
        case "subject":
          options.subject = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "body":
          options.body = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "html":
          options.html = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "port": {
          const value = readOptionValue(args, i, arg);
          options.port = parseIntOption(arg, value, 1, 65535);
          i += 2;
          break;
        }
        case "help":
          options.command = "help";
          i += 1;
          break;
        case "version":
          options.showVersion = true;
          i += 1;
          break;
        case "limit": {
          const value = readOptionValue(args, i, arg);
          options.limit = parseIntOption(arg, value, 1);
          i += 2;
          break;
        }
        case "query":
          options.query = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "thread":
          options.threadId = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "json":
          options.json = true;
          i += 1;
          break;
        case "send":
          options.send = true;
          i += 1;
          break;
        case "label":
          options.labelId = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "until":
          options.snoozeUntil = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "output":
          options.outputPath = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "attachment":
          options.attachmentId = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "message":
          options.messageId = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "date":
          options.calendarDate = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "range": {
          const value = readOptionValue(args, i, arg);
          options.calendarRange = parseIntOption(arg, value, 1);
          i += 2;
          break;
        }
        case "all-accounts":
          options.allAccounts = true;
          i += 1;
          break;
        case "start":
          options.eventStart = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "end":
          options.eventEnd = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "duration": {
          const value = readOptionValue(args, i, arg);
          options.eventDuration = parseIntOption(arg, value, 1);
          i += 2;
          break;
        }
        case "title":
          options.eventTitle = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "event":
          options.eventId = readOptionValue(args, i, arg);
          i += 2;
          break;
        case "yes":
          options.confirm = true;
          i += 1;
          break;
        case "dry-run":
          options.dryRun = true;
          i += 1;
          break;
        case "no-color":
          options.noColor = true;
          i += 1;
          break;
        case "no-auto-launch":
          options.autoLaunch = false;
          i += 1;
          break;
        case "auto-launch":
          options.autoLaunch = true;
          i += 1;
          break;
        default:
          throw new CliParseError(`Unknown option: ${arg}`);
      }
      continue;
    }

    if (!options.command) {
      options.command = arg;
      i += 1;
      continue;
    }

    if (options.command === "search" && !options.query) {
      options.query = arg;
      i += 1;
      continue;
    }

    if ((options.command === "read" || options.command === "reply" || options.command === "reply-all" || options.command === "forward" || options.command === "get-labels" || options.command === "attachments") && !options.threadId) {
      options.threadId = arg;
      i += 1;
      continue;
    }

    if (options.command === "account" && !options.accountArg) {
      options.accountArg = arg;
      i += 1;
      continue;
    }

    if (
      options.command === "archive" ||
      options.command === "delete" ||
      options.command === "mark-read" ||
      options.command === "mark-unread" ||
      options.command === "add-label" ||
      options.command === "remove-label" ||
      options.command === "star" ||
      options.command === "unstar" ||
      options.command === "snooze" ||
      options.command === "unsnooze"
    ) {
      options.threadIds.push(arg);
      i += 1;
      continue;
    }

    if (options.command === "download" && !options.threadId && !options.attachmentId) {
      options.threadId = arg;
      i += 1;
      continue;
    }

    throw new CliParseError(`Unexpected argument: ${arg}`);
  }

  return options;
}
