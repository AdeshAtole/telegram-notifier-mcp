#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN) {
  console.error(
    "Error: TELEGRAM_BOT_TOKEN environment variable is required.\n" +
      "Get a token from @BotFather on Telegram.",
  );
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// Persist the getUpdates offset to disk so we don't re-fetch old messages after restart
const OFFSET_DIR = join(homedir(), ".telegram-notifier-mcp");
const OFFSET_FILE = join(OFFSET_DIR, "update-offset");

let updateOffset = 0;

async function loadOffset(): Promise<void> {
  try {
    const data = await readFile(OFFSET_FILE, "utf-8");
    const parsed = parseInt(data.trim(), 10);
    if (!isNaN(parsed)) updateOffset = parsed;
  } catch {
    // File doesn't exist yet — start from 0
  }
}

async function saveOffset(): Promise<void> {
  await mkdir(OFFSET_DIR, { recursive: true });
  await writeFile(OFFSET_FILE, String(updateOffset), "utf-8");
}

// ---------------------------------------------------------------------------
// Telegram Client
// ---------------------------------------------------------------------------

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: unknown;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string; title?: string };
    date: number;
    text?: string;
    caption?: string;
    photo?: unknown[];
    document?: { file_name?: string };
    video?: { file_name?: string };
    audio?: { file_name?: string };
  };
}

interface GetUpdatesResponse {
  ok: boolean;
  description?: string;
  result?: TelegramUpdate[];
}

async function getUpdates(
  limit: number,
  timeout: number,
): Promise<GetUpdatesResponse> {
  const params = new URLSearchParams({
    offset: String(updateOffset),
    limit: String(limit),
    timeout: String(timeout),
    allowed_updates: JSON.stringify(["message"]),
  });

  const res = await fetch(`${TELEGRAM_API}/getUpdates?${params}`, {
    method: "GET",
    signal: AbortSignal.timeout((timeout + 5) * 1000),
  });

  return (await res.json()) as GetUpdatesResponse;
}

function formatUpdate(update: TelegramUpdate): string {
  const msg = update.message;
  if (!msg) return `[Update ${update.update_id}] (no message)`;

  const from = msg.from
    ? `${msg.from.first_name}${msg.from.username ? ` (@${msg.from.username})` : ""}`
    : "Unknown";
  const date = new Date(msg.date * 1000).toISOString();

  let content = msg.text ?? "";
  if (msg.photo) content = `[Photo]${msg.caption ? ` ${msg.caption}` : ""}`;
  if (msg.document) content = `[Document: ${msg.document.file_name ?? "unknown"}]${msg.caption ? ` ${msg.caption}` : ""}`;
  if (msg.video) content = `[Video: ${msg.video.file_name ?? "unknown"}]${msg.caption ? ` ${msg.caption}` : ""}`;
  if (msg.audio) content = `[Audio: ${msg.audio.file_name ?? "unknown"}]${msg.caption ? ` ${msg.caption}` : ""}`;

  return `[${date}] ${from} (chat ${msg.chat.id}): ${content}`;
}

async function sendMessage(
  chatId: string,
  text: string,
  parseMode?: string,
  disableNotification?: boolean,
): Promise<TelegramResponse> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;
  if (disableNotification) body.disable_notification = true;

  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return (await res.json()) as TelegramResponse;
}

type FileMethod = "sendDocument" | "sendPhoto" | "sendVideo" | "sendAudio";

const FILE_FIELD: Record<FileMethod, string> = {
  sendDocument: "document",
  sendPhoto: "photo",
  sendVideo: "video",
  sendAudio: "audio",
};

