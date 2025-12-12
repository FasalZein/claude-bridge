# Claude Bridge 🌉

An Anthropic API Gateway that lets you use **A4F** or **Algion** APIs with tools that expect the **Anthropic API** (like Claude Code, Roo Code, Cline, etc.).

```
    ╔═══════════════════════════════════════════════════════════════╗
    ║                                                               ║
    ║   ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗           ║
    ║  ██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝           ║
    ║  ██║     ██║     ███████║██║   ██║██║  ██║█████╗             ║
    ║  ██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝             ║
    ║  ╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗           ║
    ║   ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝           ║
    ║                                                               ║
    ║  ██████╗ ██████╗ ██╗██████╗  ██████╗ ███████╗                ║
    ║  ██╔══██╗██╔══██╗██║██╔══██╗██╔════╝ ██╔════╝                ║
    ║  ██████╔╝██████╔╝██║██║  ██║██║  ███╗█████╗                  ║
    ║  ██╔══██╗██╔══██╗██║██║  ██║██║   ██║██╔══╝                  ║
    ║  ██████╔╝██║  ██║██║██████╔╝╚██████╔╝███████╗                ║
    ║  ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝  ╚═════╝ ╚══════╝                ║
    ║                                                               ║
    ║           🌉 Anthropic API Gateway for A4F/Algion 🌉          ║
    ║                                                               ║
    ╚═══════════════════════════════════════════════════════════════╝
```

## Features

- ✅ **Full Anthropic API compatibility** - Works with Claude Code, Roo Code, Cline, and any Anthropic SDK
- ✅ **Multi-backend support** - Switch between A4F and Algion with a single command
- ✅ **Streaming support** - Real-time SSE streaming with proper event conversion
- ✅ **Tool calling** - Full support for function calling and tool use
- ✅ **Token counting** - Accurate token counting with Claude's tokenizer
- ✅ **Model name mapping** - Automatically maps Anthropic model names to backend formats
- ✅ **Simple CLI** - Start with `claude-bridge` command from anywhere

## Quick Start

```bash
# Clone the repository
git clone https://github.com/FasalZein/claude-bridge.git
cd claude-bridge

# Run setup
./setup.sh
```

The setup script will:
1. Install Bun (if needed)
2. Install dependencies
3. Create your configuration file (`.dev.vars`)
4. Prompt for your API keys
5. Generate a user API key
6. Install the `claude-bridge` command globally

## Usage

### Start the Bridge

```bash
# Start with default backend (from .dev.vars)
claude-bridge

# Start with A4F backend
claude-bridge a4f

# Start with Algion backend
claude-bridge algion

# Show help
claude-bridge --help

# Check if bridge is running
claude-bridge --status

# Test the bridge with a quick request
claude-bridge --test

# Show current backend
claude-bridge --backend
```

### Use with Claude Code

```bash
# Terminal 1: Start the bridge
claude-bridge

# Terminal 2: Run Claude Code with bridge
ANTHROPIC_BASE_URL="http://localhost:4242" \
ANTHROPIC_API_KEY="sk-claude-bridge-xxx" \
claude
```

**Pro tip:** Add an alias to your `~/.zshrc` for convenience:

```bash
# Add to ~/.zshrc
alias claude-local='ANTHROPIC_BASE_URL="http://localhost:4242" ANTHROPIC_API_KEY="sk-claude-bridge-xxx" claude'

# Then just run:
claude-local
```

### Use with Roo Code / Cline (VS Code)

Configure in your VS Code settings:

| Setting | Value |
|---------|-------|
| **API Provider** | `Anthropic` |
| **API Key** | Your user key from `.dev.vars` (e.g., `sk-claude-bridge-xxx`) |
| **Base URL** | `http://localhost:4242` |
| **Model** | `claude-sonnet-4-20250514` (or any Claude model) |

### Use with curl

```bash
# Simple request
curl -X POST http://localhost:4242/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-claude-bridge-xxx" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# With streaming
curl -X POST http://localhost:4242/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-claude-bridge-xxx" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "stream": true,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Configuration

Edit `.dev.vars` to configure your API keys and backend:

```bash
# Backend selection: "a4f" or "algion"
BACKEND=a4f

# A4F API key (get from A4F)
A4F_API_KEY=ddc-a4f-your-key-here

# Algion API key (get from Algion)
ALGION_API_KEY=algion_your-key-here

# User API keys - what you use in your clients (comma-separated for multiple)
VALID_API_KEYS=sk-claude-bridge-xxx
```

### Getting API Keys

- **A4F**: Sign up at [A4F](https://a4f.co) to get your API key
- **Algion**: Sign up at [Algion](https://algion.dev) to get your API key

### Generate a New User Key

```bash
# Generate a random key
echo "sk-claude-bridge-$(openssl rand -hex 16)"

# Add it to your .dev.vars VALID_API_KEYS
```

## Supported Backends

### A4F
- **Endpoint**: `https://api.a4f.co/v1`
- **Format**: OpenAI-compatible
- **Model prefix**: `provider-7/` (added automatically)
- **Auth header**: `Authorization: Bearer xxx`

