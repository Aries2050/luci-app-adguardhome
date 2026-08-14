'use strict';
'require dom';
'require fs';
'require view';
'require uci';

return view.extend({
	load: function() {
		var self = this;
		return Promise.all([
			L.resolveDefault(fs.stat('/sbin/logread'), null),
			L.resolveDefault(fs.stat('/usr/sbin/logread'), null),
			uci.load('adguardhome')
		]).then(function(r) {
			var logger = r[0] ? r[0].path : (r[1] ? r[1].path : null);
			// AGH 配置了专属日志文件（-l /path）时读文件；否则读 syslog
			var logfile = uci.get('adguardhome', 'config', 'logfile') || '';
			if (logfile && logfile !== 'syslog') {
				return fs.exec_direct('/usr/bin/tail', [ '-n', '500', logfile ]).catch(function(err) {
					return _('Unable to load log file: ') + err.message;
				});
			}

			if (!logger)
				return '';

			return fs.exec_direct(logger, [ '-e', 'AdGuardHome' ]).catch(function(err) {
				return _('Unable to load log data: ') + err.message;
			});
		});
	},

	render: function(logdata) {
		var lines = (logdata || '').trim().split(/\n/).reverse().slice(0, 200);

		return E([], [
			E('h2', {}, _('AdGuard Home Logs')),
			E('div', {}, _('Showing last ') + lines.length + ' ' + _('lines')),
			E('textarea', {
				'id': 'agh-syslog',
				'class': 'cbi-input-textarea',
				'style': 'font-family:monospace;font-size:12px;width:100%;min-height:320px',
				'readonly': 'readonly',
				'wrap': 'off',
				'rows': Math.max(lines.length, 10)
			}, [ lines.join('\n') ])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
