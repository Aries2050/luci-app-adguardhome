#!/bin/sh
# 新包部署脚本：按 LuCI 目录映射安装到目标路径（不启用服务，不影响运行中的 dnsmasq）
# 前置：把打包好的 AGH_pkg/ 目录（含 htdocs/、root/）放到 /tmp/AGH_pkg
# 用法（路由器上执行）：sh /tmp/install_agh.sh
# 会覆盖 init.d、前端资源、rpcd 后端、辅助脚本；
# UCI 配置与 yaml 由 uci-defaults 状态感知接管（存在则补齐/保留，不存在则创建）；
# 不启动服务。
PKG=/tmp/AGH_pkg

echo "===== 前端资源 -> /www/luci-static ====="
mkdir -p /www/luci-static/resources/view/adguardhome
mkdir -p /www/luci-static/resources/adguardhome
cp -a "$PKG/htdocs/luci-static/resources/view/adguardhome/." /www/luci-static/resources/view/adguardhome/
cp -a "$PKG/htdocs/luci-static/resources/view/twin-bcrypt.min.js" /www/luci-static/resources/view/
cp -a "$PKG/htdocs/luci-static/resources/adguardhome/." /www/luci-static/resources/adguardhome/

echo "===== rpcd 后端 ====="
cp -a "$PKG/root/usr/libexec/rpcd/luci.adguardhome" /usr/libexec/rpcd/luci.adguardhome
chmod 755 /usr/libexec/rpcd/luci.adguardhome

echo "===== acl / menu ====="
cp -a "$PKG/root/usr/share/rpcd/acl.d/luci-app-adguardhome.json" /usr/share/rpcd/acl.d/
cp -a "$PKG/root/usr/share/luci/menu.d/luci-app-adguardhome.json" /usr/share/luci/menu.d/

echo "===== init.d (从包内模板覆盖官方小写脚本) ====="
cp -a "$PKG/root/usr/share/adguardhome/adguardhome.init" /etc/init.d/adguardhome
chmod 755 /etc/init.d/adguardhome

echo "===== 辅助脚本 (含 init/config/yaml 模板) ====="
mkdir -p /usr/share/adguardhome
cp -a "$PKG/root/usr/share/adguardhome/." /usr/share/adguardhome/
chmod 755 /usr/share/adguardhome/*.sh

echo "===== 接管服务 + uci-defaults (放置并执行状态感知接管) ====="
cp -a "$PKG/root/etc/init.d/adguardhome-takeover" /etc/init.d/adguardhome-takeover 2>/dev/null
chmod 755 /etc/init.d/adguardhome-takeover 2>/dev/null
/etc/init.d/adguardhome-takeover enable >/dev/null 2>&1
cp -a "$PKG/root/etc/uci-defaults/90_adguardhome" /etc/uci-defaults/90_adguardhome 2>/dev/null
/bin/sh /etc/uci-defaults/90_adguardhome

echo "===== 清理缓存 + 重载 rpcd ====="
rm -f /tmp/luci-indexcache /tmp/luci-modulecache/* 2>/dev/null
/etc/init.d/rpcd reload 2>/dev/null || /etc/init.d/rpcd restart 2>/dev/null

echo "===== 验证 ====="
ls -la /usr/libexec/rpcd/luci.adguardhome
ls -la /etc/init.d/adguardhome
ls -la /usr/share/adguardhome/
ls -la /www/luci-static/resources/view/adguardhome/
echo "install done"