async function sendFile(
  method: FileMethod,
  chatId: string,
  filePath: string,
  caption?: string,
  parseMode?: string,
  disableNotification?: boolean,
): Promise<TelegramResponse> {
  // Validate file exists and is within size limit
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    return { ok: false, description: `File not found: ${filePath}` };
  }

  if (fileStats.size > MAX_FILE_SIZE) {
    return {
      ok: false,
      description: `File exceeds 50 MB limit (${(fileStats.size / 1024 / 1024).toFixed(1)} MB): ${filePath}`,
    };
  }

  const fileBuffer = await readFile(filePath);
  const blob = new Blob([fileBuffer]);
  const fileName = basename(filePath);

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append(FILE_FIELD[method], blob, fileName);
  if (caption) form.append("caption", caption);
  if (parseMode) form.append("parse_mode", parseMode);
  if (disableNotification) form.append("disable_notification", "true");

  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    body: form,
  });

  return (await res.json()) as TelegramResponse;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveChatId(overrideChatId?: string): string | null {
  return overrideChatId || DEFAULT_CHAT_ID || null;
}

function successResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

function telegramResult(res: TelegramResponse, successMsg: string) {
  if (res.ok) return successResult(successMsg);
  return errorResult(`Telegram API error: ${res.description ?? "Unknown error"}`);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "telegram-notifier",
  version: "1.0.0",
});

// -- send_message -----------------------------------------------------------

server.tool(
  "send_message",
  "Send a text message to a Telegram chat",
  {
    text: z.string().describe("The message text to send"),
    chatId: z
      .string()
      .optional()
      .describe("Target chat ID (overrides TELEGRAM_CHAT_ID env var)"),
    parseMode: z
      .enum(["Markdown", "MarkdownV2", "HTML"])
      .optional()
      .describe("Message formatting mode"),
    disableNotification: z
      .boolean()
      .optional()
      .describe("Send silently without notification sound"),
  },
  async ({ text, chatId, parseMode, disableNotification }) => {
    const resolvedChatId = resolveChatId(chatId);
    if (!resolvedChatId) {
      return errorResult(
        "No chat ID provided. Set TELEGRAM_CHAT_ID env var or pass chatId parameter.",
      );
    }

    const res = await sendMessage(resolvedChatId, text, parseMode, disableNotification);
    return telegramResult(res, `Message sent to chat ${resolvedChatId}.`);
  },
);

// -- send_document ----------------------------------------------------------

server.tool(
  "send_document",
  "Send a file/document to a Telegram chat",
  {
    filePath: z.string().describe("Absolute path to the file to send"),
    chatId: z
      .string()
      .optional()
      .describe("Target chat ID (overrides TELEGRAM_CHAT_ID env var)"),
    caption: z.string().optional().describe("Caption for the document"),
    parseMode: z
      .enum(["Markdown", "MarkdownV2", "HTML"])
      .optional()
      .describe("Caption formatting mode"),
    disableNotification: z
      .boolean()
      .optional()
      .describe("Send silently without notification sound"),
  },
  async ({ filePath, chatId, caption, parseMode, disableNotification }) => {
    const resolvedChatId = resolveChatId(chatId);
    if (!resolvedChatId) {
      return errorResult(
        "No chat ID provided. Set TELEGRAM_CHAT_ID env var or pass chatId parameter.",
      );
    }

    const res = await sendFile(
      "sendDocument",
      resolvedChatId,
      filePath,
      caption,
      parseMode,
      disableNotification,
    );
    return telegramResult(res, `Document sent to chat ${resolvedChatId}.`);
  },
);

// -- send_photo -------------------------------------------------------------

server.tool(
  "send_photo",
  "Send a photo/image to a Telegram chat",
  {
    filePath: z.string().describe("Absolute path to the image file to send"),
    chatId: z
      .string()
      .optional()
      .describe("Target chat ID (overrides TELEGRAM_CHAT_ID env var)"),
    caption: z.string().optional().describe("Caption for the photo"),
    parseMode: z
      .enum(["Markdown", "MarkdownV2", "HTML"])
      .optional()
      .describe("Caption formatting mode"),
    disableNotification: z
      .boolean()
      .optional()
      .describe("Send silently without notification sound"),
  },
  async ({ filePath, chatId, caption, parseMode, disableNotification }) => {
    const resolvedChatId = resolveChatId(chatId);
    if (!resolvedChatId) {
      return errorResult(
        "No chat ID provided. Set TELEGRAM_CHAT_ID env var or pass chatId parameter.",
      );
    }

    const res = await sendFile(
      "sendPhoto",
      resolvedChatId,
      filePath,
      caption,
      parseMode,
      disableNotification,
    );
    return telegramResult(res, `Photo sent to chat ${resolvedChatId}.`);
  },
);

