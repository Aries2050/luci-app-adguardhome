#!/bin/sh

PATH="/usr/sbin:/usr/bin:/sbin:/bin"

LOCK=/var/run/adguardhome_update

uci_get() { uci -q get "adguardhome.config.$1" 2>/dev/null; }

BIN="$(uci_get bin_path)"
[ -n "$BIN" ] || BIN=/usr/bin/AdGuardHome

cleanup() {
	rm -f "$LOCK"
	exit "${1:-0}"
}

get_arch() {
	local a
	a="$(opkg info kernel 2>/dev/null | grep Architecture | awk '{print $2}')"
	[ -n "$a" ] || a="$(uname -m)"
	echo "$a"
}

detect_arch() {
	local a
	a="$(get_arch)"
	case "$a" in
		i386|i686|x86)           ARCH=386 ;;
		x86_64|x86-64|amd64)     ARCH=amd64 ;;
		mipsel|mipsle)           ARCH=mipsle ;;
		mips64el|mips64le)       ARCH=mips64le ;;
		mips)                    ARCH=mips ;;
		mips64)                  ARCH=mips64 ;;
		arm*|armv7*|armv8*)       ARCH=arm ;;
		aarch64*|arm64*)         ARCH=arm64 ;;
		*)
			echo "Unsupported architecture: $a"
			cleanup 1
			;;
	esac
}

get_latest() {
	local channel api
	channel="$(uci_get release_channel)"
	[ -n "$channel" ] || channel=stable
	if [ "$channel" = "beta" ]; then
		api="https://api.github.com/repos/AdguardTeam/AdGuardHome/releases"
	else
		api="https://api.github.com/repos/AdguardTeam/AdGuardHome/releases/latest"
	fi
	if command -v curl >/dev/null 2>&1; then
		curl -sL "$api" | grep -oE '"tag_name": *"v[^"]+"' | head -1 | sed 's/.*"v\(.*\)".*/v\1/'
	else
		wget -qO- "$api" 2>/dev/null | grep -oE '"tag_name": *"v[^"]+"' | head -1 | sed 's/.*"v\(.*\)".*/v\1/'
	fi
}

download() {
	local url="$1" out="$2"
	if command -v curl >/dev/null 2>&1; then
		curl -sLk --connect-timeout 15 -o "$out" "$url"
	else
		wget --no-check-certificate -T 20 -O "$out" "$url" 2>/dev/null
	fi
}

[ -f "$LOCK" ] && { echo "Another update is already running."; exit 2; }
touch "$LOCK"
trap cleanup EXIT

echo "Detecting architecture..."
detect_arch
echo "Architecture: $ARCH"

echo "Checking latest version..."
VER="$(get_latest)"
if [ -z "$VER" ]; then
	echo "Failed to fetch latest version."
	cleanup 1
fi
echo "Latest version: $VER"

tmp=/tmp/AGH_update
mkdir -p "$tmp"
rm -rf "$tmp"/*

# 下载源：UCI download_links 优先，否则按更新通道生成默认多源（参考 small-package 插件）
local_links="$(uci_get download_links)"
channel="$(uci_get release_channel)"
[ -n "$channel" ] || channel=stable
if [ -n "$local_links" ]; then
	echo "$local_links" > /tmp/run/AGH_links.txt
elif [ "$channel" = "beta" ]; then
	{
		echo "https://static.adguard.com/adguardhome/beta/AdGuardHome_linux_${ARCH}.tar.gz"
		echo "https://github.com/AdguardTeam/AdGuardHome/releases/download/${VER}/AdGuardHome_linux_${ARCH}.tar.gz"
	} > /tmp/run/AGH_links.txt
else
	{
		echo "https://static.adguard.com/adguardhome/release/AdGuardHome_linux_${ARCH}.tar.gz"
		echo "https://github.com/AdguardTeam/AdGuardHome/releases/download/${VER}/AdGuardHome_linux_${ARCH}.tar.gz"
	} > /tmp/run/AGH_links.txt
fi

ok=0
while IFS= read -r link; do
	[ -n "$link" ] || continue
	eval link="$link"
	echo "Downloading: $link"
	download "$link" "$tmp/pkg.tar.gz"
	if [ -s "$tmp/pkg.tar.gz" ]; then
		ok=1
		break
	fi
	rm -f "$tmp/pkg.tar.gz"
done < /tmp/run/AGH_links.txt
rm -f /tmp/run/AGH_links.txt

[ "$ok" = "1" ] || { echo "All download sources failed."; cleanup 1; }

tar -zxf "$tmp/pkg.tar.gz" -C "$tmp" 2>/dev/null
newbin=""
if [ -f "$tmp/AdGuardHome/AdGuardHome" ]; then
	newbin="$tmp/AdGuardHome/AdGuardHome"
elif [ -f "$tmp/AdGuardHome" ]; then
	newbin="$tmp/AdGuardHome"
else
	newbin="$(find "$tmp" -name AdGuardHome -type f 2>/dev/null | head -1)"
fi
[ -n "$newbin" ] || { echo "Extract failed."; cleanup 1; }

chmod 755 "$newbin"
echo "Stopping service..."
/etc/init.d/adguardhome stop >/dev/null 2>&1

mkdir -p "$(dirname "$BIN")"
cp -f "$newbin" "$BIN"
chmod 755 "$BIN"
rm -rf "$tmp"

echo "Starting service..."
/etc/init.d/adguardhome start >/dev/null 2>&1

echo "Update complete: $VER"
cleanup 0
