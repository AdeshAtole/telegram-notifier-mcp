# Telegram Notifier MCP Server

An [MCP](https://modelcontextprotocol.io/) server that lets an LLM send messages and files to a user via a Telegram bot, and read incoming messages. No external HTTP or Telegram libraries — just the native `fetch` API and the official MCP SDK.

## Quick Start

No cloning or building required — just add the config to your MCP client.

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to name your bot
3. Copy the **bot token** you receive (e.g., `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

### 2. Find Your Chat ID

1. Send any message to your new bot on Telegram
2. Open the following URL in your browser, replacing `YOUR_BOT_TOKEN` with your actual token:
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```
3. In the JSON response, find `"chat":{"id": 123456789}` — that number is your chat ID

> **Tip:** For group chats, add the bot to the group, send a message, and check the same URL. Group chat IDs are negative numbers (e.g., `-1001234567890`).

### 3. Add to Your MCP Client

#### Claude Desktop

Add this to your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "telegram-notifier": {
      "command": "npx",
      "args": ["telegram-notifier-mcp"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "your-bot-token-here",
        "TELEGRAM_CHAT_ID": "your-chat-id-here"
      }
    }
  }
}
```

#### Claude Code

Add to your project's `.mcp.json` or `~/.claude.json`:

```json
{
  "mcpServers": {
    "telegram-notifier": {
      "command": "npx",
      "args": ["telegram-notifier-mcp"],
      "env": {
        "TELEGRAM_BOT_TOKEN": "your-bot-token-here",
        "TELEGRAM_CHAT_ID": "your-chat-id-here"
      }
    }
  }
}
```

That's it — your LLM can now send you Telegram notifications.

## Configuration

The server uses two environment variables:

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | No | Default chat ID. Can be overridden per-tool call via the `chatId` parameter. |

The server will exit with an error if `TELEGRAM_BOT_TOKEN` is not set. If `TELEGRAM_CHAT_ID` is not set, you must pass `chatId` to every tool call.

## Tools

### `send_message`

Send a text message to a Telegram chat.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `text` | string | Yes | The message text to send |
| `chatId` | string | No | Target chat ID (overrides `TELEGRAM_CHAT_ID`) |
| `parseMode` | string | No | `Markdown`, `MarkdownV2`, or `HTML` |
| `disableNotification` | boolean | No | Send silently without notification sound |

### `send_document`

Send a file/document to a Telegram chat.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `filePath` | string | Yes | Absolute path to the file |
| `chatId` | string | No | Target chat ID (overrides `TELEGRAM_CHAT_ID`) |
| `caption` | string | No | Caption for the document |
| `parseMode` | string | No | `Markdown`, `MarkdownV2`, or `HTML` |
| `disableNotification` | boolean | No | Send silently without notification sound |

### `send_photo`

Send a photo/image to a Telegram chat.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `filePath` | string | Yes | Absolute path to the image file |
| `chatId` | string | No | Target chat ID (overrides `TELEGRAM_CHAT_ID`) |
| `caption` | string | No | Caption for the photo |
| `parseMode` | string | No | `Markdown`, `MarkdownV2`, or `HTML` |
| `disableNotification` | boolean | No | Send silently without notification sound |

### `send_video`

Send a video to a Telegram chat.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `filePath` | string | Yes | Absolute path to the video file |
| `chatId` | string | No | Target chat ID (overrides `TELEGRAM_CHAT_ID`) |
| `caption` | string | No | Caption for the video |
| `parseMode` | string | No | `Markdown`, `MarkdownV2`, or `HTML` |
| `disableNotification` | boolean | No | Send silently without notification sound |

### `send_audio`

Send an audio file to a Telegram chat.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `filePath` | string | Yes | Absolute path to the audio file |
| `chatId` | string | No | Target chat ID (overrides `TELEGRAM_CHAT_ID`) |
| `caption` | string | No | Caption for the audio |
| `parseMode` | string | No | `Markdown`, `MarkdownV2`, or `HTML` |
| `disableNotification` | boolean | No | Send silently without notification sound |

### `get_updates`

Check for new messages sent to the bot. Only returns messages received since the last check.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | No | Max messages to retrieve (1-100, default 10) |
| `timeout` | number | No | Long-polling timeout in seconds (0-30, default 0). Set >0 to wait for new messages. |

## Testing with the MCP Inspector

You can test the server interactively using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
TELEGRAM_BOT_TOKEN="your-token" TELEGRAM_CHAT_ID="your-chat-id" \
  npx @modelcontextprotocol/inspector npx telegram-notifier-mcp
```

This opens a browser UI where you can invoke each tool and see the results.

## Error Handling

The server handles errors gracefully and returns descriptive messages:

| Scenario | Behavior |
|---|---|
| Missing `TELEGRAM_BOT_TOKEN` | Server exits at startup with instructions |
| Missing chat ID (no env var, no parameter) | Returns `isError: true` with message |
| File not found | Returns `isError: true` with the file path |
| File exceeds 50 MB | Returns `isError: true` with file size |
| Telegram API error | Returns `isError: true` with Telegram's error description |

All server logs go to **stderr** so they never interfere with the stdio MCP transport on stdout.

## File Size Limits

Telegram enforces a **50 MB** limit for file uploads via the Bot API. The server validates file size before uploading and returns an error if the limit is exceeded.

## Development

```bash
git clone https://github.com/AdeshAtole/telegram-notifier-mcp
cd telegram-notifier-mcp
npm install
npm run build

# Watch mode — rebuilds on file changes
npm run dev
```

## License

MIT