// -- send_video -------------------------------------------------------------

server.tool(
  "send_video",
  "Send a video to a Telegram chat",
  {
    filePath: z.string().describe("Absolute path to the video file to send"),
    chatId: z
      .string()
      .optional()
      .describe("Target chat ID (overrides TELEGRAM_CHAT_ID env var)"),
    caption: z.string().optional().describe("Caption for the video"),
    parseMode: z
      .enum(["Markdown", "MarkdownV2", "HTML"])
      .optional()
      .describe("Caption formatting mode"),
    disableNotification: z
      .boolean()
      .optional()
      .describe("Send silently without notification sound"),
  },
  async ({ filePath, chatId, caption, parseMode, disableNotification }) => {
    const resolvedChatId = resolveChatId(chatId);
    if (!resolvedChatId) {
      return errorResult(
        "No chat ID provided. Set TELEGRAM_CHAT_ID env var or pass chatId parameter.",
      );
    }

    const res = await sendFile(
      "sendVideo",
      resolvedChatId,
      filePath,
      caption,
      parseMode,
      disableNotification,
    );
    return telegramResult(res, `Video sent to chat ${resolvedChatId}.`);
  },
);

// -- send_audio -------------------------------------------------------------

server.tool(
  "send_audio",
  "Send an audio file to a Telegram chat",
  {
    filePath: z.string().describe("Absolute path to the audio file to send"),
    chatId: z
      .string()
      .optional()
      .describe("Target chat ID (overrides TELEGRAM_CHAT_ID env var)"),
    caption: z.string().optional().describe("Caption for the audio"),
    parseMode: z
      .enum(["Markdown", "MarkdownV2", "HTML"])
      .optional()
      .describe("Caption formatting mode"),
    disableNotification: z
      .boolean()
      .optional()
      .describe("Send silently without notification sound"),
  },
  async ({ filePath, chatId, caption, parseMode, disableNotification }) => {
    const resolvedChatId = resolveChatId(chatId);
    if (!resolvedChatId) {
      return errorResult(
        "No chat ID provided. Set TELEGRAM_CHAT_ID env var or pass chatId parameter.",
      );
    }

    const res = await sendFile(
      "sendAudio",
      resolvedChatId,
      filePath,
      caption,
      parseMode,
      disableNotification,
    );
    return telegramResult(res, `Audio sent to chat ${resolvedChatId}.`);
  },
);

// -- get_updates ------------------------------------------------------------

server.tool(
  "get_updates",
  "Check for new messages sent to the bot. Returns only new messages since the last check.",
  {
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Max number of messages to retrieve (1-100, default 10)"),
    timeout: z
      .number()
      .int()
      .min(0)
      .max(30)
      .optional()
      .describe("Long-polling timeout in seconds (0-30, default 0). Set >0 to wait for new messages."),
  },
  async ({ limit, timeout }) => {
    const effectiveLimit = limit ?? 10;
    const effectiveTimeout = timeout ?? 0;

    let res: GetUpdatesResponse;
    try {
      res = await getUpdates(effectiveLimit, effectiveTimeout);
    } catch (err) {
      return errorResult(
        `Failed to fetch updates: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!res.ok) {
      return errorResult(`Telegram API error: ${res.description ?? "Unknown error"}`);
    }

    const updates = res.result ?? [];

    // Advance the offset and persist so we survive restarts
    if (updates.length > 0) {
      updateOffset = updates[updates.length - 1].update_id + 1;
      await saveOffset();
    }

    if (updates.length === 0) {
      return successResult("No new messages.");
    }

    const formatted = updates.map(formatUpdate).join("\n");
    return successResult(`${updates.length} new message(s):\n\n${formatted}`);
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  await loadOffset();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Telegram Notifier MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
