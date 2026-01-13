#!/usr/bin/env bash
# ============================================================================
# claude-bridge.sh - Claude Bridge Profile Manager (A4F Backup)
# ============================================================================
# Usage: source "/path/to/claude-bridge.sh"
#
# This is a BACKUP provider when anticc/CLIProxy is unavailable.
# anticc remains your primary - this just adds cb-* commands to switch.
#
# Commands:
#   cb-on              Switch to Claude Bridge/A4F
#   cb-off             Switch back to anticc/CLIProxy
#   cb-status          Check which provider is active
#   cb-start           Start Claude Bridge server
#   cb-stop            Stop Claude Bridge server
#   cb-logs            Show server logs
#   cb-help            Show help
#
# Routing (handled internally by Claude Bridge server):
#   Opus/Sonnet: A4F (first 10 RPM) -> CLI Proxy (8317) fallback
#   Haiku:       Always CLI Proxy (8317) -> gemini-3-flash-preview
#
# You don't need to specify models - Claude Code does that automatically.
# ============================================================================

# Detect script directory
if [[ -n "${BASH_SOURCE[0]}" ]]; then
    CB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
elif [[ -n "$ZSH_VERSION" ]]; then
    eval 'CB_DIR="$(cd "$(dirname "${(%):-%x}")" && pwd)"'
fi

# ============================================================================
# CONFIGURATION
# ============================================================================
CB_PORT="${CB_PORT:-4242}"
CB_API_KEY="${CB_API_KEY:-sk-046ad23dfe424a369795433c1c9e0cc4f35a7d318c4e1716}"
CB_BASE_URL="http://localhost:${CB_PORT}"

# Default models for Claude Code (same as what anticc sets)
_CB_OPUS_MODEL="claude-opus-4-5-20251101"
_CB_SONNET_MODEL="claude-sonnet-4-20250514"
_CB_HAIKU_MODEL="claude-haiku-4-5-20251001"

# State tracking
CB_ENABLED="${CB_ENABLED:-false}"

# ============================================================================
# COLORS
# ============================================================================
if [[ -t 1 ]] && command -v tput &>/dev/null && [[ $(tput colors 2>/dev/null) -ge 8 ]]; then
    _CB_GREEN=$(tput setaf 2); _CB_YELLOW=$(tput setaf 3)
    _CB_RED=$(tput setaf 1); _CB_BLUE=$(tput setaf 4)
    _CB_BOLD=$(tput bold); _CB_NC=$(tput sgr0)
else
    _CB_GREEN=''; _CB_YELLOW=''; _CB_RED=''; _CB_BLUE=''; _CB_BOLD=''; _CB_NC=''
fi

_cb_log() { echo -e "${_CB_GREEN}[claude-bridge]${_CB_NC} $*"; }
_cb_warn() { echo -e "${_CB_YELLOW}[claude-bridge]${_CB_NC} $*" >&2; }
_cb_error() { echo -e "${_CB_RED}[claude-bridge]${_CB_NC} $*" >&2; }

# ============================================================================
# UTILITIES
# ============================================================================
_cb_is_running() { lsof -i :${CB_PORT} &>/dev/null; }
_cb_get_pid() { lsof -ti :${CB_PORT} 2>/dev/null | head -1; }

# ============================================================================
# PROFILE COMMANDS
# ============================================================================

# Enable Claude Bridge (switch to A4F)
cb-on() {
    # Set Claude Bridge environment (overrides anticc)
    export ANTHROPIC_BASE_URL="$CB_BASE_URL"
    export ANTHROPIC_API_KEY="$CB_API_KEY"

    # Set default models for Claude Code
    export ANTHROPIC_DEFAULT_OPUS_MODEL="$_CB_OPUS_MODEL"
    export ANTHROPIC_DEFAULT_SONNET_MODEL="$_CB_SONNET_MODEL"
    export ANTHROPIC_DEFAULT_HAIKU_MODEL="$_CB_HAIKU_MODEL"

    export CB_ENABLED="true"

    _cb_log "Switched to Claude Bridge -> ${CB_BASE_URL}"
    _cb_log "Models: opus=$_CB_OPUS_MODEL, sonnet=$_CB_SONNET_MODEL"
    _cb_log "Routing: Opus/Sonnet 90% A4F / 10% CLI Proxy | Haiku -> gemini-3-flash-preview"

    # Check if server is running
    if ! _cb_is_running; then
        _cb_warn "Server not running. Start with: cb-start"
    fi
}

