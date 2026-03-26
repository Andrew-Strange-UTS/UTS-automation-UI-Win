#!/bin/bash
# scripts/install-service-linux.sh
# Installs the UTS Scheduler as a systemd service.
# Run: sudo bash scripts/install-service-linux.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_SCRIPT="$PROJECT_DIR/server/scheduler-service.js"
NODE_MODULES="$PROJECT_DIR/server/node_modules"
DATA_DIR="/var/lib/uts-automation"
SERVICE_NAME="uts-scheduler"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Find node binary
NODE_BIN=$(which node)
if [ -z "$NODE_BIN" ]; then
  echo "Error: node not found in PATH"
  exit 1
fi

echo "Installing UTS Automation Scheduler service..."
echo "  Node: $NODE_BIN"
echo "  Script: $SERVICE_SCRIPT"
echo "  Data: $DATA_DIR"

# Create data directory
mkdir -p "$DATA_DIR"
chmod 755 "$DATA_DIR"

# Create systemd unit file
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=UTS Automation Scheduler Service
After=network.target

[Service]
Type=simple
ExecStart=$NODE_BIN $SERVICE_SCRIPT
Environment=UTS_SCHEDULER_PORT=5050
Environment=NODE_PATH=$NODE_MODULES
Environment=UTS_SCHEDULER_DATA_DIR=$DATA_DIR
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

echo "Created $SERVICE_FILE"

# Reload and start
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

echo ""
echo "UTS Automation Scheduler service installed and started."
echo "  Status:  sudo systemctl status $SERVICE_NAME"
echo "  Logs:    sudo journalctl -u $SERVICE_NAME -f"
echo "  Stop:    sudo systemctl stop $SERVICE_NAME"
echo "  Remove:  sudo systemctl disable $SERVICE_NAME && sudo rm $SERVICE_FILE"
echo "  API:     http://localhost:5050/api/health"
