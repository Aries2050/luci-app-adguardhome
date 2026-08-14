#!/bin/sh
# 备份路由器现有 AGH 相关配置（只读操作），打包到 /tmp/AGH_backup.tar.gz
# 用法（路由器上执行）：sh /tmp/backup_agh.sh
# 备份内容：yaml 配置、data 目录、UCI 配置（adguardhome/AdGuardHome）、
# init 脚本、以及环境快照（AGH 版本 / dnsmasq 配置 / 53·1053·3000 端口监听）。
DEST=/tmp/AGH_backup
rm -rf "$DEST"
mkdir -p "$DEST"

cp -a /etc/AdGuardHome.yaml "$DEST/AdGuardHome.yaml" 2>/dev/null
cp -a /etc/AdGuardHome "$DEST/AdGuardHome_dir" 2>/dev/null
cp -a /etc/config/adguardhome "$DEST/config_adguardhome" 2>/dev/null
cp -a /etc/config/AdGuardHome "$DEST/config_AdGuardHome" 2>/dev/null
cp -a /etc/init.d/adguardhome "$DEST/init_adguardhome" 2>/dev/null
cp -a /etc/init.d/AdGuardHome "$DEST/init_AdGuardHome" 2>/dev/null

{
	echo "=== date ==="
	date
	echo "=== AGH version ==="
	/usr/bin/AdGuardHome --version 2>/dev/null
	echo "=== uci adguardhome ==="
	uci show adguardhome 2>/dev/null
	echo "=== uci AdGuardHome ==="
	uci show AdGuardHome 2>/dev/null
	echo "=== dhcp dnsmasq 相关 ==="
	uci show dhcp 2>/dev/null | grep -E "dnsmasq|\.port=|server|noresolv|resolvfile"
	echo "=== 端口监听 ==="
	ss -lun 2>/dev/null | grep -E ":53 |:1053 |:3000 "
	ss -ltn 2>/dev/null | grep -E ":53 |:1053 |:3000 "
} > "$DEST/AGH_env.txt" 2>&1

tar -czf /tmp/AGH_backup.tar.gz -C "$DEST" .
rm -rf "$DEST"
echo "backup done:"
ls -la /tmp/AGH_backup.tar.gz