# Disable Claude Bridge (switch back to anticc)
cb-off() {
    export CB_ENABLED="false"

    # Switch back to anticc if available
    if type anticc-on &>/dev/null; then
        anticc-on
        _cb_log "Switched back to anticc/CLIProxy"
    else
        unset ANTHROPIC_BASE_URL
        unset ANTHROPIC_API_KEY
        _cb_log "Disabled (anticc not found, using default Claude)"
    fi
}

# Show status
cb-status() {
    echo "${_CB_BOLD}Current Provider:${_CB_NC}"

    local current_url="${ANTHROPIC_BASE_URL:-not set}"
    if [[ "$current_url" == *":8080"* ]]; then
        echo "  Active: ${_CB_BLUE}mitmproxy -> Claude Bridge${_CB_NC}"
        echo "  URL: $current_url"
        echo "  Web UI: http://localhost:8081"
    elif [[ "$current_url" == *":4242"* ]]; then
        echo "  Active: ${_CB_GREEN}Claude Bridge (A4F)${_CB_NC}"
        echo "  URL: $current_url"
        echo ""
        echo "  ${_CB_BOLD}Internal Routing:${_CB_NC}"
        echo "    Opus/Sonnet: A4F (10 RPM) -> CLI Proxy fallback"
        echo "    Haiku: CLI Proxy -> gemini-3-flash-preview"
    elif [[ "$current_url" == *":3456"* ]]; then
        echo "  Active: ${_CB_BLUE}anticc (CCR -> CLIProxy)${_CB_NC}"
        echo "  URL: $current_url"
    elif [[ "$current_url" == *":8317"* ]]; then
        echo "  Active: ${_CB_YELLOW}anticc direct (CLIProxy)${_CB_NC}"
        echo "  URL: $current_url"
    else
        echo "  Active: ${_CB_YELLOW}Default Claude${_CB_NC}"
    fi
    echo ""

    echo "${_CB_BOLD}Claude Bridge Server:${_CB_NC}"
    if _cb_is_running; then
        local pid=$(_cb_get_pid)
        echo "  Status: ${_CB_GREEN}running${_CB_NC} (PID: ${pid})"

        local health=$(curl -sf "http://localhost:${CB_PORT}/health" 2>/dev/null)
        if [[ -n "$health" ]]; then
            local rpm=$(echo "$health" | grep -o '"count":[0-9]*' | cut -d':' -f2)
            local limit=$(echo "$health" | grep -o '"limit":[0-9]*' | cut -d':' -f2)
            echo "  A4F Rate: ${rpm:-0}/${limit:-10} RPM"
        fi
    else
        echo "  Status: ${_CB_RED}stopped${_CB_NC} (run: cb-start)"
    fi

    # mitmproxy status
    if lsof -i :${CB_MITM_PORT} &>/dev/null; then
        echo ""
        echo "${_CB_BOLD}Mitmproxy:${_CB_NC}"
        echo "  Status: ${_CB_GREEN}running${_CB_NC} on port ${CB_MITM_PORT}"
        echo "  Web UI: http://localhost:8081"
    fi
}

# ============================================================================
# SERVER COMMANDS
# ============================================================================

# Run server in foreground (for development/debugging)
cb-run() {
    if _cb_is_running; then
        _cb_warn "Server already running (PID: $(_cb_get_pid)). Stop with: cb-stop"
        return 1
    fi

    if [[ ! -d "$CB_DIR/src/bun" ]]; then
        _cb_error "Claude Bridge source not found at $CB_DIR"
        return 1
    fi

    _cb_log "Starting server in foreground (Ctrl+C to stop)..."
    cd "$CB_DIR"
    bun run src/bun/index.ts
}

# Run server in background
cb-start() {
    if _cb_is_running; then
        _cb_log "Server already running (PID: $(_cb_get_pid))"
        return 0
    fi

    if [[ ! -d "$CB_DIR/src/bun" ]]; then
        _cb_error "Claude Bridge source not found at $CB_DIR"
        return 1
    fi

    _cb_log "Starting server in background..."
    mkdir -p "$HOME/.local/var/log"

    cd "$CB_DIR"
    nohup bun run src/bun/index.ts >> "$HOME/.local/var/log/claude-bridge.log" 2>&1 &

    sleep 2

    if _cb_is_running; then
        _cb_log "Server started (PID: $(_cb_get_pid)) on port ${CB_PORT}"
        _cb_log "Logs: cb-logs"
    else
        _cb_error "Failed to start. Check: cb-logs"
        return 1
    fi
}

cb-stop() {
    if ! _cb_is_running; then
        _cb_log "Server not running"
        return 0
    fi

    local pid=$(_cb_get_pid)
    _cb_log "Stopping server (PID: $pid)..."
    kill $pid 2>/dev/null
    sleep 1

    if _cb_is_running; then
        kill -9 $pid 2>/dev/null
    fi
    _cb_log "Server stopped"
}

