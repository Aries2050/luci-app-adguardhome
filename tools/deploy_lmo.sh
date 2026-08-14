#!/bin/sh
# 部署汉化 lmo 到路由器并验证翻译加载。
# 用法（本机依次执行）：
#   python tools/po2lmo.py po/zh_Hans/adguardhome.po tools/adguardhome.zh-cn.lmo
#   scp .deploy/adguardhome.zh-cn.lmo root@<路由器>:/tmp/
#   scp .deploy/deploy_lmo.sh root@<路由器>:/tmp/ && ssh root@<路由器> 'sh /tmp/deploy_lmo.sh'
# 作用：覆盖 /usr/lib/lua/luci/i18n/ 下的 adguardhome.zh-cn.lmo（含 overlay 上层），
# 并用 luci.i18n 验证关键文案翻译与 key 映射是否加载。
rm -f /usr/lib/lua/luci/i18n/adguardhome.zh-cn.lmo
rm -f /overlay/upper/usr/lib/lua/luci/i18n/adguardhome.zh-cn.lmo
cp /tmp/adguardhome.zh-cn.lmo /usr/lib/lua/luci/i18n/adguardhome.zh-cn.lmo
md5sum /usr/lib/lua/luci/i18n/adguardhome.zh-cn.lmo
lua - <<'EOF'
require 'luci.i18n'
luci.i18n.setlanguage('zh-cn')
print('SL      =>', luci.i18n.translate('Showing last '))
print('lines   =>', luci.i18n.translate('lines'))
print('Overview=>', luci.i18n.translate('Overview'))
local d = luci.i18n.dump()
for k, v in pairs(d) do
	if v == '显示最近 ' then
		print('dump key_id for 显示最近:', k)
	end
end
EOF
