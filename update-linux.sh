#!/usr/bin/env bash
# Update an existing Ludex installation on Linux.
set -euo pipefail

REPO="spammail10q1-cloud/ludex"
SCRIPT_URL="https://raw.githubusercontent.com/$REPO/main/install-linux.sh"

echo "==> Updating Ludex from GitHub..."
curl -fsSL "$SCRIPT_URL" | bash
