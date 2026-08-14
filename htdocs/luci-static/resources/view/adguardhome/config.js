'use strict';
'require rpc';
'require form';
'require view';
'require poll';
'require ui';
'require uci';
'require tools.widgets as widgets';

const DEFAULT_CONFIG_FILE = '/etc/adguardhome/adguardhome.yaml';
const DEFAULT_WORK_DIR = '/var/lib/adguardhome';
const DEFAULT_BIN = '/usr/bin/AdGuardHome';

function validateAbs(_u, v) {
	if (v == null || v === '')
		return true;
	if (!v.startsWith('/'))
		return _('Path must be absolute.');
	return true;
}

function validateConfigFile(_u, v) {
	if (v == null || v === '')
		return true;
	if (!v.startsWith('/'))
		return _('Path must be absolute.');
	if (v.endsWith('/'))
		return _('Path must not end with a slash.');
	if (/^\/etc(\/[^/]+)?\/?$/.test(v))
		return _('Config must be stored in its own directory, not /etc.');
	return true;
}

return view.extend({
	load_status: rpc.declare({ object: 'luci.adguardhome', method: 'get_status' }),
	load_config: rpc.declare({ object: 'luci.adguardhome', method: 'get_config' }),
	check_hijack: rpc.declare({ object: 'luci.adguardhome', method: 'check_dns_hijack' }),
	do_update: rpc.declare({ object: 'luci.adguardhome', method: 'do_update', params: ['force'] }),
	get_update_status: rpc.declare({ object: 'luci.adguardhome', method: 'get_update_status' }),

	load: function() {
		var self = this;
		return Promise.all([
			this.load_status(),
			this.load_config(),
			uci.load('dhcp'),
			uci.load('firewall')
		]).then(function(r) {
			// 读取 dnsmasq 本地域，用于同步开关的动态描述（不写死具体域名）
			self.dnsmasqDomain = uci.get('dhcp', '@dnsmasq[0]', 'domain') || '';
			// 读取实际存在的内部防火墙区域名，用于重定向区域描述的示例（不写死 lan/guest/iot）
			// 注意：uci.sections() 返回的是 section 对象数组（含 .name/.type），不是 id 数组
			self.internalZones = [];
			uci.sections('firewall', 'zone').forEach(function(sec) {
				var n = sec.name;
				if (n && !/^wan/i.test(n))
					self.internalZones.push(n);
			});
			return r;
		});
	},

	pollUpdate: function() {
		var box = document.getElementById('agh-update-log');
		var self = this;
		if (box)
			box.style.display = 'block';
		var timer = setInterval(function() {
			self.get_update_status().then(function(r) {
				if (!r) return;
				if (box)
					box.textContent = (r.log || '');
				if (!r.running)
					clearInterval(timer);
			}).catch(function() { clearInterval(timer); });
		}, 1500);
	},

	startUpdate: function(force) {
		var self = this;
		return this.do_update({ force: force ? 1 : 0 }).then(function(r) {
			if (r && r.error === 'already_running') {
				ui.addNotification(null, E('p', {}, _('Update already running')));
				return;
			}
			self.pollUpdate();
		});
	},

	render: function(data) {
		var status = data[0] || {};
		var agh = data[1] || {};
		var self = this;
		var m, s, o;

		m = new form.Map('adguardhome', _('AdGuard Home Configuration'));

		// ---- 状态栏 ----
		s = m.section(form.TypedSection, 'adguardhome');
		s.anonymous = true;
		s.render = function() {
			return E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-section-node' }, [
					E('p', { 'id': 'agh-status', 'style': 'margin:0;padding:6px 0' }, _('Collecting data...'))
				])
			]);
		};

		// ---- 基本设置 ----
		s = m.section(form.NamedSection, 'config', 'adguardhome', _('General settings'));
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable'),
			_('Start AdGuard Home and apply the redirect mode below. Disable to stop the service and restore dnsmasq to port 53.'));
		o.rmempty = false;

		o = s.option(form.ListValue, 'redirect', _('Redirect mode'),
			_('How DNS traffic is handled by AdGuard Home.'));
		o.value('none', _('Not enabled'));
		o.value('dnsmasq-upstream', _('Run as dnsmasq upstream server'));
		o.value('redirect', _('Redirect 53 port to AdGuardHome'));
		o.value('exchange', _('Use port 53 replace dnsmasq'));
		o.default = 'none';
		o.rmempty = false;

		o = s.option(form.Flag, 'dns_hijack', _('DNS hijack'),
			_('Force all LAN DNS traffic (including queries to external DNS servers) to AdGuard Home. Independent switch, can be combined with any redirect mode. When enabled, existing hijack rules from other plugins are detected and reported.'));
		o.rmempty = false;
		o.onchange = function(ev, section_id, value) {
			if (!value)
				return;
			return self.check_hijack().then(function(r) {
				if (r && r.hijack)
					ui.addNotification(null, E('p', {}, _('Detected existing DNS hijack rules from other plugins:') + ' ' + (r.detail || '')));
			});
		};

		o = s.option(form.Flag, 'sync_local_domain', _('Sync local domain with dnsmasq'),
			_('When enabled, AdGuard Home\'s local_domain_name is kept in sync with the dnsmasq domain (%s) at service start, so LAN device IPv6 reverse lookups (PTR) resolve correctly.').format(self.dnsmasqDomain || _('unset')));
		o.rmempty = false;

		o = s.option(form.Flag, 'sync_local_ptr', _('Private PTR upstream to dnsmasq'),
			_('When enabled, AdGuard Home\'s private reverse DNS servers (local_ptr_upstreams) are automatically pointed to dnsmasq at service start, so PTR lookups for private addresses (e.g. 192.168.x.x) resolve to LAN device names.'));
		o.rmempty = false;

		o = s.option(widgets.ZoneSelect, 'redirect_zone', _('Redirect zones'),
			_('Firewall zones to apply redirect/hijack. Select one or more (e.g. %s), or leave empty to apply to all internal firewall zones (wan and requests from the router itself are excluded).').format(
				self.internalZones.length ? self.internalZones.slice(0, 3).join(', ') : 'lan, guest, iot'));
		o.multiple = true;
		o.rmempty = true;
		o.filter = function(section_id, value) { return value !== 'wan'; };

		// ---- 核心更新 ----
		o = s.option(form.ListValue, 'release_channel', _('Update channel'),
			_('Release channel used when updating the core: stable or beta.'));
		o.value('stable', _('Stable'));
		o.value('beta', _('Beta'));
		o.default = 'stable';
		o.rmempty = false;

		o = s.option(form.Button, 'update_core', _('Update core'),
			_('Check for and download the AdGuard Home core. The service is stopped and restarted, causing a brief DNS interruption.'));
		o.inputtitle = _('Check & Update');
		o.onclick = function() {
			return self.startUpdate(false);
		};

		// ---- 路径 ----
		s = m.section(form.NamedSection, 'config', 'adguardhome', _('Paths'));
		s.addremove = false;

		o = s.option(form.Value, 'config_file', _('Config file'),
			_('Path to the AdGuard Home YAML config. Must be in its own directory, not /etc.'));
		o.datatype = 'string';
		o.placeholder = DEFAULT_CONFIG_FILE;
		o.validate = validateConfigFile;

		o = s.option(form.Value, 'work_dir', _('Work dir'), _('Stores stats/rules/databases.'));
		o.datatype = 'string';
		o.placeholder = DEFAULT_WORK_DIR;
		o.validate = validateAbs;

		o = s.option(form.Value, 'bin_path', _('Binary path'),
			_('Path to the AdGuard Home executable. Downloaded automatically if missing on start.'));
		o.datatype = 'string';
		o.placeholder = DEFAULT_BIN;
		o.validate = validateAbs;

		o = s.option(form.Value, 'http_port', _('Web interface port'),
			_('Listening port of the AdGuard Home web UI.'));
		o.datatype = 'port';
		o.placeholder = '3000';

		o = s.option(form.Value, 'logfile', _('Runtime log file'),
			_('Path where AdGuard Home writes its runtime log. It is shown on the Logs page and used by the "Tail runtime log" scheduled task. Leave empty to log to the system log (syslog) instead of a file.'));
		o.datatype = 'string';
		o.placeholder = '/var/log/adguardhome.log';

		// ---- 进程 ----
		s = m.section(form.NamedSection, 'config', 'adguardhome', _('Process'));
		s.addremove = false;

		o = s.option(form.Value, 'user', _('Service user'),
			_('System user running AdGuard Home. Needs capabilities to bind low ports like 53.'));
		o.placeholder = 'adguardhome';

		o = s.option(form.Value, 'group', _('Service group'),
			_('System group running AdGuard Home.'));
		o.placeholder = 'adguardhome';

		o = s.option(form.Value, 'gc', _('GOGC'), _('GC target percentage. 0 = unset (Go official default 100: GC runs when the heap grows by 100%).'));
		o.datatype = 'uinteger';
		o.placeholder = '0';

		o = s.option(form.Value, 'maxprocs', _('GOMAXPROCS'), _('0 = unset (Go official default: automatically matches CPU count / cgroup quota).'));
		o.datatype = 'uinteger';
		o.placeholder = '0';

		o = s.option(form.Value, 'memlimit', _('Memory limit (MiB)'), _('Soft memory limit for the Go runtime (GOMEMLIMIT). 0 = unset (official default: no limit). Suggested: 25%-50% of device RAM.'));
		o.datatype = 'uinteger';
		o.placeholder = '0';

		o = s.option(form.Flag, 'verbose', _('Verbose log'),
			_('Enable more detailed service logging.'));
		o.rmempty = true;

		// ---- 状态轮询（等 DOM 就绪后用 setInterval 持续刷新）----
		setTimeout(function() {
			setInterval(function() {
				self.load_status().then(function(st) {
					var box = document.getElementById('agh-status');
					if (!box)
						return;
					var running = !!(st && st.running);
					box.innerHTML = '';
					box.appendChild(E('span', { 'style': running ? 'color:green' : 'color:red' }, running ? _('RUNNING') : _('NOT RUNNING')));
					if (running && agh.web_url) {
						// 跟随当前 LuCI 地址的主机名（协议/端口取自 web_url）
						var wm = agh.web_url.match(/^(https?):\/\/[^/:]+(?::(\d+))?/);
						var wurl = (wm ? wm[1] : 'http') + '://' + window.location.hostname + ':' + (wm && wm[2] ? wm[2] : '3000') + '/';
						box.appendChild(E('a', { 'class': 'btn cbi-button cbi-button-apply', 'href': wurl, 'target': '_blank', 'rel': 'noreferrer noopener', 'style': 'margin-left:10px' }, _('Open Web Interface')));
					}
				});
			}, 2000);
		}, 300);

		return m.render().then(function(rendered) {
			rendered.appendChild(E('pre', { 'id': 'agh-update-log', 'style': 'display:none;white-space:pre-wrap;font-family:monospace;font-size:12px;max-height:260px;overflow:auto;background:rgba(128,128,128,.08);padding:8px' }, ''));
			return rendered;
		});
	}
});
