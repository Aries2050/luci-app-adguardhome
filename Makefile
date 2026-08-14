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

define Package/$(PKG_NAME)/conffiles
/etc/config/adguardhome
endef

define Package/$(PKG_NAME)/postinst
#!/bin/sh
	[ -n "$${IPKG_INSTROOT}" ] && exit 0
	# 接管官方 adguardhome 包的 init.d：包内 init 模板位于 /usr/share/adguardhome/（
	# 避免与 adguardhome 二进制核心包在 /etc/init.d/adguardhome 的文件冲突），
	# 安装时复制为 /etc/init.d/adguardhome 以获得重定向/劫持能力
	cp -f /usr/share/adguardhome/adguardhome.init /etc/init.d/adguardhome
	chmod 755 /etc/init.d/adguardhome
	/etc/init.d/adguardhome enable >/dev/null 2>&1
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