cb-restart() {
    cb-stop
    sleep 1
    cb-start
}

cb-logs() {
    local lines="${1:-50}"
    tail -${lines} "$HOME/.local/var/log/claude-bridge.log" 2>/dev/null || _cb_warn "No logs found"
}

# ============================================================================
# MITMPROXY - Monitor Claude Code Requests
# ============================================================================

CB_MITM_PORT="${CB_MITM_PORT:-8080}"

# Start mitmproxy between Claude Code and Claude Bridge
# Flow: Claude Code -> mitmproxy (8080) -> Claude Bridge (4242) -> A4F/CLI Proxy
cb-mitm-start() {
    _cb_log "Starting mitmproxy on port ${CB_MITM_PORT}..."
    _cb_log "Flow: Claude Code -> :${CB_MITM_PORT} -> :${CB_PORT} -> A4F"

    # Run mitmweb (has nice web UI at http://localhost:8081)
    mitmweb --mode reverse:http://localhost:${CB_PORT} --listen-port ${CB_MITM_PORT} &

    sleep 2
    _cb_log "mitmproxy started"
    _cb_log "  Proxy: http://localhost:${CB_MITM_PORT}"
    _cb_log "  Web UI: http://localhost:8081"
    _cb_log ""
    _cb_log "To use: cb-mitm-on (sets ANTHROPIC_BASE_URL to mitmproxy)"
}

cb-mitm-stop() {
    pkill -f "mitmweb.*${CB_MITM_PORT}" 2>/dev/null
    pkill -f "mitmproxy.*${CB_MITM_PORT}" 2>/dev/null
    _cb_log "mitmproxy stopped"
}

# Switch to mitmproxy mode (monitor requests)
cb-mitm-on() {
    export ANTHROPIC_BASE_URL="http://localhost:${CB_MITM_PORT}"
    export ANTHROPIC_API_KEY="$CB_API_KEY"
    export ANTHROPIC_DEFAULT_OPUS_MODEL="$_CB_OPUS_MODEL"
    export ANTHROPIC_DEFAULT_SONNET_MODEL="$_CB_SONNET_MODEL"
    export ANTHROPIC_DEFAULT_HAIKU_MODEL="$_CB_HAIKU_MODEL"
    export CB_ENABLED="mitm"

    _cb_log "Switched to mitmproxy mode -> http://localhost:${CB_MITM_PORT}"
    _cb_log "Web UI: http://localhost:8081"

    if ! lsof -i :${CB_MITM_PORT} &>/dev/null; then
        _cb_warn "mitmproxy not running. Start with: cb-mitm-start"
    fi
}

# ============================================================================
# HELP
# ============================================================================

cb-help() {
    cat << 'EOF'
claude-bridge.sh - Claude Bridge (A4F Backup for anticc)

This is a BACKUP provider. anticc remains your primary.

How It Works:
  1. Claude Code sends requests to Claude Bridge (port 4242)
  2. Claude Bridge routes based on model:
     - Opus/Sonnet: A4F (first 10 RPM) -> CLI Proxy (8317) fallback
     - Haiku: Always CLI Proxy (8317) -> gemini-3-flash-preview

Commands:
  cb-on              Switch THIS terminal to Claude Bridge
  cb-off             Switch THIS terminal back to anticc
  cb-status          Show which provider is active

Server:
  cb-run             Run server in foreground (see logs live, Ctrl+C to stop)
  cb-start           Start server in background
  cb-stop            Stop server
  cb-restart         Restart server
  cb-logs [n]        Show last n lines of logs

Mitmproxy (monitor requests):
  cb-mitm-start      Start mitmproxy (Web UI at http://localhost:8081)
  cb-mitm-stop       Stop mitmproxy
  cb-mitm-on         Switch to mitmproxy mode (monitor all requests)

  Flow with mitmproxy:
    Claude Code -> mitmproxy (8080) -> Claude Bridge (4242) -> A4F/CLI Proxy

Multiple Ghostty Windows:
  Window 1: (default)  -> anticc/CLIProxy
  Window 2: cb-on      -> Claude Bridge (A4F with CLI Proxy fallback)
  Window 3: cb-mitm-on -> Claude Bridge via mitmproxy (see all requests)

When to Use Claude Bridge:
  - CLIProxy/anticc is down or slow
  - You want A4F as primary with rate-limit fallback
  - You want haiku tasks on gemini-3-flash-preview
EOF
}

