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
        this._ghToken = null;
        this._hasBudgetData = false;

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
            }
        });

        this._refreshUsage();
        this._startTimer();
    }

    _updateDisplayMode() {
        const mode = this._settings.get_string('display-mode');
        const showLabel = mode !== 'bar' || !this._hasBudgetData;
        const showBar = (mode === 'bar' || mode === 'both') && this._hasBudgetData;

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
            text: 'This Month',
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
            text: 'Period: ...',
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
            text: 'Budget',
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
            text: '...',
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
        this._getGhToken((tokenError, token) => {
            if (tokenError) {
                console.error(`Copilot Usage: ${tokenError.message}`);
                this._setUnavailableState('Auth', this._friendlyTokenError(tokenError.message));
                this._finishRefresh();
                return;
            }

            this._fetchCurrentUser(token, (userError, login, userStatusCode) => {
                if (userError) {
                    if (this._shouldRetryAuth(allowAuthRetry, userStatusCode)) {
                        this._ghToken = null;
                        this._refreshUsage(false);
                        return;
                    }

                    console.error(`Copilot Usage: ${userError.message}`);
                    this._setUnavailableState('Error', this._friendlyApiError(userStatusCode));
                    this._finishRefresh();
                    return;
                }

                this._fetchUsageSummary(token, login, (usageError, usageData, usageStatusCode) => {
                    if (usageError) {
                        if (this._shouldRetryAuth(allowAuthRetry, usageStatusCode)) {
                            this._ghToken = null;
                            this._refreshUsage(false);
                            return;
                        }

                        console.error(`Copilot Usage: ${usageError.message}`);
                        this._setUnavailableState('Error', this._friendlyApiError(usageStatusCode));
                        this._finishRefresh();
                        return;
                    }

                    this._applyUsageData(usageData);
                    this._finishRefresh();
                });
            });
        });
    }

    _shouldRetryAuth(allowAuthRetry, statusCode) {
        return allowAuthRetry && statusCode === 401;
    }

    _getGhToken(callback) {
        if (this._ghToken && this._ghToken.length > 0) {
            callback(null, this._ghToken);
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
                const token = stdout.trim();

                if (!proc.get_successful() || token === '') {
                    const detail = stderr.trim() || 'GitHub CLI returned no token';
                    callback(new Error(detail), null);
                    return;
                }

                this._ghToken = token;
                callback(null, token);
            } catch (e) {
                callback(new Error(`Failed to read gh token: ${e.message}`), null);
            }
        });
    }

    _fetchCurrentUser(token, callback) {
        this._apiGetJson(`${GITHUB_API_ROOT}/user`, token, (error, data, statusCode) => {
            if (error) {
                callback(error, null, statusCode);
                return;
            }

            const login = data?.login;
            if (typeof login !== 'string' || login.trim() === '') {
                callback(new Error('GitHub API did not return a user login'), null, statusCode);
                return;
            }

            callback(null, login.trim(), statusCode);
        });
    }

    _fetchUsageSummary(token, login, callback) {
        const now = GLib.DateTime.new_now_local();
        const year = now.get_year();
        const month = now.get_month();
        const encodedLogin = GLib.uri_escape_string(login, null, false);

        const summaryUrl = `${GITHUB_API_ROOT}/users/${encodedLogin}/settings/billing/usage/summary?year=${year}&month=${month}&product=copilot`;
        this._apiGetJson(summaryUrl, token, (error, data, statusCode) => {
            if (!error) {
                callback(null, data, statusCode);
                return;
            }

            if (statusCode !== 404) {
                callback(error, null, statusCode);
                return;
            }

            const fallbackUrl = `${GITHUB_API_ROOT}/users/${encodedLogin}/settings/billing/usage?year=${year}&month=${month}&product=copilot`;
            this._apiGetJson(fallbackUrl, token, callback);
        });
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
        const data = this._normalizeUsageData(payload);

        const spentText = `${this._formatCurrency(data.spent)} spent`;
        this._monthlyValue.set_text(spentText);
        this._periodLabel.set_text(`Period: ${data.periodLabel}`);

        if (data.budget !== null && data.budget > 0) {
            const spentPercent = this._clampPercent((data.spent / data.budget) * 100);
            const remaining = Math.max(0, data.budget - data.spent);
            const remainingPercent = this._clampPercent((remaining / data.budget) * 100);

            this._hasBudgetData = true;
            this._label.set_text(`${Math.round(spentPercent)}%`);
            this._budgetValue.set_text(`${this._formatCurrency(data.budget)} budget`);
            this._remainingLabel.set_text(`Remaining: ${this._formatCurrency(remaining)}`);
            this._budgetNoteLabel.set_text('Budget from Copilot API');
            this._updatePanelProgressBar(spentPercent);
            this._updateProgressBar(this._monthlyProgressBar, spentPercent, false);
            this._updateProgressBar(this._budgetProgressBar, remainingPercent, true);
        } else {
            this._hasBudgetData = false;
            this._label.set_text(spentText);
            this._budgetValue.set_text('Unavailable');
            this._remainingLabel.set_text('Remaining: —');
            this._budgetNoteLabel.set_text('Budget unavailable from API');
            this._updatePanelProgressBar(0);
            this._updateProgressBar(this._monthlyProgressBar, 0, false);
            this._updateProgressBar(this._budgetProgressBar, 0, true);
        }

        this._updateDisplayMode();
    }

    _normalizeUsageData(payload) {
        const usageItems = this._extractUsageItems(payload);
        const copilotItems = this._extractCopilotItems(usageItems);

        let spent = this._sumNetAmount(copilotItems);
        if (spent === 0) {
            spent = this._coerceNumber(payload?.effective_budget?.consumed_amount) ?? 0;
        }

        const budget = this._extractBudget(payload, copilotItems);

        return {
            spent,
            budget,
            periodLabel: this._periodLabelFromPayload(payload),
        };
    }

    _extractUsageItems(payload) {
        const usageItems = payload?.usageItems;
        if (Array.isArray(usageItems)) {
            return usageItems;
        }

        const snakeCaseItems = payload?.usage_items;
        if (Array.isArray(snakeCaseItems)) {
            return snakeCaseItems;
        }

        return [];
    }

    _extractCopilotItems(items) {
        const explicitCopilotItems = items.filter(item => this._isCopilotItem(item));
        if (explicitCopilotItems.length > 0) {
            return explicitCopilotItems;
        }

        return items;
    }

    _isCopilotItem(item) {
        const product = String(item?.product ?? item?.product_name ?? '').toLowerCase();
        const sku = String(item?.sku ?? item?.product_sku ?? '').toLowerCase();

        return product.includes('copilot') || sku.includes('copilot');
    }

    _sumNetAmount(items) {
        return items.reduce((total, item) => {
            const amount = this._coerceNumber(item?.netAmount)
                ?? this._coerceNumber(item?.net_amount)
                ?? this._coerceNumber(item?.amount)
                ?? 0;
            return total + amount;
        }, 0);
    }

    _extractBudget(payload, items) {
        const candidates = [
            payload?.effective_budget?.budget_amount,
            payload?.effective_budget?.budgetAmount,
            payload?.budget?.amount,
            payload?.budget_amount,
            payload?.budgetAmount,
            items[0]?.budget_amount,
            items[0]?.budgetAmount,
            items[0]?.budget,
            items[0]?.limit,
        ];

        for (const candidate of candidates) {
            const numeric = this._coerceNumber(candidate);
            if (numeric !== null && numeric > 0) {
                return numeric;
            }
        }

        return null;
    }

    _periodLabelFromPayload(payload) {
        const timePeriod = payload?.timePeriod ?? payload?.time_period ?? null;
        if (timePeriod && timePeriod.year && timePeriod.month) {
            const year = Math.trunc(timePeriod.year);
            const month = String(Math.trunc(timePeriod.month)).padStart(2, '0');
            if (timePeriod.day) {
                const day = String(Math.trunc(timePeriod.day)).padStart(2, '0');
                return `${year}-${month}-${day}`;
            }
            return `${year}-${month}`;
        }

        const now = GLib.DateTime.new_now_local();
        const month = String(now.get_month()).padStart(2, '0');
        return `${now.get_year()}-${month}`;
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

    _setUnavailableState(label, detail) {
        this._hasBudgetData = false;

        this._label.set_text(label);
        this._monthlyValue.set_text(detail);
        this._periodLabel.set_text('Period: —');
        this._budgetValue.set_text('Unavailable');
        this._remainingLabel.set_text('Remaining: —');
        this._budgetNoteLabel.set_text('Budget unavailable from API');

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

    _formatCurrency(value) {
        const numeric = this._coerceNumber(value) ?? 0;
        return `$${numeric.toFixed(2)}`;
    }

    _friendlyTokenError(detail) {
        const message = String(detail).toLowerCase();
        if (message.includes('no such file or directory') || message.includes('unable to execute gh')) {
            return 'Install GitHub CLI (gh)';
        }

        if (message.includes('not logged') || message.includes('authentication')) {
            return 'Run gh auth login';
        }

        return 'Run gh auth login';
    }

    _friendlyApiError(statusCode) {
        if (statusCode === 401) {
            return 'Run gh auth login';
        }

        if (statusCode === 403) {
            return 'Token lacks billing access';
        }

        if (statusCode === 404) {
            return 'No Copilot billing data';
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
