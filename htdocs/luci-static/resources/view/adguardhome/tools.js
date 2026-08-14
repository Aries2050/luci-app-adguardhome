'use strict';
'require rpc';
'require form';
'require view';
'require ui';
'require uci';
'require tools.widgets as widgets';

function formValue(id) {
	var el = document.getElementById(id);
	return el ? el.value : null;
}

function getVal(prefixed, plain) {
	return formValue(prefixed) != null ? formValue(prefixed) : formValue(plain);
}

return view.extend({
	set_passwd: rpc.declare({ object: 'luci.adguardhome', method: 'set_passwd', params: ['username', 'hash', 'password', 'sync'] }),
	clear_passwd: rpc.declare({ object: 'luci.adguardhome', method: 'clear_passwd' }),

	// 保存（含“保存并应用”）后处理凭证：改密则同步到 AGH；取消勾选则清除界面凭证
	handleSave: function(ev) {
		var self = this;
		return this.super('handleSave', ev).then(function() {
			return self.handleCredentials();
		});
	},

	handleCredentials: function() {
		var self = this;
		// 保存后读取 UCI 值（LuCI 表单控件的 DOM id 是随机生成的，不能用 getElementById('cbid...')）
		var enabled = uci.get('adguardhome', 'config', 'sync_web_password') !== '0';
		var user = uci.get('adguardhome', 'config', 'web_username') || '';
		var pw = uci.get('adguardhome', 'config', 'web_password') || '';
		if (enabled) {
			if (pw && pw !== this.origPw) {
				if (typeof TwinBcrypt === 'undefined')
					return Promise.resolve(false);
				var hash = TwinBcrypt.hashSync(pw);
				return self.set_passwd(user || 'admin', hash, pw, 1).then(function(r) {
					if (r && r.success)
						self.origPw = pw;
				});
			}
			return Promise.resolve(true);
		}
		return self.clear_passwd();
	},

	render: function() {
		var self = this;
		var m, s, o;

		// 记住原密码，用于保存时判断是否修改了密码
		this.origPw = uci.get('adguardhome', 'config', 'web_password') || '';

		m = new form.Map('adguardhome', _('AdGuard Home Tools'));

		// ---- 改密 ----
		s = m.section(form.NamedSection, 'config', 'adguardhome', _('Change password'));
		s.addremove = false;

		o = s.option(form.Value, 'web_username', _('Username'), _('AdGuard Home web/REST API username.'));
		o.default = 'admin';
		o.rmempty = false;

		o = s.option(form.Value, 'web_password', _('Password'),
			_('AdGuard Home password. Enter a new password and click "Save & Apply" to apply it to AdGuard Home and update the interface credentials.'));
		o.password = true;
		o.rmempty = true;

		o = s.option(form.Flag, 'sync_web_password', _('Enable password-required features (statistics)'),
			_('When checked, password-required features (statistics) are enabled and the credentials are kept in sync on "Save & Apply". When unchecked and saved, those features are disabled and the saved credentials are cleared.'));
		// 不能用 rmempty=true + default=true：值等于默认时 LuCI 保存会误删该选项
		o.rmempty = false;

		// ---- sysupgrade 保留 ----
		s = m.section(form.NamedSection, 'config', 'adguardhome', _('Keep files on sysupgrade'));
		s.addremove = false;

		o = s.option(form.MultiValue, 'keep_files', _('Keep files'),
			_('Files/dirs preserved across sysupgrade (paths are expanded at service start).'));
		o.widget = 'checkbox';
		o.value('$bin_path', _('Binary'));
		o.value('$config_file', _('Config file'));
		o.value('$work_dir/data/sessions.db', _('sessions.db'));
		o.value('$work_dir/data/stats.db', _('stats.db'));
		o.value('$work_dir/data/querylog.json', _('querylog.json'));
		o.value('$work_dir/data/filters', _('filters'));

		// ---- 备份 ----
		s = m.section(form.NamedSection, 'config', 'adguardhome', _('Backup'));
		s.addremove = false;

		o = s.option(form.MultiValue, 'backup_files', _('Backup on shutdown'),
			_('Files copied to the backup path when the service stops; restored if work dir is empty.'));
		o.widget = 'checkbox';
		o.value('filters', _('filters'));
		o.value('stats.db', _('stats.db'));
		o.value('querylog.json', _('querylog.json'));
		o.value('sessions.db', _('sessions.db'));

		o = s.option(form.Value, 'backup_path', _('Backup path'),
			_('Directory where backup data files are copied when the service stops.'));
		o.placeholder = '/etc/adguardhome';

		// ---- 计划任务 ----
		s = m.section(form.NamedSection, 'config', 'adguardhome', _('Scheduled tasks'));
		s.addremove = false;

		o = s.option(form.MultiValue, 'crontab', _('Crontab'), _('Manage crontab entries automatically.'));
		o.widget = 'checkbox';
		o.value('autoupdate', _('Auto update core'));
		o.value('cutquerylog', _('Tail querylog'));
		o.value('cutruntimelog', _('Tail runtime log'));
		o.value('autohost', _('Update IPv6 hosts'));

		// 每个计划任务独立的执行频率（留空用内置默认）
		function freqOptions(o) {
			o.value('', _('Default (per task)'));
			o.value('0 * * * *', _('Hourly'));
			o.value('0 */6 * * *', _('Every 6 hours'));
			o.value('30 3 * * *', _('Daily at 03:30'));
			o.value('30 3 * * 0', _('Weekly on Sunday 03:30'));
			o.value('*/15 * * * *', _('Every 15 minutes'));
		}

		o = s.option(form.ListValue, 'autoupdate_freq', _('Auto update core frequency'),
			_('Override the execution frequency of the auto-update task. Leave default for the built-in schedule.'));
		freqOptions(o);

		o = s.option(form.ListValue, 'cutquerylog_freq', _('Tail querylog frequency'),
			_('Override the execution frequency of the querylog cut task. Leave default for the built-in schedule.'));
		freqOptions(o);

		o = s.option(form.ListValue, 'cutruntimelog_freq', _('Tail runtime log frequency'),
			_('Override the execution frequency of the runtime log cut task. Leave default for the built-in schedule.'));
		freqOptions(o);

		o = s.option(form.ListValue, 'autohost_freq', _('Update IPv6 hosts frequency'),
			_('Override the execution frequency of the IPv6 hosts task. Leave default for the built-in schedule.'));
		freqOptions(o);

		// 实时主机监听接口：官方设备选择器（带接口图标徽章，同防火墙页），支持多选；留空 = 自动检测
		var watchIfaceOpt = s.option(widgets.DeviceSelect, 'watch_iface', _('Hosts watch interfaces'),
			_('Network interfaces monitored by the realtime IPv6 hosts watcher. Select one or more, or leave empty to auto-detect (network.lan.ifname, then br-lan).'));
		watchIfaceOpt.multiple = true;
		watchIfaceOpt.rmempty = true;
		watchIfaceOpt.noaliases = true; // 排除 @xxx 别名接口（ip monitor 无法监听）

		// ---- 下载源 ----
		s = m.section(form.NamedSection, 'config', 'adguardhome', _('Download sources'));
		s.addremove = false;

		o = s.option(form.TextValue, 'download_links', _('Download links'), _('One URL per line, first reachable wins. Leave empty to use default sources (static.adguard.com for the selected update channel, then GitHub releases).'));
		o.rows = 6;

		// bcrypt 脚本
		var script = E('script', { 'type': 'text/javascript', 'src': L.resource('view/twin-bcrypt.min.js') });

		return m.render().then(function(rendered) {
			rendered.appendChild(script);
			return rendered;
		});
	}
});
