# Copilot Usage GNOME Extension

Display GitHub Copilot usage in the GNOME Shell top panel.

> Derived from [claude-usage-extension](https://github.com/Haletran/claude-usage-extension) and [codex-usage-extension](https://github.com/kevinpita/codex-usage-extension).

## What It Shows

- Shows premium interactions usage in the top panel
- Uses Copilot quota data from `GET /copilot_internal/user`
- Displays used credits, total credits, remaining credits, reset date, and last refresh time in the dropdown
- Handles unlimited plans explicitly
- Supports text, progress bar, or both
- Includes configurable refresh interval, icon style, and optional HTTP proxy

## Requirements

- GNOME Shell 45, 46, 47, 48, 49, 50, or 51
- Either a GitHub API token entered in extension settings, or GitHub CLI (`gh`) installed and authenticated with `gh auth login --hostname github.com`
- GitHub account with Copilot access and quota data available from `/copilot_internal/user`

## Create a GitHub API token

Use a token that can read Copilot entitlement/quota data from `/copilot_internal/user`.

1. Open `https://github.com/settings/tokens`.
2. Click `Generate new token` -> `Generate new token (classic)`.
3. Give it a note like `GNOME Copilot Usage` and choose an expiration.
4. Start with minimal scopes and expand only if needed.
5. Click `Generate token`, then copy the token immediately.
6. Open this extension's preferences and paste it into `GitHub API Token`.

Tip: paste only the raw token value (for example `github_pat_...`), not `Bearer ...`.

If the extension shows `Token is not allowed to read Copilot quota`, create a token with appropriate Copilot/API access for your account.

## Installation

### Quick Deploy

From the `copilot-usage-extension` directory:

```bash
./update
```

The script copies this extension to:

```text
${XDG_DATA_HOME:-~/.local/share}/gnome-shell/extensions/copilot-usage@davidpcls
```

It recompiles the GSettings schema, then tries to discover and enable the extension automatically.

If GNOME Shell has not discovered it yet, reload Shell and then enable:

```bash
gnome-extensions enable copilot-usage@davidpcls
```

### Manual Installation

From the `copilot-usage-extension` directory:

```bash
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
install_dir="$data_home/gnome-shell/extensions/copilot-usage@davidpcls"

rm -rf "$install_dir"
mkdir -p "$(dirname "$install_dir")"
cp -rT "$PWD" "$install_dir"
glib-compile-schemas "$install_dir/schemas"
gnome-extensions enable copilot-usage@davidpcls
```

Reload GNOME Shell after installation:

- X11: press `Alt+F2`, type `r`, then press Enter
- Wayland: log out and log back in

## Notes

- If `GitHub API Token` is set in preferences, that token is used first.
- If token is empty, authentication is read from GitHub CLI credentials (`~/.config/gh/hosts.yml`, then `gh auth token`).
- Usage data is fetched only from `https://api.github.com/copilot_internal/user`.
- The extension reads `quota_snapshots.premium_interactions` and computes `used = entitlement - remaining`.
- If quota is unavailable in API responses, the extension falls back to limited status text.

## Troubleshooting

- `Auth` in panel: set a valid GitHub API token in extension settings, or install GitHub CLI and run `gh auth login --hostname github.com`.
- `Token is not allowed to read Copilot quota`: use a token/account with access to `/copilot_internal/user`.
- `Copilot quota endpoint unavailable for this account`: Copilot entitlement/quota may not be available for this account or host.
- `Extension ... does not exist`: reload GNOME Shell first (X11: `Alt+F2`, `r`; Wayland: log out/in), then run `gnome-extensions enable copilot-usage@davidpcls`.
- Extension still missing: ensure your GNOME Shell major version is listed in `metadata.json` under `shell-version`.

## Disclaimer

This extension is not affiliated with, funded by, or associated with GitHub.
