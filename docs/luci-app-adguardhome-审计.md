# luci-app-adguardhome 源码审计（2026-08-11）

> 审计对象：`small-package/luci-app-adguardhome`（kenzok8/small-package 的 adguardhome 目录，已重命名为 luci-app-adguardhome）
> 对照对象：`luci-app-adguardhome`（kiddin9 版，新版 JS + rpcd 架构）
> 结论依据：源码 + LuCI CBI 官方实现（`luci-compat/luasrc/cbi.lua`）

---

## 一、已确认的 Bug（有完整证据链）

### BUG-1 【严重】保存表单即删除 UCI `enabled`，服务被悄悄禁用

**根因（比"cfgvalue 覆盖"更深一层）：**

1. `base.lua` 中 `enabled` 使用自定义模板：
   ```lua
   o = s:option(Flag, "enabled", ...)
   o.template = "AdGuardHome/enable_switch"
   ```
2. 标准 Flag 模板 `cbi/fvalue.htm` 会输出隐藏字段：
   ```html
   <input type="hidden" name="cbi.cbe.<config>.<section>.<option>" ... />
   ```
   但 `enable_switch.htm` 只输出 `name="cbid.AdGuardHome.AdGuardHome.enabled"`，**没有 `cbi.cbe.*` 字段**。
3. LuCI `Flag.parse`（`luci-compat/luasrc/cbi.lua` L1602）：
   ```lua
   local fexists = self.map:formvalue("cbi.cbe.<config>.<section>.<option>")
   if fexists then
       local fvalue = self:formvalue(section) and self.enabled or self.disabled
       self:write(section, fvalue)   -- 正常写入
   else
       self:remove(section)          -- 每次保存都执行：删除 enabled！
   end
   ```

**后果：** 只要在"基础设置"页保存任意设置，`enabled` 就从 `/etc/config/AdGuardHome` 删除 → 触发 reload/重启后 `start_service` 读不到 `enabled`（默认 0）→ 服务停止，且开机不再自启。

**注意：** 误删机制不是"cfgvalue 与 formvalue 比较"（`AbstractValue.parse` 才有 `not (fvalue == cvalue)` 才写的逻辑，`Flag.parse` 不走该比较），而是**模板缺 `cbi.cbe` 隐藏字段导致 `Flag.parse` 落入 else 分支**。

**修复方向：**
- 方案 A（贴近上游）：`enable_switch.htm` 补输出 `name="cbi.cbe.<config>.<section>.<option>"` 的隐藏 input。
- 方案 B（隔离）：给 `enabled` 选项覆盖实例级 `parse` 为空函数，表单完全不碰 `enabled`，只由 toggle 接口维护。
- 方案 C（最彻底）：`enabled` 移出 CBI 表单，完全由 `/toggle` 接口 + 概览页开关管理。

### BUG-2 【中】`upprotect`（sysupgrade 保留文件）变量不展开，保留全部失效

- `tools.lua` 写入 UCI 的是字面量：
  ```lua
  o:value("$binpath", ...)
  o:value("$configpath", ...)
  ```
- `init.d/AdGuardHome` 生成 keep.d 时**没有做变量替换**：
  ```sh
  for item in $upprotect; do
      echo "$item" | sed 's/\\n/\n/g'   # 只处理换行
  done > /lib/upgrade/keep.d/luci-app-adguardhome
  ```
- 结果：keep.d 里是 `$binpath` 字面量，sysupgrade 按字面路径找不到文件 → 勾选的"升级保留"实际全部失效。

### BUG-3 【中】`40_luci-AdGuardHome`：uci batch 里嵌 `restart` 无效 + ucitrack 残留

- `uci batch` 只接受 `config/set/delete/add/commit` 指令，`/etc/init.d/AdGuardHome restart` 那一行会被静默忽略（错误被 `2>&1` 吞掉）→ 首次安装后不会按预期 restart。
- 脚本还 `add ucitrack AdGuardHome`，但当前 init.d 已用 `procd_add_reload_trigger`，**ucitrack 是废弃机制**，属历史遗留。

---

## 二、设计弱点（部分成立）

