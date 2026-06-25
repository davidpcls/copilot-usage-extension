# Copilot Usage GNOME Extension

Display GitHub Copilot usage in the GNOME Shell top panel.

> Derived from [claude-usage-extension](https://github.com/Haletran/claude-usage-extension) and [codex-usage-extension](https://github.com/kevinpita/codex-usage-extension).

## What It Shows

- Shows Copilot usage in the top panel
- Uses progress vs budget when budget data is available
- Falls back to explicit spent text when budget is unavailable (for example: `$12.34 spent`)
- Displays spent amount, budget status, period, and last refresh time in the dropdown
- Supports text, progress bar, or both
- Includes configurable refresh interval, icon style, and optional HTTP proxy

## Requirements

- GNOME Shell 46, 47, 48, 49, or 50
- GitHub CLI (`gh`) installed
- GitHub CLI authenticated with `gh auth login --hostname github.com`
- GitHub account with Copilot usage available through billing APIs

## Installation

### Quick Deploy

From the `copilot-usage-extension` directory:

```bash
./update
```

The script copies this extension to:

```text
~/.local/share/gnome-shell/extensions/copilot-usage@davidpcls
```

It then recompiles the GSettings schema and ends the current GNOME session with `gnome-session-quit --no-prompt`, so save your work first.

After logging back in, enable the extension if needed:

```bash
gnome-extensions enable copilot-usage@davidpcls
```

### Manual Installation

From the `copilot-usage-extension` directory:

```bash
install_dir="$HOME/.local/share/gnome-shell/extensions/copilot-usage@davidpcls"

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

- Authentication is read from your local GitHub CLI session via `gh auth token --hostname github.com`.
- Usage data is fetched from GitHub billing endpoints under `https://api.github.com/users/{username}/settings/billing/...`.
- If budget data is unavailable in API responses, the extension still shows spent value explicitly in panel and menu.

## Troubleshooting

- `Auth` in panel: install GitHub CLI and run `gh auth login --hostname github.com`.
- `Token lacks billing access`: authenticate with a token/account that can access billing usage endpoints.
- `No Copilot billing data`: your account may not expose Copilot usage via personal billing endpoints yet.

## Disclaimer

This extension is not affiliated with, funded by, or associated with GitHub.
