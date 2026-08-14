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

# 本包不静态提供 /etc/config/adguardhome 与 /etc/adguardhome/adguardhome.yaml：
# 前者由官方 adguardhome 核心包静态安装（apk/opkg 对同名文件 ownership 严格检查会报冲突），
# 后者是运行时配置（升级不应覆盖用户数据）。二者（连同 /etc/init.d/adguardhome 接管）
# 均由 postinst 调用的 90_adguardhome（uci-defaults）按文件状态接管。

define Package/$(PKG_NAME)/postinst
#!/bin/sh
	[ -n "$${IPKG_INSTROOT}" ] && exit 0
	# 状态感知接管（幂等）：init/config/yaml 按核心包文件状态接管/补齐
	# （本包不静态打包 /etc/init.d/adguardhome 与 /etc/config/adguardhome，
	#  避免与官方 adguardhome 核心包在 apk/opkg 下的文件 ownership 冲突）
	/bin/sh /etc/uci-defaults/90_adguardhome
	rm -f /tmp/luci-indexcache
	rm -f /tmp/luci-modulecache/* 2>/dev/null
exit 0
endef

define Package/$(PKG_NAME)/prerm
#!/bin/sh
	[ -n "$${IPKG_INSTROOT}" ] && exit 0
	/etc/init.d/adguardhome stop >/dev/null 2>&1
	/etc/init.d/adguardhome disable >/dev/null 2>&1
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

$(eval $(call BuildPackage,$(PKG_NAME)))
