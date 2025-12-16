#!/usr/bin/env bash

# Claude Bridge - Setup Script
# Run this after cloning the repository

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'
BOLD='\033[1m'

echo -e "${CYAN}"
cat << 'EOF'
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
    ║                     Setup Script                              ║
    ║                                                               ║
    ╚═══════════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BOLD}Step 1: Checking dependencies${NC}"
echo

# Check for Bun
if ! command -v bun &> /dev/null; then
    echo -e "${YELLOW}⚠ Bun is not installed${NC}"
    echo -e "${WHITE}Installing Bun...${NC}"
    curl -fsSL https://bun.sh/install | bash
    echo -e "${GREEN}✓ Bun installed${NC}"
    # Source the new bun installation
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
else
    echo -e "${GREEN}✓ Bun is installed${NC}"
fi

echo
echo -e "${BOLD}Step 2: Installing dependencies${NC}"
echo

cd "$SCRIPT_DIR"
bun install
echo -e "${GREEN}✓ Dependencies installed${NC}"

echo
echo -e "${BOLD}Step 3: Setting up configuration${NC}"
echo

# Create .dev.vars if it doesn't exist
if [ ! -f "$SCRIPT_DIR/.dev.vars" ]; then
    echo -e "${YELLOW}Creating .dev.vars configuration file...${NC}"
    
    # Prompt for A4F API key
    echo -e "${WHITE}Enter your A4F API key (or press Enter to skip):${NC}"
    read -r A4F_KEY
    
    # Generate a user API key
    USER_KEY="sk-claude-bridge-$(openssl rand -hex 16)"
    
    # Create the config file
    cat > "$SCRIPT_DIR/.dev.vars" << EOF
# A4F API Key
A4F_API_KEY=${A4F_KEY:-your-a4f-key-here}

# User API keys (comma-separated) - Use these in your clients
VALID_API_KEYS=$USER_KEY
EOF
    
    echo -e "${GREEN}✓ Configuration created${NC}"
    echo -e "${CYAN}Your user API key: ${WHITE}$USER_KEY${NC}"
else
    echo -e "${GREEN}✓ Configuration file already exists${NC}"
fi

echo
echo -e "${BOLD}Step 4: Setting up the claude-bridge command${NC}"
echo

# Create bin/claude-bridge from template with correct PROJECT_DIR
if [ -f "$SCRIPT_DIR/bin/claude-bridge.template" ]; then
    sed "s|__PROJECT_DIR__|$SCRIPT_DIR|g" "$SCRIPT_DIR/bin/claude-bridge.template" > "$SCRIPT_DIR/bin/claude-bridge"
    echo -e "${GREEN}✓ Created bin/claude-bridge from template${NC}"
else
    echo -e "${RED}✗ Template file not found${NC}"
    exit 1
fi

# Make script executable
chmod +x "$SCRIPT_DIR/bin/claude-bridge"

# Create symlink
mkdir -p ~/.local/bin
ln -sf "$SCRIPT_DIR/bin/claude-bridge" ~/.local/bin/claude-bridge

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    echo -e "${YELLOW}Adding ~/.local/bin to PATH...${NC}"
    
    # Detect shell and add to appropriate config
    if [ -f ~/.zshrc ]; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
        echo -e "${GREEN}✓ Added to ~/.zshrc${NC}"
    elif [ -f ~/.bashrc ]; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
        echo -e "${GREEN}✓ Added to ~/.bashrc${NC}"
    fi
fi

echo -e "${GREEN}✓ claude-bridge command installed${NC}"

echo
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo
echo -e "${GREEN}${BOLD}Setup complete!${NC}"
echo
echo -e "${WHITE}To start Claude Bridge:${NC}"
echo -e "  ${CYAN}claude-bridge${NC}          # Start the bridge"
echo
echo -e "${WHITE}To use with Claude Code:${NC}"
echo -e "  ${CYAN}ANTHROPIC_BASE_URL=\"http://localhost:4242\" ANTHROPIC_API_KEY=\"your-user-key\" claude${NC}"
echo
echo -e "${WHITE}Other commands:${NC}"
echo -e "  ${CYAN}claude-bridge --help${NC}   # Show help"
echo -e "  ${CYAN}claude-bridge --status${NC} # Check if running"
echo -e "  ${CYAN}claude-bridge --test${NC}   # Test the bridge"
echo
echo -e "${YELLOW}Note: Restart your terminal or run 'source ~/.zshrc' to use the claude-bridge command.${NC}"
echo