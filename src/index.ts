#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

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

// ---------------------------------------------------------------------------
// Telegram Client
// ---------------------------------------------------------------------------

interface TelegramResponse {
  ok: boolean;
  description?: string;
  result?: unknown;
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

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Telegram Notifier MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
