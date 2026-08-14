'use strict';
'require rpc';
'require view';
'require poll';
'require uci';
'require ui';

return view.extend({
	callStatus: rpc.declare({ object: 'luci.adguardhome', method: 'get_status' }),
	callConfig: rpc.declare({ object: 'luci.adguardhome', method: 'get_config' }),
	callStats: rpc.declare({ object: 'luci.adguardhome', method: 'get_statistics' }),
	callSetEnabled: rpc.declare({ object: 'luci.adguardhome', method: 'set_enabled', params: ['enabled'] }),

	load: function() {
		return Promise.all([ uci.load('adguardhome'), this.callStatus(), this.callConfig() ]);
	},

	render: function(data) {
		var cfg = {};
		cfg.enabled = uci.get('adguardhome', 'config', 'enabled');
		cfg.redirect = uci.get('adguardhome', 'config', 'redirect') || 'none';
		cfg.dns_hijack = uci.get('adguardhome', 'config', 'dns_hijack') || '0';
		cfg.http_port = uci.get('adguardhome', 'config', 'http_port') || '3000';
		cfg.bin_path = uci.get('adguardhome', 'config', 'bin_path') || '/usr/bin/AdGuardHome';
		cfg.features = uci.get('adguardhome', 'config', 'sync_web_password') !== '0';

		var status = data[1] || {};
		var agh = data[2] || {};
		var self = this;

		var redirectLabels = {
			'none': _('Not enabled'),
			'dnsmasq-upstream': _('dnsmasq upstream'),
			'redirect': _('53 port redirect'),
			'exchange': _('Replace dnsmasq')
		};

		// 服务状态（原生风格，可轮询刷新）
		// 获取数据中显示默认（黑色）字体；运行中/未运行用绿/红区分
		var statusTxt = E('span', {}, E('span', {}, _('Collecting data...')));
		var toggleEl = E('input', {
			'type': 'checkbox',
			'change': function(ev) {
				var val = ev.target.checked ? '1' : '0';
				// UCI enabled 由后端 set_enabled 写入（init.d enable/start|stop）。
				// 注意：rpc.declare 带 params 时必须传位置参数（如 1/0），不能传 {enabled:1} 对象——
				// 传对象会使后端 json_get_var 读到空值，enabled 误走停用分支。
				// 亦勿用 uci.commit——LuCI 的 uci 模块没有 commit 方法。
				return self.callSetEnabled(val === '1' ? 1 : 0).then(function() {
					ui.addNotification(null, E('p', {},
						val === '1' ? _('Enabling AdGuard Home...') : _('Disabling AdGuard Home...')));
				});
			}
		});

		setInterval(function() {
			self.callStatus().then(function(st) {
				var running = !!(st && st.running);
				toggleEl.checked = running;
				statusTxt.innerHTML = '';
				statusTxt.appendChild(running
					? E('span', { 'style': 'color:green' }, _('RUNNING'))
					: E('span', { 'style': 'color:red' }, _('NOT RUNNING')));
			});
		}, 2000);

		// 打开 Web 界面：跟随当前 LuCI 地址的主机名（协议/端口取自 web_url）
		var webM = (agh.web_url || '').match(/^(https?):\/\/[^/:]+(?::(\d+))?/);
		var webUrl = (webM ? webM[1] : 'http') + '://' + window.location.hostname + ':' + (webM && webM[2] ? webM[2] : cfg.http_port) + '/';

		function row(title, value) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'width': '33%' }, title),
				E('td', { 'class': 'td left' }, value)
			]);
		}

		// 统计区块（需 AGH 密码；异步加载，失败仅提示不影响页面）
		var statsBox = E('div', { 'class': 'cbi-section' }, [
			E('div', { 'class': 'cbi-section-node' }, [
				E('p', { 'id': 'agh-stats', 'style': 'margin:0;padding:6px 0' }, _('Collecting statistics...'))
			])
		]);
		setTimeout(function() {
			var sbox = document.getElementById('agh-stats');
			if (!cfg.features) {
				if (sbox) {
					sbox.innerHTML = '';
					sbox.appendChild(E('span', {}, _('Statistics disabled (enable in Tools).')));
				}
				return;
			}
			self.callStats().then(function(st) {
				var box = document.getElementById('agh-stats');
				if (!box) return;
				box.innerHTML = '';
				if (!st || st.error || st.auth_error) {
					box.appendChild(E('span', {}, _('Statistics require the AdGuard Home password (set in Tools → Change password).')));
					return;
				}
				var total = st.num_dns_queries || 0;
				var blocked = (st.num_blocked_filtering || 0) + (st.num_replaced_safebrowsing || 0) + (st.num_replaced_safesearch || 0) + (st.num_replaced_parental || 0);
				var rate = total > 0 ? ((blocked * 100 / total).toFixed(1) + '%') : '-';
				var avgTxt = '-';
				if (st.avg_processing_time) {
					var avgs = parseFloat(st.avg_processing_time);
					if (!isNaN(avgs))
						avgTxt = avgs >= 1 ? avgs.toFixed(2) + ' s' : (avgs >= 0.001 ? (avgs * 1000).toFixed(1) + ' ms' : (avgs * 1000000).toFixed(0) + ' µs');
					else
						avgTxt = String(st.avg_processing_time);
				}
				box.appendChild(E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td left', 'width': '33%' }, _('Total queries')), E('td', { 'class': 'td left' }, String(total)) ]),
					E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td left' }, _('Blocked')), E('td', { 'class': 'td left' }, String(blocked) + ' (' + rate + ')') ]),
					E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td left' }, _('Avg processing time')), E('td', { 'class': 'td left' }, avgTxt) ])
				]));
				// AGH top_* 为单键对象数组，如 [{"host": count}]
				function topRows(arr) {
					return arr.slice(0, 10).map(function(el) {
						var k = Object.keys(el)[0];
						return E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td left' }, k), E('td', { 'class': 'td right' }, String(el[k])) ]);
					});
				}
				if (st.top_blocked_domains && st.top_blocked_domains.length) {
					box.appendChild(E('h3', { 'style': 'margin:.6em 0 .2em' }, _('Top blocked domains')));
					box.appendChild(E('table', { 'class': 'table' }, topRows(st.top_blocked_domains)));
				}
				if (st.top_clients && st.top_clients.length) {
					box.appendChild(E('h3', { 'style': 'margin:.6em 0 .2em' }, _('Top clients')));
					box.appendChild(E('table', { 'class': 'table' }, topRows(st.top_clients)));
				}
			}).catch(function() {
				var box = document.getElementById('agh-stats');
				if (box) box.innerHTML = '';
			});
		}, 200);

		return E([], [
			E('h2', {}, _('AdGuard Home')),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-section-node' }, [
					E('table', { 'class': 'table' }, [
						row(_('Service'), statusTxt),
						row(_('Enable'), [ toggleEl, ' ', E('span', {}, _('Start / stop the service')) ]),
						row(_('Redirect mode'), redirectLabels[cfg.redirect] || cfg.redirect),
						row(_('DNS hijack'), (cfg.dns_hijack === '1') ? _('Enabled') : _('Disabled')),
						row(_('Core version'), status.version || _('Unknown')),
						row(_('Binary'), cfg.bin_path)
					])
				])
			]),
			statsBox,
			E('div', { 'class': 'cbi-page-actions' }, [
				E('a', { 'class': 'btn cbi-button cbi-button-apply', 'href': webUrl, 'target': '_blank', 'rel': 'noreferrer noopener' }, _('Open Web Interface')),
				E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/services/adguardhome/config') }, _('Configuration')),
				E('a', { 'class': 'btn cbi-button', 'href': L.url('admin/services/adguardhome/logs') }, _('Logs'))
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
