#!/bin/sh
# 保留最后 $1 行到 $2 文件（日志切割）
tail -n "$1" "$2" > /tmp/AGH_tail.tmp 2>/dev/null && cat /tmp/AGH_tail.tmp > "$2" 2>/dev/null
rm -f /tmp/AGH_tail.tmp
