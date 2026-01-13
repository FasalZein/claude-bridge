#!/bin/bash

# =============================================================================
# Claude Bridge v2.0 - ZSHRC Configuration
# Add these lines to your ~/.zshrc or source this file
# =============================================================================

# Claude Bridge Configuration
export CLAUDE_BRIDGE_DIR="$HOME/Dev/Code\ Forge/claude-bridge"
export CLAUDE_BRIDGE_PORT=4242

# Function to start Claude Bridge
claude-bridge-start() {
    local dir="${CLAUDE_BRIDGE_DIR//\\ / }"
    if [ ! -d "$dir" ]; then
        echo "❌ Claude Bridge directory not found: $dir"
        return 1
    fi

    cd "$dir"

    # Check if .env exists
    if [ ! -f ".env" ]; then
        echo "❌ .env file not found. Copy .env.example to .env and configure it."
        return 1
    fi

    # Load environment variables
    export $(cat .env | grep -v '^#' | xargs)

    echo "🚀 Starting Claude Bridge on port ${SERVER_PORT:-4242}..."
    bun run src/bun-proxy.ts
}

# Function to start Claude Bridge in background
claude-bridge-daemon() {
    local dir="${CLAUDE_BRIDGE_DIR//\\ / }"
    cd "$dir"

    if [ ! -f ".env" ]; then
        echo "❌ .env file not found"
        return 1
    fi

    export $(cat .env | grep -v '^#' | xargs)

    nohup bun run src/bun-proxy.ts > /tmp/claude-bridge.log 2>&1 &
    echo "✅ Claude Bridge started in background (PID: $!)"
    echo "📝 Logs: tail -f /tmp/claude-bridge.log"
}

# Function to stop Claude Bridge
claude-bridge-stop() {
    local pids=$(pgrep -f "bun-proxy.ts")
    if [ -n "$pids" ]; then
        echo "$pids" | xargs kill
        echo "✅ Claude Bridge stopped"
    else
        echo "ℹ️  Claude Bridge is not running"
    fi
}

# Function to check Claude Bridge status
claude-bridge-status() {
    local port="${SERVER_PORT:-4242}"
    if curl -s "http://localhost:$port/health" > /dev/null 2>&1; then
        local health=$(curl -s "http://localhost:$port/health")
        echo "✅ Claude Bridge is running"
        echo "$health" | python3 -m json.tool 2>/dev/null || echo "$health"
    else
        echo "❌ Claude Bridge is not running"
    fi
}

# =============================================================================
# Claude Code Configuration
# =============================================================================

# Set ANTHROPIC_BASE_URL to point to Claude Bridge
claude-code-proxy() {
    local port="${SERVER_PORT:-4242}"
    export ANTHROPIC_BASE_URL="http://localhost:$port"
    export ANTHROPIC_API_KEY="${CLAUDE_BRIDGE_API_KEY:-your-api-key-here}"
    echo "✅ Claude Code configured to use Claude Bridge"
    echo "   ANTHROPIC_BASE_URL=$ANTHROPIC_BASE_URL"
}

# Alias to start claude with proxy configured
alias claude-proxy='claude-code-proxy && claude'

# =============================================================================
# Quick aliases
# =============================================================================

alias cb-start='claude-bridge-start'
alias cb-stop='claude-bridge-stop'
alias cb-status='claude-bridge-status'
alias cb-daemon='claude-bridge-daemon'
alias cb-logs='tail -f /tmp/claude-bridge.log'
