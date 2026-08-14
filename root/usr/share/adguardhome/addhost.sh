#!/bin/sh
# 将 DHCP 租约 + IPv6 邻居表中的主机映射写入 /etc/hosts 的 programadd 段。
# 参考现有 sync_dnsmasq_hosts6.sh：同名主机去重 + 原子写（临时文件 + mv）。

HOSTS=/etc/hosts
TMPHOST=/tmp/AGH_tmphost

checkmd5() {
	local nowmd5 lastmd5
	nowmd5="$(md5sum "$HOSTS" 2>/dev/null)"
	nowmd5="${nowmd5%% *}"
	lastmd5="$(uci -q get adguardhome.config.hostsmd5 2>/dev/null)"
	if [ "$nowmd5" != "$lastmd5" ]; then
		uci -q set adguardhome.config.hostsmd5="$nowmd5"
		uci -q commit adguardhome
		[ "$1" != "noreload" ] && /etc/init.d/adguardhome reload >/dev/null 2>&1
	fi
}

# 安全清理 programadd 段：只删除成对的 start~end 段，绝不触碰用户的其它内容
# （如自定义 hosts 条目）。孤立的 start/end 标记行仅移除标记本身；
# 段残缺（有 start 无 end）时保留 start 之后的用户内容，只丢弃残缺标记。
clean_programadd() {
	awk '
		/^#programaddstart$/ { if (!inblk) { inblk=1; n=0 } next }
		/^#programaddend$/ { if (inblk) { inblk=0; n=0 } next }
		{ if (inblk) buf[++n]=$0; else print }
		END { if (inblk) for (i=1;i<=n;i++) print buf[i] }
	' "$1" > "$1.clean" 2>/dev/null
	mv -f "$1.clean" "$1" 2>/dev/null
}

if [ "$1" = "del" ]; then
	clean_programadd "$HOSTS"
	checkmd5 "$2"
	exit 0
fi

# 邻居表(IPv6->MAC, 排除 fe80) + DHCP 租约(MAC->主机名)，同名主机去重（host / host-2 / host-3）
awk 'BEGIN { hseen[""] = 0 }
{
	if (FILENAME == "/tmp/dhcp.leases" && (NF >= 4)) {
		mac = tolower($2); host = $4
		if (host != "") {
			if (hseen[host] == 0) { hseen[host] = 1; base = host }
			else { hseen[host]++; base = host "-" hseen[host] }
			macname[mac] = base
		}
	}
}
END {
	cmd = "ip -6 neighbor show 2>/dev/null | grep -v fe80"
	while ((cmd | getline line) > 0) {
		split(line, f)
		mac = tolower(f[5])
		if (mac in macname && mac != "") print f[1] " " macname[mac]
	}
	close(cmd)
	print "#programaddend"
}' /tmp/dhcp.leases > "$TMPHOST" 2>/dev/null

# 原子写：副本上清理旧段 → 追加新段 → mv 替换（避免中途损坏 /etc/hosts）
cp -f "$HOSTS" "$HOSTS.new" 2>/dev/null
clean_programadd "$HOSTS.new"
{
	echo "#programaddstart"
	cat "$TMPHOST"
} >> "$HOSTS.new" 2>/dev/null
mv -f "$HOSTS.new" "$HOSTS" 2>/dev/null

rm -f "$TMPHOST"
checkmd5 "$2"
