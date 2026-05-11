#!/usr/bin/env bash
set -euo pipefail

PANEL_REPO="${PANEL_REPO:-https://github.com/BigDaddy3334/olcrtc-manager-panel.git}"
PANEL_REF="${PANEL_REF:-main}"
OLCRTC_REPO="${OLCRTC_REPO:-https://github.com/openlibrecommunity/olcrtc.git}"
OLCRTC_REF="${OLCRTC_REF:-master}"
GO_VERSION="${GO_VERSION:-1.25.0}"
PANEL_ADDR="${PANEL_ADDR:-127.0.0.1}"
PANEL_PORT="${PANEL_PORT:-8888}"
DNS_SERVER="${DNS_SERVER:-1.1.1.1:53}"
CLIENT_ID="${CLIENT_ID:-default}"
INSTALL_SRC_DIR="${INSTALL_SRC_DIR:-/opt/olcrtc-manager-src}"
CONFIG_DIR="${CONFIG_DIR:-/etc/olcrtc-manager}"
CONFIG_PATH="${CONFIG_PATH:-$CONFIG_DIR/config.json}"

log() {
	printf '[olcrtc-manager] %s\n' "$*"
}

die() {
	printf '[olcrtc-manager] ERROR: %s\n' "$*" >&2
	exit 1
}

need_root() {
	if [ "$(id -u)" -ne 0 ]; then
		die "run as root: curl -fsSL .../scripts/install.sh | sudo bash"
	fi
}

install_packages() {
	if command -v apt-get >/dev/null 2>&1; then
		export DEBIAN_FRONTEND=noninteractive
		apt-get update
		apt-get install -y --no-install-recommends ca-certificates curl git tar xz-utils iproute2 iptables
		return
	fi
	die "unsupported OS: this installer currently supports apt-based Linux distributions"
}

go_arch() {
	case "$(uname -m)" in
		x86_64|amd64) echo "amd64" ;;
		aarch64|arm64) echo "arm64" ;;
		*) die "unsupported CPU architecture: $(uname -m)" ;;
	esac
}

go_version_ok() {
	command -v go >/dev/null 2>&1 || return 1
	local current
	current="$(go env GOVERSION | sed 's/^go//')"
	[ "$(printf '%s\n%s\n' "$GO_VERSION" "$current" | sort -V | head -n1)" = "$GO_VERSION" ]
}

install_go() {
	if go_version_ok; then
		log "Go $(go env GOVERSION) found"
		return
	fi

	local arch archive url tmp
	arch="$(go_arch)"
	archive="go${GO_VERSION}.linux-${arch}.tar.gz"
	url="https://go.dev/dl/${archive}"
	tmp="/tmp/${archive}"

	log "installing Go ${GO_VERSION}"
	curl -fsSL "$url" -o "$tmp"
	rm -rf /usr/local/go
	tar -C /usr/local -xzf "$tmp"
	ln -sf /usr/local/go/bin/go /usr/local/bin/go
	ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
}

clone_repo() {
	local repo="$1" ref="$2" dest="$3"
	rm -rf "$dest"
	git clone --depth 1 --branch "$ref" "$repo" "$dest"
}

build_olcrtc() {
	local src="$1"
	log "building olcrtc"
	(cd "$src" && CGO_ENABLED=0 go build -o /tmp/olcrtc ./cmd/olcrtc)
	install -m 0755 /tmp/olcrtc /usr/local/bin/olcrtc
}

build_manager() {
	local src="$1"
	log "building olcrtc-manager"
	if [ ! -f "$src/cmd/olcrtc-manager/web/dist/index.html" ]; then
		die "frontend bundle is missing in repository; build assets before publishing installer"
	fi
	(cd "$src" && CGO_ENABLED=0 go build -o /tmp/olcrtc-manager ./cmd/olcrtc-manager)
	install -m 0755 /tmp/olcrtc-manager /usr/local/bin/olcrtc-manager
}

write_config_if_missing() {
	install -d -m 0755 "$CONFIG_DIR"
	install -d -m 0700 "$CONFIG_DIR/backups"

	if [ -f "$CONFIG_PATH" ]; then
		log "keeping existing config: $CONFIG_PATH"
		return
	fi

	log "generating initial room"
	local room key
	room="$(/usr/local/bin/olcrtc -mode gen -carrier wbstream -dns "$DNS_SERVER" -amount 1 | tail -n1 | tr -d '\r')"
	[ -n "$room" ] || die "failed to generate initial room"
	key="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"

	cat > "$CONFIG_PATH" <<EOF
{
  "version": 1,
  "name": "OlcRTC VPS",
  "port": $PANEL_PORT,
  "clients": [
    {
      "client-id": "$CLIENT_ID",
      "quota": {},
      "locations": [
        {
          "name": "$CLIENT_ID",
          "client-id": "$CLIENT_ID",
          "endpoint": {
            "room_id": "$room",
            "key": "$key"
          },
          "carrier": "wbstream",
          "transport": {
            "type": "datachannel"
          },
          "link": "direct",
          "data": "data",
          "dns": "$DNS_SERVER"
        }
      ]
    }
  ]
}
EOF
	chmod 0600 "$CONFIG_PATH"
	log "created config: $CONFIG_PATH"
}

install_service() {
	log "installing systemd service"
	cat > /etc/systemd/system/olcrtc-manager.service <<EOF
[Unit]
Description=OlcRTC Manager Panel
Documentation=https://github.com/BigDaddy3334/olcrtc-manager-panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=OLCRTC_PATH=/usr/local/bin/olcrtc
Environment=OLCRTC_MANAGER_ADDR=$PANEL_ADDR
ExecStart=/usr/local/bin/olcrtc-manager -config $CONFIG_PATH
ExecReload=/bin/kill -HUP \$MAINPID
Restart=on-failure
RestartSec=5s
KillSignal=SIGTERM
TimeoutStopSec=10s

[Install]
WantedBy=multi-user.target
EOF
	systemctl daemon-reload
	systemctl enable --now olcrtc-manager
}

sync_sources() {
	local src="$1"
	rm -rf "$INSTALL_SRC_DIR"
	mkdir -p "$INSTALL_SRC_DIR"
	tar --exclude='.git' --exclude='node_modules' -C "$src" -cf - . | tar -C "$INSTALL_SRC_DIR" -xf -
}

main() {
	need_root
	install_packages
	install_go

	local work panel_src olcrtc_src
	work="$(mktemp -d /tmp/olcrtc-manager-install.XXXXXX)"
	trap 'rm -rf "$work"' EXIT
	panel_src="$work/panel"
	olcrtc_src="$work/olcrtc"

	clone_repo "$OLCRTC_REPO" "$OLCRTC_REF" "$olcrtc_src"
	clone_repo "$PANEL_REPO" "$PANEL_REF" "$panel_src"
	build_olcrtc "$olcrtc_src"
	build_manager "$panel_src"
	write_config_if_missing
	install_service
	sync_sources "$panel_src"

	log "done"
	log "service: systemctl status olcrtc-manager"
	log "panel: http://${PANEL_ADDR}:${PANEL_PORT}/admin"
	if [ "$PANEL_ADDR" = "127.0.0.1" ]; then
		log "the panel listens locally; expose it with nginx or reinstall with PANEL_ADDR=0.0.0.0"
	fi
	log "fresh install has no default password; open /admin and create it on first run"
}

main "$@"
