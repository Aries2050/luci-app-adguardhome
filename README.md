# luci-app-adguardhome

> **AI 声明**：本项目为**纯 AI 生成作品**——全部代码由 AI（GitHub Copilot）生成，人工仅负责需求描述、验证与调试，不含人工撰写的源代码。
> **开源许可**：本项目以 **Apache License 2.0** 发布，完整许可证文本见仓库根目录 [LICENSE](LICENSE) 文件。

AdGuard Home LuCI 控制面板（新版 JS 前端），为 ImmortalWrt / OpenWrt 提供完整的 AdGuard Home 管理界面与 DNS 重定向 / 劫持能力。

> 全新重写，参考 OpenWrt 官方 `luci-app-adguardhome`、`kiddin9/luci-app-adguardhome` 与 `kenzok8/small-package`，规避各版已知 bug。
> 支持 ImmortalWrt 25.12（fw4 / nftables）与 OpenWrt 22.03 及以下（fw3 / iptables）。

**相对上游新增了：**

- 全新 5 页面 JS 前端（概览 / 配置 / 运维 / 手动配置 / 日志）
- **本地域同步**（`sync_local_domain`）：AGH 本地域名与 dnsmasq 自动保持一致，IPv6 设备名反查正确
- **私人 PTR 上游自动补充**（`sync_local_ptr`）：私有地址反查自动指向 dnsmasq，用户自定义上游保留
- **实时主机同步**：`hosts_watch.sh` 监听邻居表，设备接入/离开秒级更新 `/etc/hosts`
- **每任务独立频率**的计划任务（自动更新 / 切割查询日志 / 切割运行日志 / 主机同步）
- **专属运行日志文件** + 日志页展示 + 运行日志切割
- **rpcd 后端完整重写**：路径跟随 UCI，修复上游列表分组等 bug
- **programadd 段自愈**：只清理自身段，绝不触碰用户自定义 hosts
- **官方组件界面**：区域/接口选择器带图标徽章（与 LuCI 原生界面一致）

## 页面

| 页面 | 功能 |
|------|------|
| **概览** | 服务状态、重定向模式、DNS 劫持状态、核心版本、一键启停、Web 控制台入口 |
| **配置** | 启用、重定向模式、DNS 劫持、本地域同步、私人 PTR 上游、重定向区域、更新通道、路径、运行用户/组、GOGC/GOMAXPROCS/GOMEMLIMIT、专属运行日志 |
| **运维** | 改密（bcrypt）、sysupgrade 保留文件、关机备份、计划任务（每任务独立频率）、下载源、数据库/日志下载 |
| **手动配置** | YAML 编辑器（CodeMirror）+ 保存前 `--check-config` 校验；路径跟随 UCI（config_file / bin_path） |
| **日志** | 专属运行日志文件（tail -n 500）或 logread 过滤 AdGuardHome |

## 重定向 / 劫持

| 模式 | 说明 |
|------|------|
| `none` | 不重定向 |
| `dnsmasq-upstream` | dnsmasq 转发到 AdGuard Home |
| `redirect` | 53 端口劫持到 AdGuard Home（fw4 `redirect` / fw3 iptables REDIRECT） |
| `exchange` | AdGuard Home 直接监听 53，dnsmasq 让位到 1053 |
| `dns_hijack`（独立开关） | 全量劫持 LAN 出口 53 流量（含外部 DNS），可搭配任意模式 |

- `redirect_zone`：指定应用重定向/劫持的防火墙区域（每行一个，默认全部内部区域；描述动态列出实际区域）
- `dns_hijack` 启用前会扫描防火墙规则，检测到其它插件已有劫持会给出提示

## 本地解析增强

- **`sync_local_domain`**（默认开）：启动时把 AGH `local_domain_name` 与 dnsmasq `domain` 同步，保证 IPv6 设备名 PTR 反查正确
- **`sync_local_ptr`**（默认开）：启动时确保 AGH `use_private_ptr_resolvers: true` 且 `local_ptr_upstreams` 指向 dnsmasq 实际端口（exchange/redirect=1053，dnsmasq-upstream=53），使私有地址（如 192.168.x.x）的 PTR 反查能解析出 LAN 设备名；用户自定义的其它 PTR 上游会保留

## 实时主机同步（autohost）

- `addhost.sh`：把 DHCP 租约 + IPv6 邻居表设备映射写入 `/etc/hosts` 的 `#programaddstart` 段，同名主机去重（host / host-2 / …）+ 原子写（临时文件 + mv）
- `hosts_watch.sh`：`ip monitor neigh` 实时监听 LAN 接口，设备接入/离开秒级更新（接口自动检测：`AGH_WATCH_IFACE` → `network.lan.ifname` → `br-lan`）
- **段自愈**：仅清理 programadd 段（成对段删除、残缺段/孤立标记保留用户内容），绝不触碰用户自定义 hosts 条目

