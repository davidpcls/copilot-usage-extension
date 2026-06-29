import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const GITHUB_API_ROOT = 'https://api.github.com';
const GITHUB_HOST = 'github.com';
const GITHUB_API_VERSION = '2026-03-10';
const GH_HOSTS_FILE = 'hosts.yml';

const PANEL_PROGRESS_BAR_WIDTH = 50;
const MENU_PROGRESS_BAR_WIDTH = 240;

const CopilotUsageIndicator = GObject.registerClass(
class CopilotUsageIndicator extends PanelMenu.Button {
    _init(extensionPath, settings, openPreferences) {
        super._init(0.0, 'Copilot Usage Indicator');

        this._extensionPath = extensionPath;
        this._settings = settings;
        this._openPreferences = openPreferences;
        this._session = this._createSession();
        this._cachedToken = null;
        this._cachedTokenSource = null;
        this._hasQuotaProgressData = false;

        this._box = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
        });

        const iconPath = GLib.build_filenamev([this._extensionPath, 'copilot-icon-22.png']);
        const gicon = Gio.icon_new_for_string(iconPath);
        this._icon = new St.Icon({
            gicon,
            style_class: 'copilot-icon',
            icon_size: 16,
        });
        this._box.add_child(this._icon);

        this._panelProgressBg = new St.Widget({
            style_class: 'copilot-panel-progress-bg',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelProgressBar = new St.Widget({
            style_class: 'copilot-panel-progress-bar',
        });
        this._panelProgressBg.add_child(this._panelProgressBar);
        this._box.add_child(this._panelProgressBg);

        this._label = new St.Label({
            text: '...',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'copilot-usage-label',
        });
        this._box.add_child(this._label);

        this.add_child(this._box);

        this._createMenu();

        this._updateDisplayMode();
        this._updateIconVisibility();
        this._updateIconStyle();
        this._setUnavailableState('...', 'Loading...');

        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            if (key === 'refresh-interval') {
                this._restartTimer();
            } else if (key === 'display-mode') {
                this._updateDisplayMode();
            } else if (key === 'show-icon') {
                this._updateIconVisibility();
            } else if (key === 'icon-style') {
                this._updateIconStyle();
            } else if (key === 'proxy-url') {
                this._recreateSession();
            } else if (key === 'api-token') {
                this._clearCachedToken();
                this._refreshUsage();
            }
        });

        this._refreshUsage();
        this._startTimer();
    }

    _updateDisplayMode() {
        const mode = this._settings.get_string('display-mode');
        const showLabel = mode !== 'bar' || !this._hasQuotaProgressData;
        const showBar = (mode === 'bar' || mode === 'both') && this._hasQuotaProgressData;

        if (showBar) {
            this._panelProgressBg.show();
        } else {
            this._panelProgressBg.hide();
        }

        if (showLabel) {
            this._label.show();
            this._label.set_style(showBar ? 'margin-left: 6px;' : 'margin-left: 0;');
        } else {
            this._label.hide();
        }
    }

    _updateIconVisibility() {
        const showIcon = this._settings.get_boolean('show-icon');
        if (showIcon) {
            this._icon.show();
        } else {
            this._icon.hide();
        }
    }

    _updateIconStyle() {
        const style = this._settings.get_string('icon-style');
        const desatName = 'monochrome-desaturate';
        const brightName = 'monochrome-brightness';
        const hasEffect = this._icon.get_effect(desatName) !== null;

        if (style === 'monochrome' && !hasEffect) {
            this._icon.add_effect(new Clutter.DesaturateEffect({factor: 1.0, name: desatName}));
            const brightnessEffect = new Clutter.BrightnessContrastEffect({name: brightName});
            brightnessEffect.set_brightness_full(1, 1, 1);
            this._icon.add_effect(brightnessEffect);
        } else if (style !== 'monochrome' && hasEffect) {
            this._icon.remove_effect_by_name(desatName);
            this._icon.remove_effect_by_name(brightName);
        }
    }

    _createSession() {
        const session = new Soup.Session();
        const proxyUrl = this._settings.get_string('proxy-url').trim();

        if (proxyUrl !== '') {
            const proxyResolver = Gio.SimpleProxyResolver.new(proxyUrl, null);
            session.set_proxy_resolver(proxyResolver);
        }

        return session;
    }

    _recreateSession() {
        if (this._session) {
            this._session.abort();
        }

        this._session = this._createSession();
        this._refreshUsage();
    }

    _createMenu() {
        const monthlyBox = new St.BoxLayout({
            style_class: 'copilot-usage-section',
            vertical: true,
            x_expand: true,
        });
        const monthlyHeader = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style_class: 'copilot-section-header',
        });
        this._monthlyTitle = new St.Label({
            text: 'Used',
            style_class: 'copilot-section-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        monthlyHeader.add_child(this._monthlyTitle);
        this._monthlyValue = new St.Label({
            text: '...',
            style_class: 'copilot-value-label',
            x_align: Clutter.ActorAlign.END,
        });
        monthlyHeader.add_child(this._monthlyValue);
        monthlyBox.add_child(monthlyHeader);

        const monthlyProgressBg = new St.Widget({
            style_class: 'copilot-progress-bg',
            x_expand: true,
        });
        this._monthlyProgressBar = new St.Widget({
            style_class: 'copilot-progress-bar usage-low',
        });
        monthlyProgressBg.add_child(this._monthlyProgressBar);
        monthlyBox.add_child(monthlyProgressBg);

        this._periodLabel = new St.Label({
            text: 'Reset: ...',
            style_class: 'copilot-detail-label',
        });
        monthlyBox.add_child(this._periodLabel);

        const monthlyItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        monthlyItem.add_child(monthlyBox);
        this.menu.addMenuItem(monthlyItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const budgetBox = new St.BoxLayout({
            style_class: 'copilot-usage-section',
            vertical: true,
            x_expand: true,
        });
        const budgetHeader = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style_class: 'copilot-section-header',
        });
        this._budgetTitle = new St.Label({
            text: 'Total',
            style_class: 'copilot-section-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        budgetHeader.add_child(this._budgetTitle);
        this._budgetValue = new St.Label({
            text: '...',
            style_class: 'copilot-value-label',
            x_align: Clutter.ActorAlign.END,
        });
        budgetHeader.add_child(this._budgetValue);
        budgetBox.add_child(budgetHeader);

        const budgetProgressBg = new St.Widget({
            style_class: 'copilot-progress-bg',
            x_expand: true,
        });
        this._budgetProgressBar = new St.Widget({
            style_class: 'copilot-progress-bar usage-low',
        });
        budgetProgressBg.add_child(this._budgetProgressBar);
        budgetBox.add_child(budgetProgressBg);

        this._remainingLabel = new St.Label({
            text: 'Remaining: ...',
            style_class: 'copilot-detail-label',
        });
        budgetBox.add_child(this._remainingLabel);

        this._budgetNoteLabel = new St.Label({
            text: 'Source: /copilot_internal/user',
            style_class: 'copilot-detail-label',
        });
        budgetBox.add_child(this._budgetNoteLabel);

        const budgetItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        budgetItem.add_child(budgetBox);
        this.menu.addMenuItem(budgetItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const footerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const footerBox = new St.BoxLayout({
            style_class: 'copilot-footer-box',
            x_expand: true,
        });
        const refreshContent = new St.BoxLayout({
            style_class: 'copilot-refresh-button-content',
        });
        this._refreshIcon = new St.Icon({
            icon_name: 'view-refresh-symbolic',
            style_class: 'copilot-refresh-button-icon',
            icon_size: 14,
            y_align: Clutter.ActorAlign.CENTER,
        });
        refreshContent.add_child(this._refreshIcon);
        this._refreshLabel = new St.Label({
            text: 'Refresh',
            style_class: 'copilot-refresh-button-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        refreshContent.add_child(this._refreshLabel);
        this._refreshButton = new St.Button({
            style_class: 'copilot-refresh-button',
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        this._refreshButton.set_child(refreshContent);
        this._refreshButton.connect('clicked', () => {
            this._refreshUsage();
        });
        footerBox.add_child(this._refreshButton);

        this._lastUpdatedLabel = new St.Label({
            text: 'Checked: —',
            style_class: 'copilot-last-updated-label',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        footerBox.add_child(this._lastUpdatedLabel);

        footerItem.add_child(footerBox);
        this.menu.addMenuItem(footerItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => {
            this._openPreferences();
        });
        this.menu.addMenuItem(settingsItem);
    }

    _startTimer() {
        const interval = this._settings.get_int('refresh-interval');
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._refreshUsage();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
    }

    _restartTimer() {
        this._stopTimer();
        this._startTimer();
    }

    _refreshUsage(allowAuthRetry = true) {
        this._setRefreshing(true);
        this._getAuthToken((tokenError, token) => {
            if (tokenError) {
                console.error(`Copilot Usage: ${tokenError.message}`);
                this._setUnavailableState('Auth', this._friendlyTokenError(tokenError.message));
                this._finishRefresh();
                return;
            }

            this._fetchCopilotInternalUser(token, (usageError, usageData, usageStatusCode) => {
                if (usageError) {
                    if (this._shouldRetryAuth(allowAuthRetry, usageStatusCode)) {
                        this._clearCachedToken();
                        this._refreshUsage(false);
                        return;
                    }

                    if (usageStatusCode !== 404) {
                        console.error(`Copilot Usage: /copilot_internal/user failed with HTTP ${usageStatusCode}: ${usageError.message}`);
                    }
                    this._setUnavailableState('Error', this._friendlyApiError(usageStatusCode));
                    this._finishRefresh();
                    return;
                }

                this._applyUsageData(usageData);
                this._finishRefresh();
            });
        });
    }

    _shouldRetryAuth(allowAuthRetry, statusCode) {
        return allowAuthRetry && statusCode === 401 && !this._isUsingManualToken();
    }

    _isUsingManualToken() {
        return this._extractTokenCandidate(this._settings.get_string('api-token')) !== '';
    }

    _clearCachedToken() {
        this._cachedToken = null;
        this._cachedTokenSource = null;
    }

    _setCachedToken(token, source) {
        this._cachedToken = token;
        this._cachedTokenSource = source;
    }

    _extractTokenCandidate(rawValue) {
        const value = String(rawValue ?? '').trim();
        if (value === '') {
            return '';
        }

        const lowered = value.toLowerCase();
        if (lowered.startsWith('github_pat_') || lowered.startsWith('ghp_') || lowered.startsWith('gho_')) {
            return value;
        }

        const prefixes = ['token ', 'bearer '];
        for (const prefix of prefixes) {
            if (lowered.startsWith(prefix)) {
                return value.slice(prefix.length).trim();
            }
        }

        return value;
    }

    _getAuthToken(callback) {
        const manualToken = this._extractTokenCandidate(this._settings.get_string('api-token'));

        if (manualToken !== '') {
            this._setCachedToken(manualToken, 'manual');
            callback(null, manualToken);
            return;
        }

        if (this._cachedTokenSource !== 'manual' && this._cachedToken && this._cachedToken.length > 0) {
            callback(null, this._cachedToken);
            return;
        }

        this._getTokenFromGhConfig((configError, configToken) => {
            if (configError) {
                callback(configError, null);
                return;
            }

            if (configToken) {
                this._setCachedToken(configToken, 'gh-config');
                callback(null, configToken);
                return;
            }

            this._getTokenFromGhCli((cliError, cliToken) => {
                if (cliError) {
                    callback(cliError, null);
                    return;
                }

                this._setCachedToken(cliToken, 'gh-cli');
                callback(null, cliToken);
            });
        });
    }

    _getTokenFromGhConfig(callback) {
        const configRoot = GLib.getenv('XDG_CONFIG_HOME') ?? GLib.build_filenamev([GLib.get_home_dir(), '.config']);
        const hostsPath = GLib.build_filenamev([configRoot, 'gh', GH_HOSTS_FILE]);
        const file = Gio.File.new_for_path(hostsPath);

        if (!file.query_exists(null)) {
            callback(null, null);
            return;
        }

        file.load_contents_async(null, (source, result) => {
            try {
                const [, contents] = source.load_contents_finish(result);
                const decoder = new TextDecoder('utf-8');
                const token = this._parseTokenFromHostsYaml(decoder.decode(contents), GITHUB_HOST);
                callback(null, token);
            } catch (e) {
                callback(new Error(`Failed to read GitHub CLI config: ${e.message}`), null);
            }
        });
    }

    _parseTokenFromHostsYaml(text, hostname) {
        const lines = text.split(/\r?\n/);
        let inHost = false;
        let hostIndent = 0;

        for (const line of lines) {
            const raw = line;
            const trimmed = raw.trim();
            if (trimmed === '' || trimmed.startsWith('#')) {
                continue;
            }

            const hostMatch = raw.match(/^(\s*)([^:\s][^:]*)\s*:\s*$/);
            if (hostMatch) {
                const indent = hostMatch[1].length;
                const key = hostMatch[2].trim();

                if (key === hostname) {
                    inHost = true;
                    hostIndent = indent;
                    continue;
                }

                if (inHost && indent <= hostIndent) {
                    inHost = false;
                }
            }

            if (!inHost) {
                continue;
            }

            const tokenMatch = raw.match(/^\s*oauth_token\s*:\s*(.+)\s*$/);
            if (!tokenMatch) {
                continue;
            }

            const parsed = this._extractTokenCandidate(this._stripYamlScalar(tokenMatch[1]));
            if (parsed !== '') {
                return parsed;
            }
        }

        return null;
    }

    _stripYamlScalar(value) {
        const hashIndex = value.indexOf('#');
        const withoutComment = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
        const trimmed = withoutComment.trim();
        if (trimmed.length < 2) {
            return trimmed;
        }

        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
            return trimmed.slice(1, -1);
        }

        return trimmed;
    }

    _getTokenFromGhCli(callback) {
        if (this._cachedTokenSource === 'gh-cli' && this._cachedToken && this._cachedToken.length > 0) {
            callback(null, this._cachedToken);
            return;
        }

        let process;
        try {
            process = Gio.Subprocess.new(
                ['gh', 'auth', 'token', '--hostname', GITHUB_HOST],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (e) {
            callback(new Error(`Unable to execute gh: ${e.message}`), null);
            return;
        }

        process.communicate_utf8_async(null, null, (proc, result) => {
            try {
                const [, stdout, stderr] = proc.communicate_utf8_finish(result);
                const token = this._extractTokenCandidate(stdout);

                if (!proc.get_successful() || token === '') {
                    const detail = stderr.trim() || 'GitHub CLI returned no token';
                    callback(new Error(detail), null);
                    return;
                }

                callback(null, token);
            } catch (e) {
                callback(new Error(`Failed to read gh token: ${e.message}`), null);
            }
        });
    }

    _fetchCopilotInternalUser(token, callback) {
        this._apiGetJson(`${GITHUB_API_ROOT}/copilot_internal/user`, token, callback);
    }

    _apiGetJson(url, token, callback) {
        const message = Soup.Message.new('GET', url);
        message.request_headers.append('Authorization', `Bearer ${token}`);
        message.request_headers.append('Accept', 'application/vnd.github+json');
        message.request_headers.append('X-GitHub-Api-Version', GITHUB_API_VERSION);
        message.request_headers.append('User-Agent', 'copilot-gnome-extension');

        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const statusCode = message.status_code;

                    if (statusCode < 200 || statusCode >= 300) {
                        callback(new Error(`GitHub API returned HTTP ${statusCode}`), null, statusCode);
                        return;
                    }

                    const decoder = new TextDecoder('utf-8');
                    const payload = JSON.parse(decoder.decode(bytes.get_data()));
                    callback(null, payload, statusCode);
                } catch (e) {
                    callback(new Error(`GitHub API request failed: ${e.message}`), null, message.status_code);
                }
            }
        );
    }

    _applyUsageData(payload) {
        const data = this._normalizeQuotaData(payload);

        const usedText = this._formatCredits(data.used);
        this._monthlyValue.set_text(`${usedText} used`);
        this._periodLabel.set_text(`Reset: ${data.resetLabel}`);

        if (data.unlimited) {
            this._hasQuotaProgressData = false;
            this._label.set_text(`${usedText} / Unlimited`);
            this._budgetValue.set_text('Unlimited');
            this._remainingLabel.set_text('Remaining: Unlimited');
            this._budgetNoteLabel.set_text(data.planLabel ? `Plan: ${data.planLabel}` : 'Premium interactions are unlimited');
            this._updatePanelProgressBar(0);
            this._updateProgressBar(this._monthlyProgressBar, 0, false);
            this._updateProgressBar(this._budgetProgressBar, 0, true);
            this._updateDisplayMode();
            return;
        }

        if (data.hasFiniteQuota) {
            this._hasQuotaProgressData = true;
            this._label.set_text(`${this._formatCredits(data.used)}/${this._formatCredits(data.entitlement)}`);
            this._budgetValue.set_text(`${this._formatCredits(data.entitlement)} total`);
            this._remainingLabel.set_text(`Remaining: ${this._formatCredits(data.remaining)}`);
            this._budgetNoteLabel.set_text(data.planLabel ? `Plan: ${data.planLabel}` : 'Source: /copilot_internal/user');
            this._updatePanelProgressBar(data.percentUsed);
            this._updateProgressBar(this._monthlyProgressBar, data.percentUsed, false);
            this._updateProgressBar(this._budgetProgressBar, data.percentRemaining, true);
        } else {
            this._hasQuotaProgressData = false;
            this._label.set_text(usedText);
            this._budgetValue.set_text('Unavailable');
            this._remainingLabel.set_text('Remaining: —');
            this._budgetNoteLabel.set_text('Premium interactions quota unavailable');
            this._updatePanelProgressBar(0);
            this._updateProgressBar(this._monthlyProgressBar, 0, false);
            this._updateProgressBar(this._budgetProgressBar, 0, true);
        }

        this._updateDisplayMode();
    }

    _normalizeQuotaData(payload) {
        const snapshot = this._extractPremiumInteractionsSnapshot(payload);
        if (snapshot === null) {
            return {
                used: null,
                remaining: null,
                entitlement: null,
                percentUsed: 0,
                percentRemaining: 0,
                hasFiniteQuota: false,
                unlimited: false,
                resetLabel: '—',
                planLabel: this._extractPlanLabel(payload, null),
            };
        }

        const entitlement = this._extractNumericValue(snapshot, ['entitlement', 'quota_entitlement', 'total', 'limit']);
        let remaining = this._extractNumericValue(snapshot, ['remaining', 'quota_remaining', 'available']);
        let used = this._extractNumericValue(snapshot, ['used', 'quota_used', 'consumed', 'usage']);
        const unlimited = this._coerceBoolean(snapshot?.unlimited);

        if (entitlement !== null && remaining !== null) {
            used = Math.max(0, entitlement - remaining);
        } else if (entitlement !== null && used !== null) {
            remaining = Math.max(0, entitlement - used);
        }

        const finiteQuota = !unlimited
            && entitlement !== null
            && entitlement > 0
            && remaining !== null
            && used !== null;

        const percentUsed = finiteQuota ? this._clampPercent((used / entitlement) * 100) : 0;
        const percentRemaining = finiteQuota ? this._clampPercent((remaining / entitlement) * 100) : 0;

        return {
            used,
            remaining,
            entitlement,
            percentUsed,
            percentRemaining,
            hasFiniteQuota: finiteQuota,
            unlimited,
            resetLabel: this._extractResetLabel(snapshot, payload),
            planLabel: this._extractPlanLabel(payload, snapshot),
        };
    }

    _extractPremiumInteractionsSnapshot(payload) {
        const quotaSnapshots = payload?.quota_snapshots ?? payload?.quotaSnapshots;
        const nested = quotaSnapshots?.premium_interactions ?? quotaSnapshots?.premiumInteractions;
        if (nested && typeof nested === 'object') {
            return nested;
        }

        const flat = payload?.premium_interactions ?? payload?.premiumInteractions;
        if (flat && typeof flat === 'object') {
            return flat;
        }

        return null;
    }

    _extractNumericValue(source, keys) {
        for (const key of keys) {
            const numeric = this._coerceNumber(source?.[key]);
            if (numeric !== null) {
                return numeric;
            }
        }

        return null;
    }

    _extractResetLabel(snapshot, payload) {
        const candidates = [
            snapshot?.quota_reset_date_utc,
            snapshot?.quota_reset_date,
            snapshot?.reset_date_utc,
            snapshot?.reset_date,
            payload?.quota_reset_date_utc,
            payload?.quota_reset_date,
        ];

        for (const candidate of candidates) {
            const formatted = this._formatResetDate(candidate);
            if (formatted !== '') {
                return formatted;
            }
        }

        return '—';
    }

    _extractPlanLabel(payload, snapshot) {
        const candidates = [
            payload?.copilot_plan,
            payload?.access_type_sku,
            snapshot?.plan,
            snapshot?.sku,
        ];

        for (const candidate of candidates) {
            if (typeof candidate !== 'string') {
                continue;
            }

            const trimmed = candidate.trim();
            if (trimmed !== '') {
                return trimmed;
            }
        }

        return null;
    }

    _coerceNumber(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === 'string') {
            const parsed = Number.parseFloat(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }

        return null;
    }

    _coerceBoolean(value) {
        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'string') {
            const lowered = value.trim().toLowerCase();
            if (lowered === 'true') {
                return true;
            }
            if (lowered === 'false') {
                return false;
            }
        }

        return false;
    }

    _formatResetDate(value) {
        const raw = String(value ?? '').trim();
        if (raw === '') {
            return '';
        }

        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
            const year = parsed.getUTCFullYear();
            const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
            const day = String(parsed.getUTCDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        const simpleDateMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        if (simpleDateMatch) {
            return simpleDateMatch[1];
        }

        return raw;
    }

    _formatCredits(value) {
        const numeric = this._coerceNumber(value);
        if (numeric === null) {
            return '—';
        }

        if (Number.isInteger(numeric)) {
            return `${numeric}`;
        }

        return `${numeric.toFixed(2)}`;
    }

    _setUnavailableState(label, detail) {
        this._hasQuotaProgressData = false;

        this._label.set_text(label);
        this._monthlyValue.set_text(detail);
        this._periodLabel.set_text('Reset: —');
        this._budgetValue.set_text('Unavailable');
        this._remainingLabel.set_text('Remaining: —');
        this._budgetNoteLabel.set_text('Source: /copilot_internal/user');

        this._updatePanelProgressBar(0);
        this._updateProgressBar(this._monthlyProgressBar, 0, false);
        this._updateProgressBar(this._budgetProgressBar, 0, true);
        this._updateDisplayMode();
    }

    _updatePanelProgressBar(percent) {
        const maxWidth = this._panelProgressBg.width > 0
            ? this._panelProgressBg.width
            : PANEL_PROGRESS_BAR_WIDTH;
        const width = Math.round((this._clampPercent(percent) / 100) * maxWidth);
        this._panelProgressBar.set_width(width);
    }

    _updateProgressBar(progressBar, percent, isRemaining) {
        const normalized = this._clampPercent(percent);
        const progressBg = progressBar.get_parent();
        const maxWidth = progressBg?.width > 0 ? progressBg.width : MENU_PROGRESS_BAR_WIDTH;
        const width = Math.round((normalized / 100) * maxWidth);
        progressBar.set_width(width);

        progressBar.remove_style_class_name('usage-low');
        progressBar.remove_style_class_name('usage-medium');
        progressBar.remove_style_class_name('usage-high');
        progressBar.remove_style_class_name('usage-critical');

        if (isRemaining) {
            if (normalized <= 10) {
                progressBar.add_style_class_name('usage-critical');
            } else if (normalized <= 30) {
                progressBar.add_style_class_name('usage-high');
            } else if (normalized <= 60) {
                progressBar.add_style_class_name('usage-medium');
            } else {
                progressBar.add_style_class_name('usage-low');
            }
            return;
        }

        if (normalized >= 90) {
            progressBar.add_style_class_name('usage-critical');
        } else if (normalized >= 70) {
            progressBar.add_style_class_name('usage-high');
        } else if (normalized >= 40) {
            progressBar.add_style_class_name('usage-medium');
        } else {
            progressBar.add_style_class_name('usage-low');
        }
    }

    _clampPercent(value) {
        const numeric = this._coerceNumber(value) ?? 0;
        return Math.min(100, Math.max(0, numeric));
    }

    _friendlyTokenError(detail) {
        const message = String(detail).toLowerCase();
        if (message.includes('no oauth token found')) {
            return 'Set API token in extension settings';
        }

        if (message.includes('no such file or directory') || message.includes('unable to execute gh')) {
            return 'Set API token or install gh';
        }

        if (message.includes('not logged') || message.includes('authentication')) {
            return 'Set API token or run gh auth login';
        }

        return 'Set API token or run gh auth login';
    }

    _friendlyApiError(statusCode) {
        if (statusCode === 401) {
            return this._isUsingManualToken()
                ? 'Invalid API token'
                : 'Set API token or run gh auth login';
        }

        if (statusCode === 403) {
            return 'Token is not allowed to read Copilot quota';
        }

        if (statusCode === 404) {
            return 'Copilot quota endpoint unavailable for this account';
        }

        if (statusCode && statusCode > 0) {
            return `HTTP ${statusCode}`;
        }

        return 'API error';
    }

    _setRefreshing(isRefreshing) {
        if (isRefreshing) {
            this._refreshLabel.set_text('Refreshing...');
            this._refreshButton.add_style_class_name('busy');
        } else {
            this._refreshLabel.set_text('Refresh');
            this._refreshButton.remove_style_class_name('busy');
        }
    }

    _updateLastCheckedLabel() {
        const now = GLib.DateTime.new_now_local();
        this._lastUpdatedLabel.set_text(`Checked: ${now.format('%H:%M:%S')}`);
    }

    _finishRefresh() {
        this._setRefreshing(false);
        this._updateLastCheckedLabel();
    }

    destroy() {
        this._stopTimer();
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        super.destroy();
    }
});

export default class CopilotUsageExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new CopilotUsageIndicator(
            this.path,
            this._settings,
            () => this.openPreferences()
        );
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
