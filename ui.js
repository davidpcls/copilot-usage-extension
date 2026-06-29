import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {TokenStore} from './auth.js';
import {GitHubApiClient} from './api.js';
import {normalizeQuotaData, formatCredits, clampPercent} from './quota.js';

const MIN_REFRESH_INTERVAL_SECONDS = 5;
const PANEL_PROGRESS_BAR_WIDTH = 50;
const MENU_PROGRESS_BAR_WIDTH = 240;

export const CopilotUsageIndicator = GObject.registerClass(
class CopilotUsageIndicator extends PanelMenu.Button {
    _init(extensionPath, settings, openPreferences) {
        super._init(0.0, 'Copilot Usage Indicator');

        this._extensionPath = extensionPath;
        this._settings = settings;
        this._openPreferences = openPreferences;

        this._apiClient = new GitHubApiClient();
        this._tokenStore = new TokenStore();

        this._isRefreshing = false;
        this._pendingRefresh = false;
        this._hasQuotaProgressData = false;

        this._migrateLegacyToken();

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
            } else if (key === 'show-percentage') {
                this._refreshUsage();
            }
        });

        this._refreshUsage();
        this._startTimer();
    }

    _migrateLegacyToken() {
        this._tokenStore.migrateFromSettings(this._settings);
    }

    _createMenu() {
        const usedBox = new St.BoxLayout({
            style_class: 'copilot-usage-section',
            vertical: true,
            x_expand: true,
        });
        const usedHeader = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style_class: 'copilot-section-header',
        });
        this._usedTitle = new St.Label({
            text: 'Used',
            style_class: 'copilot-section-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        usedHeader.add_child(this._usedTitle);
        this._usedValue = new St.Label({
            text: '...',
            style_class: 'copilot-value-label',
            x_align: Clutter.ActorAlign.END,
        });
        usedHeader.add_child(this._usedValue);
        usedBox.add_child(usedHeader);

        const usedProgressBg = new St.Widget({
            style_class: 'copilot-progress-bg',
            x_expand: true,
        });
        this._usedProgressBar = new St.Widget({
            style_class: 'copilot-progress-bar usage-low',
        });
        usedProgressBg.add_child(this._usedProgressBar);
        usedBox.add_child(usedProgressBg);

        this._resetLabel = new St.Label({
            text: 'Reset: ...',
            style_class: 'copilot-detail-label',
        });
        usedBox.add_child(this._resetLabel);

        const usedItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        usedItem.add_child(usedBox);
        this.menu.addMenuItem(usedItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const totalBox = new St.BoxLayout({
            style_class: 'copilot-usage-section',
            vertical: true,
            x_expand: true,
        });
        const totalHeader = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style_class: 'copilot-section-header',
        });
        this._totalTitle = new St.Label({
            text: 'Total',
            style_class: 'copilot-section-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        totalHeader.add_child(this._totalTitle);
        this._totalValue = new St.Label({
            text: '...',
            style_class: 'copilot-value-label',
            x_align: Clutter.ActorAlign.END,
        });
        totalHeader.add_child(this._totalValue);
        totalBox.add_child(totalHeader);

        const totalProgressBg = new St.Widget({
            style_class: 'copilot-progress-bg',
            x_expand: true,
        });
        this._remainingProgressBar = new St.Widget({
            style_class: 'copilot-progress-bar usage-low',
        });
        totalProgressBg.add_child(this._remainingProgressBar);
        totalBox.add_child(totalProgressBg);

        this._remainingLabel = new St.Label({
            text: 'Remaining: ...',
            style_class: 'copilot-detail-label',
        });
        totalBox.add_child(this._remainingLabel);

        this._quotaNoteLabel = new St.Label({
            text: 'Source: /copilot_internal/user',
            style_class: 'copilot-detail-label',
        });
        totalBox.add_child(this._quotaNoteLabel);

        const totalItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        totalItem.add_child(totalBox);
        this.menu.addMenuItem(totalItem);

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

    _startTimer() {
        const configuredInterval = this._settings.get_int('refresh-interval');
        const interval = Math.max(MIN_REFRESH_INTERVAL_SECONDS, configuredInterval);
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

    _refreshUsage() {
        if (this._isRefreshing) {
            this._pendingRefresh = true;
            return;
        }

        this._isRefreshing = true;
        this._setRefreshing(true);

        const tokenResult = this._tokenStore.getToken();
        if (tokenResult.errorCode !== null) {
            this._setUnavailableState('Auth', this._friendlyTokenError(tokenResult.errorCode));
            this._finishRefresh();
            return;
        }

        this._apiClient.fetchCopilotInternalUser(tokenResult.token, (error, usageData, statusCode, errorCode) => {
            if (error) {
                if (statusCode !== 404) {
                    const safeStatus = typeof statusCode === 'number' ? statusCode : 0;
                    const safeErrorCode = errorCode ?? 'unknown';
                    console.error(`Copilot Usage: /copilot_internal/user request failed (status=${safeStatus}, reason=${safeErrorCode})`);
                }
                this._setUnavailableState('Error', this._friendlyApiError(statusCode));
                this._finishRefresh();
                return;
            }

            this._applyUsageData(usageData);
            this._finishRefresh();
        });
    }

    _applyUsageData(payload) {
        const data = normalizeQuotaData(payload);

        const usedText = formatCredits(data.used);
        this._usedValue.set_text(`${usedText} used`);
        this._resetLabel.set_text(`Reset: ${data.resetLabel}`);

        if (data.unlimited) {
            this._hasQuotaProgressData = false;
            this._label.set_text(`${usedText} / Unlimited`);
            this._totalValue.set_text('Unlimited');
            this._remainingLabel.set_text('Remaining: Unlimited');
            this._quotaNoteLabel.set_text(data.planLabel ? `Plan: ${data.planLabel}` : 'Premium interactions are unlimited');
            this._updatePanelProgressBar(0);
            this._updateProgressBar(this._usedProgressBar, 0, false);
            this._updateProgressBar(this._remainingProgressBar, 0, true);
            this._updateDisplayMode();
            return;
        }

        if (data.hasFiniteQuota) {
            const showPercent = this._settings.get_boolean('show-percentage');
            const usedWithTotal = `${formatCredits(data.used)}/${formatCredits(data.entitlement)}`;
            const percentText = `${Math.round(data.percentUsed)}%`;

            this._hasQuotaProgressData = true;
            this._label.set_text(showPercent ? `${usedWithTotal} (${percentText})` : usedWithTotal);
            this._totalValue.set_text(`${formatCredits(data.entitlement)} total`);
            this._remainingLabel.set_text(`Remaining: ${formatCredits(data.remaining)}`);
            this._quotaNoteLabel.set_text(data.planLabel ? `Plan: ${data.planLabel}` : 'Source: /copilot_internal/user');
            this._updatePanelProgressBar(data.percentUsed);
            this._updateProgressBar(this._usedProgressBar, data.percentUsed, false);
            this._updateProgressBar(this._remainingProgressBar, data.percentRemaining, true);
        } else {
            this._hasQuotaProgressData = false;
            this._label.set_text(usedText);
            this._totalValue.set_text('Unavailable');
            this._remainingLabel.set_text('Remaining: —');
            this._quotaNoteLabel.set_text('Premium interactions quota unavailable');
            this._updatePanelProgressBar(0);
            this._updateProgressBar(this._usedProgressBar, 0, false);
            this._updateProgressBar(this._remainingProgressBar, 0, true);
        }

        this._updateDisplayMode();
    }

    _setUnavailableState(label, detail) {
        this._hasQuotaProgressData = false;

        this._label.set_text(label);
        this._usedValue.set_text(detail);
        this._resetLabel.set_text('Reset: —');
        this._totalValue.set_text('Unavailable');
        this._remainingLabel.set_text('Remaining: —');
        this._quotaNoteLabel.set_text('Source: /copilot_internal/user');

        this._updatePanelProgressBar(0);
        this._updateProgressBar(this._usedProgressBar, 0, false);
        this._updateProgressBar(this._remainingProgressBar, 0, true);
        this._updateDisplayMode();
    }

    _updatePanelProgressBar(percent) {
        const maxWidth = this._panelProgressBg.width > 0
            ? this._panelProgressBg.width
            : PANEL_PROGRESS_BAR_WIDTH;
        const width = Math.round((clampPercent(percent) / 100) * maxWidth);
        this._panelProgressBar.set_width(width);
    }

    _updateProgressBar(progressBar, percent, isRemaining) {
        const normalized = clampPercent(percent);
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

    _friendlyTokenError(errorCode) {
        if (errorCode === 'keyring-unavailable') {
            return 'Keyring unavailable. Unlock login keyring and set API token in settings';
        }

        return 'Set API token in settings';
    }

    _friendlyApiError(statusCode) {
        if (statusCode === 401) {
            return 'Invalid API token';
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

        return 'Network request failed';
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
        this._isRefreshing = false;

        if (this._pendingRefresh) {
            this._pendingRefresh = false;
            this._refreshUsage();
        }
    }

    destroy() {
        this._stopTimer();
        this._apiClient?.destroy();
        this._apiClient = null;

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        super.destroy();
    }
});