## 日志

- `logfile`：AGH 专属运行日志文件（`-l` 参数），日志页读取展示，同时供"切割运行日志"计划任务使用；留空则写入系统日志（syslog）
- 运行日志切割：`cutruntimelog_freq` 计划任务按频率切割

## 计划任务

维护 `/etc/crontabs/root` 中的任务，每任务独立频率（留空用内置默认），`crontab_entry` 支持更新已有条目：

- `autoupdate_freq`：自动更新核心
- `cutquerylog_freq`：切割查询日志
- `cutruntimelog_freq`：切割运行日志
- `autohost_freq`：主机映射同步（另有实时 watcher）

## 服务端架构

```
root/usr/share/adguardhome/adguardhome.init  procd 服务控制模板（重定向/劫持、计划任务、日志、本地域/PTR 同步、hosts watcher；接管脚本按状态复制为 /etc/init.d/adguardhome）
root/usr/share/adguardhome/adguardhome.yaml  默认配置模板（接管脚本按状态复制为 /etc/adguardhome/adguardhome.yaml）
root/usr/share/adguardhome/takeover.sh  状态感知接管脚本（init / config / yaml，幂等；可手动执行）
root/etc/init.d/adguardhome-takeover  接管触发器（START=15，每次开机调用 takeover.sh，自动恢复）
root/etc/uci-defaults/90_adguardhome   首次安装初始化（清 ucitrack、建目录、启用并执行一次接管）
root/usr/libexec/rpcd/luci.adguardhome rpcd 后端（shell + jshn）
root/usr/share/adguardhome/*.sh  addhost / hosts_watch / tailto / update_core
root/usr/share/luci/menu.d/            菜单
root/usr/share/rpcd/acl.d/             rpcd 权限
htdocs/luci-static/resources/view/adguardhome/  overview / config / tools / manual / logs
```

init.d 额外命令：`/etc/init.d/adguardhome isrunning`（状态）、`apply_redirect`（应用重定向/劫持）、`clear_redirect`（清除）。

## 与官方核心包协同（apk/opkg 文件冲突处理）

官方 `adguardhome` 核心包静态提供 `/etc/init.d/adguardhome` 与 `/etc/config/adguardhome`。本包**不重复打包**这两个路径（apk/opkg 对同名文件的 ownership 严格检查会报冲突），改为由 **`adguardhome-takeover` 服务**（触发器）调用 **`/usr/share/adguardhome/takeover.sh`**（逻辑）在运行时**状态感知接管**（幂等、可重复执行）：

- `/etc/init.d/adguardhome`：不存在或为官方裸 init 时，接管为增强版；已是本包增强版则保留现状（含用户手工改动）
- `/etc/config/adguardhome`：不存在则自举默认配置，存在则仅补齐本包扩展 option，绝不覆盖已有值
- `/etc/adguardhome/adguardhome.yaml`：不存在则使用默认模板，不覆盖已生成的配置

`adguardhome-takeover`（START=15）早于 AGH 服务启动，**每次开机调用 `takeover.sh` 自动执行接管**：核心包升级会把 `/etc/init.d/adguardhome` 还原为官方裸 init（apk 的 `@etc/init.d` 默认规则只保护被修改过的 symlink，普通文件不保护；opkg 无保护机制），下次开机自动恢复增强 init，**无需重装本包**。`postinst`（安装/升级本包时）与首次开机（uci-defaults）同样执行接管。

## UCI 配置要点

`/etc/config/adguardhome`：

```
config adguardhome 'config'
	option enabled '0'            # 启用
	option redirect 'none'        # none / dnsmasq-upstream / redirect / exchange
	option dns_hijack '0'         # DNS 劫持独立开关
	option sync_local_domain '1'  # 同步本地域到 dnsmasq
	option sync_local_ptr '1'     # 私人 PTR 上游指向 dnsmasq
	option config_file '/etc/adguardhome/adguardhome.yaml'
	option work_dir '/var/lib/adguardhome'
	option bin_path '/usr/bin/AdGuardHome'
	option http_port '3000'
	option logfile ''             # 专属运行日志（空 = syslog）
	option user 'adguardhome'     # 运行用户（需低端口 capability）
	option group 'adguardhome'
	option verbose '0'
	option gc '0'                 # 0 = Go 官方默认 100
	option maxprocs '0'           # 0 = 自动匹配 CPU
	option memlimit '0'           # 0 = 不限制；建议 25%-50% 设备内存
	option release_channel 'stable'
	option web_username 'admin'
	option web_password ''
	option backup_path '/etc/adguardhome'
	option keep_files ''          # sysupgrade 保留文件
	option backup_files ''        # 关机备份文件
	option crontab ''
	option autoupdate_freq ''     # 每任务频率，留空用默认
	option cutquerylog_freq ''
	option cutruntimelog_freq ''
	option autohost_freq ''
	option watch_iface ''       # 实时监听接口（多个用空格分隔；空 = 自动检测 network.lan.ifname / br-lan）
	option download_links ''      # 核心下载源
	list redirect_zone 'lan'      # 重定向/劫持作用的防火墙区域
```

