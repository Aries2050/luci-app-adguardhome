#!/bin/sh
# 实时监听 LAN 接口 IPv6 邻居表变化，触发 addhost.sh 即时更新 /etc/hosts。
# 参考现有 adh_hosts_watch（ip monitor neigh 内核邻居事件，设备接入/下线秒级生效）。
# 接口来源（可多个，空格分隔）：AGH_WATCH_IFACE 环境变量 > uci network.lan.ifname > br-lan 兜底
IFACES="${AGH_WATCH_IFACE:-$(uci -q get network.lan.ifname)}"
[ -n "$IFACES" ] || IFACES="br-lan"

# 展开为多个 dev 参数（ip monitor 支持同时监听多个接口）
DEVS=""
for i in $IFACES; do DEVS="$DEVS dev $i"; done

while true; do
	# 注意 DEVS 不带引号展开，词分割为多个 dev 参数
	ip monitor neigh $DEVS 2>/dev/null | while read -r line; do
		/usr/share/adguardhome/addhost.sh
	done
done
