include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-adguardhome
PKG_VERSION:=2.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Aoi

LUCI_TITLE:=LuCI support for AdGuard Home
LUCI_DEPENDS:=+luci-base +curl +wget-ssl +adguardhome
LUCI_DESCRIPTION:=AdGuard Home LuCI control panel (JS frontend, fw4/fw3)

PKG_CONFIG_DEPENDS:=

# 本包不静态提供 /etc/init.d/adguardhome、/etc/config/adguardhome 与
# /etc/adguardhome/adguardhome.yaml：前两者由官方 adguardhome 核心包静态安装
#（apk/opkg 对同名文件 ownership 严格检查会报冲突），后者是运行时配置（升级不应
# 覆盖用户数据）。三者均由 adguardhome-takeover 服务按文件状态接管（幂等）：
# postinst 与首次开机（uci-defaults）执行，且每次开机由该服务自动恢复
#（apk 的 @etc/init.d 规则只保护 symlink，普通文件在核心包升级时会被还原）。

define Package/$(PKG_NAME)/postinst
#!/bin/sh
	[ -n "$${IPKG_INSTROOT}" ] && exit 0
	# 状态感知接管（幂等）：init/config/yaml 按核心包文件状态接管/补齐；
	# 接管服务 enable 后每次开机自动恢复（核心包升级还原后无需重装本包）
	/etc/init.d/adguardhome-takeover enable >/dev/null 2>&1
	/bin/sh /etc/init.d/adguardhome-takeover start
	rm -f /tmp/luci-indexcache
	rm -f /tmp/luci-modulecache/* 2>/dev/null
exit 0
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
	[ -n "$${IPKG_INSTROOT}" ] && exit 0
	/etc/init.d/adguardhome-takeover stop >/dev/null 2>&1
	/etc/init.d/adguardhome-takeover disable >/dev/null 2>&1
	/etc/init.d/adguardhome stop >/dev/null 2>&1
	/etc/init.d/adguardhome disable >/dev/null 2>&1
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

$(eval $(call BuildPackage,$(PKG_NAME)))
