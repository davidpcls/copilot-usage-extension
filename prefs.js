import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {TokenStore} from './auth.js';

export default class CopilotUsagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const tokenStore = new TokenStore();

        const page = new Adw.PreferencesPage({
            title: 'Copilot Usage Settings',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const generalGroup = new Adw.PreferencesGroup({
            title: 'General',
            description: 'Configure the Copilot Usage extension',
        });
        page.add(generalGroup);

        const refreshRow = new Adw.SpinRow({
            title: 'Refresh Interval',
            subtitle: 'How often to refresh usage data (in seconds)',
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 600,
                step_increment: 10,
                page_increment: 60,
                value: settings.get_int('refresh-interval'),
            }),
        });
        settings.bind(
            'refresh-interval',
            refreshRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        generalGroup.add(refreshRow);

        const displayGroup = new Adw.PreferencesGroup({
            title: 'Panel Display',
            description: 'Configure how Copilot usage is shown in the top panel',
        });
        page.add(displayGroup);

        const displayModeRow = new Adw.ComboRow({
            title: 'Display Mode',
            subtitle: 'Show premium interactions as text, progress bar, or both when quota data is available',
        });

        const displayModeModel = new Gtk.StringList();
        displayModeModel.append('Text');
        displayModeModel.append('Progress Bar');
        displayModeModel.append('Both');
        displayModeRow.set_model(displayModeModel);

        const currentMode = settings.get_string('display-mode');
        const modeIndex = currentMode === 'bar' ? 1 : currentMode === 'both' ? 2 : 0;
        displayModeRow.set_selected(modeIndex);

        displayModeRow.connect('notify::selected', () => {
            const selected = displayModeRow.get_selected();
            const modes = ['text', 'bar', 'both'];
            settings.set_string('display-mode', modes[selected]);
        });

        displayGroup.add(displayModeRow);

        const iconStyleRow = new Adw.ComboRow({
            title: 'Icon Style',
            subtitle: 'Use a color or monochrome icon in the panel',
        });

        const iconStyleModel = new Gtk.StringList();
        iconStyleModel.append('Color');
        iconStyleModel.append('Monochrome');
        iconStyleRow.set_model(iconStyleModel);

        const currentStyle = settings.get_string('icon-style');
        iconStyleRow.set_selected(currentStyle === 'monochrome' ? 1 : 0);

        iconStyleRow.connect('notify::selected', () => {
            const selected = iconStyleRow.get_selected();
            settings.set_string('icon-style', selected === 1 ? 'monochrome' : 'color');
        });

        displayGroup.add(iconStyleRow);

        const showIconRow = new Adw.SwitchRow({
            title: 'Show Icon',
            subtitle: 'Display the Copilot icon in the top bar',
        });
        settings.bind(
            'show-icon',
            showIconRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        displayGroup.add(showIconRow);

        const showPercentageRow = new Adw.SwitchRow({
            title: 'Show Percentage',
            subtitle: 'Append used percentage next to used/total text when quota is finite',
        });
        settings.bind(
            'show-percentage',
            showPercentageRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        displayGroup.add(showPercentageRow);

        const authGroup = new Adw.PreferencesGroup({
            title: 'Authentication',
            description: 'Store your API token securely in the login keyring',
        });
        page.add(authGroup);

        const tokenRow = new Adw.EntryRow({
            title: 'GitHub API Token',
            show_apply_button: true,
        });
        tokenRow.set_input_purpose(Gtk.InputPurpose.PASSWORD);
        tokenRow.set_text('');

        const tokenStatusLabel = new Gtk.Label({
            xalign: 0,
            wrap: true,
            css_classes: ['dim-label', 'caption'],
            margin_start: 12,
            margin_top: 4,
        });

        const updateTokenStatus = (override = null) => {
            if (typeof override === 'string') {
                tokenStatusLabel.set_label(override);
                return;
            }

            tokenStatusLabel.set_label(tokenStore.hasStoredToken()
                ? 'Token stored in login keyring'
                : 'No token stored in login keyring');
        };

        tokenRow.connect('apply', () => {
            const value = tokenRow.get_text().trim();
            let success = false;
            try {
                if (value === '') {
                    tokenStore.clearToken();
                } else {
                    tokenStore.storeToken(value);
                }
                success = true;
            } catch (e) {
                updateTokenStatus('Failed to store token. Unlock login keyring and try again');
            }

            tokenRow.set_text('');
            if (success) {
                updateTokenStatus();
            }
        });
        updateTokenStatus();
        authGroup.add(tokenRow);
        authGroup.add(tokenStatusLabel);

        const clearTokenRow = new Adw.ActionRow({
            title: 'Clear Stored Token',
            subtitle: 'Remove token from your login keyring',
        });
        const clearTokenButton = new Gtk.Button({
            label: 'Clear',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        clearTokenButton.connect('clicked', () => {
            try {
                tokenStore.clearToken();
            } catch (e) {
                updateTokenStatus('Failed to clear token from keyring');
                return;
            }
            tokenRow.set_text('');
            updateTokenStatus();
        });
        clearTokenRow.add_suffix(clearTokenButton);
        authGroup.add(clearTokenRow);

        const authHint = new Gtk.Label({
            label: 'Token is stored in your login keyring (libsecret), not plaintext settings. Existing legacy tokens in settings are migrated automatically and then cleared.',
            xalign: 0,
            wrap: true,
            css_classes: ['dim-label', 'caption'],
            margin_start: 12,
            margin_top: 4,
        });
        authGroup.add(authHint);
    }
}