## 编译

已通过全部静态检查（Makefile 规范、po→lmo 编译、JS `node --check`、shell `sh -n`），可作为 OpenWrt 包编译：

```bash
git clone <this repo> package/luci-app-adguardhome
./scripts/feeds update -a
./scripts/feeds install -a
make menuconfig  # LuCI → Applications → luci-app-adguardhome
make -j$(nproc) V=s
```

运行时依赖：`luci-base`、`curl`、`wget-ssl`、`adguardhome`（安装时需已装；编译本包无需其源码）。

## 仓库结构

标准 OpenWrt/LuCI 包布局，克隆后即可作为包编译：

```
├── Makefile         # OpenWrt 包构建（luci.mk）
├── htdocs/          # 前端资源（view JS、CodeMirror）
├── root/            # init 模板（usr/share）、rpcd 后端、脚本、UCI 默认配置、menu/acl
├── po/              # 翻译（en / zh_Hans）
├── tools/           # 开发辅助工具
│   ├── po2lmo.py    #   po → lmo 编译
│   ├── deploy_lmo.sh#   部署汉化 lmo 到路由器
│   ├── read_lmo.py  #   读取 lmo 内容
│   ├── adguardhome.zh-cn.lmo  # 当前汉化产物
│   ├── backup_agh.sh#   备份路由器 AGH 配置
│   └── install_agh.sh#   按目录映射安装到路由器
└── docs/            # 开发审计文档
```

## 参考与版权归属

本项目为**全新重写实现**，但部分功能参考了以下上游项目（均以 Apache License 2.0 发布，兼容本项目许可）：

| 上游项目 | 版权 | 许可证 | 参考内容 |
|----------|------|--------|----------|
| [OpenWrt 官方 luci-app-adguardhome](https://github.com/openwrt/luci/tree/master/applications/luci-app-adguardhome) | Duncan Hill | Apache-2.0 | 总体页面架构、REST 交互模式 |
| [kiddin9/luci-app-adguardhome](https://github.com/kiddin9/luci-app-adguardhome) | Douglas Orend | Apache-2.0 | init.d 重定向逻辑、rpcd `parse_yaml`、前端改密 |
| [kenzok8/small-package](https://github.com/kenzok8/small-package) 中的 luci-app-adguardhome | 社区 | Apache-2.0 | 上述版本的衍生，主要对照参考 |

**参考了上游思路/代码的部分**：

- `root/usr/libexec/rpcd/luci.adguardhome`：`parse_yaml`（jshn + sed 解析 AGH YAML）思路来自上游，本实现保留了该解析方法并重写周边逻辑
- `root/usr/share/adguardhome/adguardhome.init`（安装时复制为 `/etc/init.d/adguardhome`）：重定向 / 劫持模式（`use_port53`、`restore_exchange`、`set_redirect`、`set_forward_dnsmasq`、`clear_redirect`）的功能设计参考上游，但为全新实现（修复了上游端口硬编码、路径硬编码、jail 挂载等 bug）
- 前端：改密（TwinBcrypt）、YAML 编辑器（CodeMirror）、页面与选项布局参考上游
- `addhost.sh`：主机映射写入 `/etc/hosts` 的思路参考 small-package 的 `addhost.sh`，并参考现有 `sync_dnsmasq_hosts6.sh`

**自主实现的部分**（与上游的主要差异）：全新 5 页面 JS 前端、rpcd 后端完整重写（路径跟随 UCI）、本地域同步（`sync_local_domain`）、私人 PTR 上游（`sync_local_ptr`）、实时主机同步（`hosts_watch.sh`）、每任务独立频率的计划任务、专属日志文件方案、programadd 段自愈。

## 许可证

本项目以 [Apache License 2.0](LICENSE)（Apache License, Version 2.0, January 2004）发布，完整许可证文本见仓库根目录 `LICENSE` 文件。允许自由使用、修改与分发，但须保留版权与许可声明。
