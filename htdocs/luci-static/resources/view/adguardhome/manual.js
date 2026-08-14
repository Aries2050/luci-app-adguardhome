'use strict';
'require fs';
'require view';
'require ui';
'require uci';

function loadScript(src) {
	return new Promise(function(resolve, reject) {
		var s = document.createElement('script');
		s.src = src;
		s.onload = resolve;
		s.onerror = reject;
		document.head.appendChild(s);
	});
}

function loadStyle(href) {
	return new Promise(function(resolve) {
		var l = document.createElement('link');
		l.rel = 'stylesheet';
		l.href = href;
		l.onload = resolve;
		document.head.appendChild(l);
	});
}

return view.extend({
	load: function() {
		var self = this;
		// 路径跟随 UCI（config_file / bin_path 可配置，避免硬编码不一致）
		return uci.load('adguardhome').then(function() {
			self.configFile = uci.get('adguardhome', 'config', 'config_file') || '/etc/adguardhome/adguardhome.yaml';
			self.binPath = uci.get('adguardhome', 'config', 'bin_path') || '/usr/bin/AdGuardHome';
			return fs.read(self.configFile).catch(function() { return ''; });
		});
	},

	render: function(content) {
		var self = this;

		var ta = E('textarea', {
			'id': 'agh-yaml',
			'class': 'cbi-input-textarea',
			'style': 'width:100%;min-height:520px;font-family:monospace;font-size:12px',
			'wrap': 'off'
		}, [ content || '' ]);

		var errBox = E('pre', { 'id': 'agh-yaml-err', 'class': 'agh-err', 'style': 'display:none' }, '');

		var btnBar = E('div', { 'class': 'cbi-page-actions' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-apply',
				'click': L.bind(self.doSave, self)
			}, _('Validate & Save')),
			E('span', { 'class': 'alert-message', 'style': 'margin-left:8px;color:#888' },
				_('Saving restarts the service to apply the config; DNS is briefly interrupted.'))
		]);

		// 加载 CodeMirror（串行：先 lib 后 mode/addon，避免 CodeMirror 未定义）
		loadStyle(L.resource('adguardhome/codemirror/lib/codemirror.css'));
		loadStyle(L.resource('adguardhome/codemirror/theme/dracula.css'));
		loadStyle(L.resource('adguardhome/codemirror/addon/fold/foldgutter.css'));
		loadScript(L.resource('adguardhome/codemirror/lib/codemirror.js'))
			.then(function() { return loadScript(L.resource('adguardhome/codemirror/mode/yaml/yaml.js')); })
			.then(function() { return loadScript(L.resource('adguardhome/codemirror/addon/fold/foldcode.js')); })
			.then(function() { return loadScript(L.resource('adguardhome/codemirror/addon/fold/foldgutter.js')); })
			.then(function() { return loadScript(L.resource('adguardhome/codemirror/addon/fold/indent-fold.js')); })
			.then(function() {
				if (typeof CodeMirror === 'undefined')
					return;
				self.editor = CodeMirror.fromTextArea(ta, {
					mode: 'yaml',
					lineNumbers: true,
					theme: 'dracula',
					lineWrapping: true,
					styleActiveLine: true,
					foldGutter: true,
					gutters: [ 'CodeMirror-linenumbers', 'CodeMirror-foldgutter' ]
				});
				self.editor.setSize('100%', null);
			});

		return E([], [
			E('h2', {}, _('AdGuard Home Manual Config')),
			ta,
			errBox,
			btnBar
		]);
	},

	doSave: function() {
		var self = this;
		var text = this.editor ? this.editor.getValue() : (document.getElementById('agh-yaml').value || '');
		var tmp = '/tmp/AGH_manual.yaml';
		var errBox = document.getElementById('agh-yaml-err');

		fs.write(tmp, text).then(function() {
			return fs.exec(self.binPath, [ '-c', tmp, '--check-config' ]);
		}).then(function(res) {
			if (res && res.code === 0) {
				// AGH 没有配置文件监视自动加载，保存后必须重启服务才生效
				return fs.write(self.configFile, text).then(function() {
					return fs.exec('/etc/init.d/adguardhome', [ 'restart' ]).then(function() {
						if (errBox) {
							errBox.style.display = 'none';
							errBox.textContent = '';
						}
						ui.addNotification(null, E('p', {}, _('Configuration saved and applied.')));
					});
				});
			}
			if (errBox) {
				errBox.style.display = 'block';
				errBox.textContent = (res && (res.stderr || res.stdout)) || _('Validation failed');
			}
		}).catch(function(e) {
			if (errBox) {
				errBox.style.display = 'block';
				errBox.textContent = String(e);
			}
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
