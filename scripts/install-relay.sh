#!/bin/sh
# Installs the ChatGPT-plan relay for Encore on this Mac: the sandboxed relay (127.0.0.1:8812),
# a Cloudflare tunnel to it, and two launchd agents. Both stop for good at END_AT.
# Before running: CODEX_HOME="$HOME/Library/Application Support/Encore/codex" codex login --device-auth
set -eu

END_AT="2026-11-24T12:00:00Z" # the day after Qloo announces winners
PORT=8812
ZONE="${ZONE:?set ZONE to a Cloudflare zone you control, e.g. ZONE=example.com}"
BASE="$HOME/Library/Application Support/Encore"
RELAY="$BASE/relay"
LOGS="$HOME/Library/Logs/Encore"
AGENTS="$HOME/Library/LaunchAgents"
# The sandbox allows exec of this exact file only, so it must be the real binary, not a symlink.
NODE_BIN="${NODE_BIN:-$HOME/.nvm/versions/node/v24.14.1/bin/node}"
[ -x "$NODE_BIN" ] && [ ! -L "$NODE_BIN" ] || { echo "NODE_BIN must be a real node binary: $NODE_BIN" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")/.." && pwd)"

umask 077
mkdir -p "$RELAY" "$LOGS"
chmod 700 "$BASE" "$RELAY"
cp "$HERE/relay/llm-relay.mjs" "$HERE/relay/relay.sb" "$RELAY/"

if [ ! -f "$RELAY/auth.json" ]; then
  mv "$BASE/codex/auth.json" "$RELAY/auth.json"
fi
chmod 600 "$RELAY/auth.json"
[ -f "$RELAY/relay-key" ] || openssl rand -hex 32 > "$RELAY/relay-key"
chmod 600 "$RELAY/relay-key"

# Tunnel
if [ ! -f "$BASE/relay-host" ]; then
  echo "en-$(openssl rand -hex 5).$ZONE" > "$BASE/relay-host"
fi
HOST="$(cat "$BASE/relay-host")"
if ! cloudflared tunnel info encore-llm >/dev/null 2>&1; then
  cloudflared tunnel create encore-llm >/dev/null
fi
TUNNEL_ID="$(cloudflared tunnel info encore-llm 2>/dev/null | sed -n 's/^ID: *//p' | head -1)"
[ -n "$TUNNEL_ID" ] || TUNNEL_ID="$(cloudflared tunnel list 2>/dev/null | awk '$2=="encore-llm"{print $1}')"
cloudflared tunnel route dns encore-llm "$HOST" 2>&1 | tail -1 || true
cat > "$BASE/tunnel.yml" <<EOF
protocol: http2
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json
ingress:
  - hostname: $HOST
    service: http://127.0.0.1:$PORT
  - service: http_status:404
EOF
END_EPOCH="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$END_AT" +%s)"
cat > "$BASE/run-tunnel.sh" <<EOF
#!/bin/sh
END=$END_EPOCH # $END_AT
NOW=\$(date -u +%s)
[ "\$NOW" -ge "\$END" ] && exit 0
/opt/homebrew/bin/cloudflared tunnel --config "\$HOME/Library/Application Support/Encore/tunnel.yml" run &
PID=\$!
( sleep \$((END - NOW)); kill "\$PID" 2>/dev/null ) &
wait "\$PID"
[ "\$(date -u +%s)" -ge "\$END" ] && exit 0
exit 1
EOF
chmod 700 "$BASE/run-tunnel.sh"

# launchd agents
cat > "$AGENTS/com.encore.llm-relay.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.encore.llm-relay</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/sandbox-exec</string>
    <string>-f</string><string>$RELAY/relay.sb</string>
    <string>-D</string><string>NODE_BIN=$NODE_BIN</string>
    <string>-D</string><string>RELAY_DIR=$RELAY</string>
    <string>-D</string><string>RELAY_SCRIPT=$RELAY/llm-relay.mjs</string>
    <string>-D</string><string>RELAY_KEY=$RELAY/relay-key</string>
    <string>-D</string><string>RELAY_AUTH=$RELAY/auth.json</string>
    <string>-D</string><string>RELAY_AUTH_TMP=$RELAY/auth.json.tmp</string>
    <string>-D</string><string>PORT_RULE=localhost:$PORT</string>
    <string>$NODE_BIN</string>
    <string>$RELAY/llm-relay.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>RELAY_KEY_FILE</key><string>$RELAY/relay-key</string>
    <key>CODEX_AUTH</key><string>$RELAY/auth.json</string>
    <key>END_AT</key><string>$END_AT</string>
    <key>PORT</key><string>$PORT</string>
  </dict>
  <key>WorkingDirectory</key><string>/</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/llm-relay.log</string>
  <key>StandardErrorPath</key><string>$LOGS/llm-relay.log</string>
</dict>
</plist>
EOF
cat > "$AGENTS/com.encore.llm-tunnel.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.encore.llm-tunnel</string>
  <key>ProgramArguments</key><array><string>$BASE/run-tunnel.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/llm-tunnel.log</string>
  <key>StandardErrorPath</key><string>$LOGS/llm-tunnel.log</string>
</dict>
</plist>
EOF
plutil -lint "$AGENTS/com.encore.llm-relay.plist" "$AGENTS/com.encore.llm-tunnel.plist" >/dev/null

for label in com.encore.llm-relay com.encore.llm-tunnel; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"
done
echo "relay host: $HOST (until $END_AT)"
