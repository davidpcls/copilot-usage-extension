# Copilot Usage GNOME Extension

Display GitHub Copilot premium interactions usage in the GNOME Shell top panel.

> Derived from [claude-usage-extension](https://github.com/Haletran/claude-usage-extension) and [codex-usage-extension](https://github.com/kevinpita/codex-usage-extension).

## Features

- Fetches usage data from `GET https://api.github.com/copilot_internal/user`
- Shows used credits, remaining credits, reset date, and refresh time
- Supports finite and unlimited plans
- Supports panel display modes: text, progress bar, or both
- Stores GitHub token in login keyring (libsecret), not plaintext settings

Panel label combinations:
- `Show Token Quantities` ON + `Show Percentage` OFF -> `used/total`
- `Show Token Quantities` ON + `Show Percentage` ON -> `used/total (percent)`
- `Show Token Quantities` OFF + `Show Percentage` ON -> `percent`
- `Show Token Quantities` OFF + `Show Percentage` OFF -> `Copilot`

## Requirements

- GNOME Shell 45-51
- GitHub account with Copilot entitlement/quota available from `/copilot_internal/user`
- A GitHub token saved in extension preferences

## Repository Layout

The repository keeps runtime extension files at the root (GNOME extension convention), and developer tooling in `scripts/`.

```text
.
├── metadata.json
├── extension.js
├── prefs.js
├── ui.js
├── api.js
├── auth.js
├── quota.js
├── stylesheet.css
├── github-copilot-icon.svg
├── schemas/
│   └── org.gnome.shell.extensions.copilot-usage.gschema.xml
└── scripts/
    ├── deploy-local.sh
    ├── build-package.sh
    └── validate.sh
```

## Token Setup

Use a token that can read Copilot quota data from `/copilot_internal/user`.

1. Open `https://github.com/settings/tokens`.
2. Create a token (classic or fine-grained) with minimum required access.
3. Copy the raw token value.
4. Open extension preferences and paste it into `GitHub API Token`.

The extension stores the token in your login keyring with label `GNOME Extension: Copilot Usage API Token`.

## Development Workflow

From the repository root:

1. Validate metadata/schema:

   ```bash
   ./scripts/validate.sh
   ```

2. Deploy locally for live testing:

   ```bash
   ./scripts/deploy-local.sh
   ```

3. Build a distributable zip package:

   ```bash
   ./scripts/build-package.sh
   ```

The package is created at `dist/copilot-usage@davidpcls.shell-extension.zip`.

## Manual Install (without scripts)

```bash
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
install_dir="$data_home/gnome-shell/extensions/copilot-usage@davidpcls"

rm -rf "$install_dir"
mkdir -p "$install_dir/schemas"
cp metadata.json extension.js prefs.js ui.js api.js auth.js quota.js stylesheet.css github-copilot-icon.svg LICENSE "$install_dir"
cp schemas/org.gnome.shell.extensions.copilot-usage.gschema.xml "$install_dir/schemas"
glib-compile-schemas "$install_dir/schemas"
gnome-extensions enable copilot-usage@davidpcls
```

If GNOME Shell has not discovered the extension yet:
- X11: press `Alt+F2`, type `r`, press Enter
- Wayland: log out and log back in

## Packaging and Maintenance Notes

- Do not commit `schemas/gschemas.compiled` (generated file)
- Do not include development files (`.git/`, `.direnv/`, `dist/`) in extension packages
- Keep `metadata.json` `shell-version` aligned with tested GNOME Shell versions
- Keep legacy schema keys only when needed for safe upgrades in running sessions

## Troubleshooting

- `Auth` in panel: save a valid GitHub token in preferences
- `Keyring unavailable...`: unlock login keyring and save token again
- `Token is not allowed to read Copilot quota`: use a token/account allowed to access `/copilot_internal/user`
- `Copilot quota endpoint unavailable for this account`: entitlement/quota may not be exposed for this account
- Extension not found: reload GNOME Shell, then run `gnome-extensions enable copilot-usage@davidpcls`

## Disclaimer

This extension is not affiliated with, funded by, or associated with GitHub.