### Algion
- **Endpoint**: `https://api.algion.dev/v1`
- **Format**: Anthropic-native
- **Model names**: Simplified (e.g., `claude-sonnet-4`)
- **Auth header**: `x-api-key: xxx`

## Model Mapping

The bridge automatically maps model names to the correct format for each backend:

| You send | A4F receives | Algion receives |
|----------|--------------|-----------------|
| `claude-sonnet-4-20250514` | `provider-7/claude-sonnet-4-20250514` | `claude-sonnet-4` |
| `claude-sonnet-4-5-20250929` | `provider-7/claude-sonnet-4-5-20250929` | `claude-sonnet-4.5` |
| `claude-opus-4-5-20251101` | `provider-7/claude-opus-4-5-20251101` | `claude-opus-4.5` |
| `claude-haiku-4-5-20251001` | `provider-7/claude-haiku-4-5-20251001` | `claude-haiku-4.5` |
| `claude-3-5-sonnet-20241022` | `provider-7/claude-3-5-sonnet-20241022` | `claude-3.5-sonnet` |

Model names with version dates (like those from Claude Code) are automatically converted.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/messages` | POST | Chat completions (Anthropic format) |
| `/v1/messages/count_tokens` | POST | Count tokens in a request |
| `/v1/models` | GET | List available models |
| `/health` | GET | Health check and status |

### Request Format

The bridge accepts standard Anthropic API format:

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1024,
  "system": "You are a helpful assistant.",
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false,
  "tools": []
}
```

### Response Format

Returns standard Anthropic API response format:

```json
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "content": [
    {"type": "text", "text": "Hello! How can I help you?"}
  ],
  "model": "claude-sonnet-4-20250514",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 15
  }
}
```

## Project Structure

```
claude-bridge/
├── bin/
│   ├── claude-bridge.template  # CLI template (committed)
│   └── claude-bridge           # Generated CLI (gitignored)
├── src/
│   ├── index.ts          # Main entry point, request routing
│   ├── types.ts          # TypeScript interfaces
│   ├── backends.ts       # A4F & Algion configurations
│   ├── converter.ts      # Anthropic ↔ OpenAI format conversion
│   ├── streaming.ts      # SSE streaming handler
│   └── tokenizer.ts      # Token counting with Claude tokenizer
├── setup.sh              # Interactive setup script
├── .dev.vars.example     # Configuration template
├── .dev.vars             # Your configuration (gitignored)
├── wrangler.toml         # Cloudflare Workers config
└── package.json          # Dependencies and scripts
```

## Manual Setup

If you prefer to set things up manually:

```bash
# 1. Install Bun (if not installed)
curl -fsSL https://bun.sh/install | bash

# 2. Install dependencies
bun install

# 3. Copy and edit config
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your API keys

# 4. Create the CLI from template
sed "s|__PROJECT_DIR__|$(pwd)|g" bin/claude-bridge.template > bin/claude-bridge
chmod +x bin/claude-bridge

# 5. Create symlink (optional, for global access)
mkdir -p ~/.local/bin
ln -sf "$(pwd)/bin/claude-bridge" ~/.local/bin/claude-bridge

# 6. Add to PATH (in ~/.zshrc or ~/.bashrc)
export PATH="$HOME/.local/bin:$PATH"

# 7. Start the bridge
claude-bridge
# or just:
bun run dev
```

## Development

```bash
# Run development server
bun run dev

# Type check
bun run typecheck

# Deploy to Cloudflare Workers
# Note: May hit CPU limits due to tokenizer - use local dev instead
bun run deploy
```

### Why Local Development?

The Claude tokenizer (`@lenml/tokenizer-claude`) is compute-intensive on first load. Cloudflare Workers have strict CPU limits that can cause timeouts. Running locally avoids this limitation and provides a better development experience.

## Troubleshooting

### "Bridge not running"
Make sure you started the bridge with `claude-bridge` or `bun run dev`.

### "Invalid API key"
Check that your client is using a key from `VALID_API_KEYS` in `.dev.vars`.

### "Model not supported"
The bridge maps model names automatically. If you're using an unusual model name, check the backend's supported models.

### "CPU limit exceeded" (Cloudflare)
Use local development instead: `bun run dev` or `claude-bridge`.

### Connection refused
Make sure port 4242 is available and the bridge is running.

## How It Works

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│ Claude Code │────▶│  Claude Bridge   │────▶│  A4F/Algion │
│ Roo Code    │◀────│  localhost:4242  │◀────│   Backend   │
│ Cline       │     └──────────────────┘     └─────────────┘
└─────────────┘           │
                          ▼
              ┌──────────────────────┐
              │ • Format conversion   │
              │ • Model name mapping  │
              │ • Auth translation    │
              │ • SSE streaming       │
              │ • Token counting      │
              └──────────────────────┘
```

1. **Client** sends Anthropic-format request to `localhost:4242`
2. **Bridge** validates API key and converts request to backend format
3. **Backend** (A4F/Algion) processes the request
4. **Bridge** converts response back to Anthropic format
5. **Client** receives standard Anthropic response

## License

ISC

---

Made with ❤️ for the Claude community