| 弱点 | 评估 |
|---|---|
| `m.on_commit` 的 `ucitracktest` 状态机 | 依赖 procd reload 外部时序；稳定态 `=1` 时完全靠 procd trigger，若 trigger 失效则保存永不重启服务；与 `procd_set_param file`、reload trigger 叠加存在双重触发风险 |
| `_do_redirect` 提前 return | 清理代码在 return **之前**，主体不跳过清理；但 `old_port=0` 边界下 `clear_iptable` 被短路 → 规则残留 |
| exchange 模式双配置源竞态 | `dns.port`（yaml）与 `dnsmasq.port`（uci）两边改，靠 procd file trigger 重启生效，存在窗口期不一致 |
| 10 秒 watchdog | `(sleep 10 && pgrep ... || _do_redirect 0) &`：慢启动（>10s）会误取消 redirect |
| `enabled` 显示靠进程探测 | `cfgvalue = service_running()`，页面显示与 UCI 值可能脱节（用户意图 vs 系统状态混在一起） |
| `old_redirect/old_port` 用 `add_list` 存标量 | 每次先 delete 再 add，**不会**累积重复；但用 list 存标量不规范，读取易错 |

---

## 三、不成立的论断（有反证）

| 论断 | 反证 |
|---|---|
| toggle 接口"不落 uci" | `controller/AdGuardHome.lua` 的 `toggle_service` 明确 `uci:set("AdGuardHome","AdGuardHome","enabled",enabled)` + `uci:commit("AdGuardHome")` |
| `add_list` 存 old_* 会"累积重复条目" | 代码先 `uci delete ...old_*` 删全部，再 `add_list` 一条，不会累积 |
| "保存误删 enabled 是 formvalue 与 cfgvalue 比较导致" | 见 BUG-1：真实机制是模板缺 `cbi.cbe` 字段 → `Flag.parse` 走 else 分支 `remove` |

---

## 四、kiddin9 版对照（新版 JS + rpcd 架构）

| 问题 | 说明 |
|---|---|
| 【高】`call_rest_api` 的 curl `-w "%{http_code"` 缺右花括号 | CODE 永远 ≠ 200 → get_status / get_statistics 永远失败 |
| 【高】`set_redirect` 每次 start 都 `uci add firewall redirect` | 无去重，reload=restart 多次后防火墙规则累积 |
| 【高】`set_passwd` 硬编码 `/etc/adguardhome/adguardhome.yaml` | 与 UCI `config_file` 可配置路径脱节；sed 无转义（用户名含 `&`/`/` 破坏命令） |
| 【中】`group_vars` 列表分组重复输出 | 每轮 grep 剩余全部匹配项再 echo，JSON 数组元素重复 |
| 【中】exchange 端口交换无冲突兜底 | AGH 与 dnsmasq 都=53 时冲突（small 版有 1745 兜底） |
| 【中】`stop_forward_dnsmasq` 整段删除 server 列表 | 用户原有上游配置被一并删除 |
| 【中】`read_config` 不读 UCI `config_file` | 改过路径后 get_config 读不到 |
| 【低】`web_password` 明文存 UCI | rpcd 需要它调 REST API，可读性风险 |

kiddin9 版整体更简洁（依赖 `+adguardhome` 二进制包、不做核心下载/备份/日志等），但 rpcd 的 REST 调用、防火墙规则、改密码三处有实质 bug。

---

## 五、结论与建议

1. **优先修 BUG-1**（保存即删 enabled）——影响所有用户的日常保存操作，建议采用方案 B/C 彻底隔离表单与 enabled。
2. 顺手修 BUG-2（upprotect 展开）、BUG-3（清理 ucitrack）。
3. `ucitracktest` 状态机可简化为：去掉 on_commit 手动 reload，统一依赖 `procd_add_reload_trigger`（OpenWrt 23.05+ 标准机制）。
4. 若长期使用，建议以 small 版为基础修复（功能完整），或直接换用 kiddin9 版但先修其 rpcd 三个 bug。

---

## 附：关键源码位置

- `luasrc/model/cbi/AdGuardHome/base.lua` — enabled Flag / on_commit 状态机
- `luasrc/view/AdGuardHome/enable_switch.htm` — 自定义开关模板（缺 cbi.cbe 字段）
- `luasrc/controller/AdGuardHome.lua` — toggle_service（写 uci enabled）
- `root/etc/init.d/AdGuardHome` — start/stop/reload/redirect / upprotect / watchdog
- `root/etc/uci-defaults/40_luci-AdGuardHome` — uci batch 嵌 restart
- LuCI 参考：`luci-compat/luasrc/cbi.lua` 的 `Flag.parse`（L1602）与 `AbstractValue.parse`（L1387）
