#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
extensions_dir="$data_home/gnome-shell/extensions"
uuid="copilot-usage@davidpcls"
target_dir="$extensions_dir/$uuid"

extension_files=(
	"metadata.json"
	"extension.js"
	"prefs.js"
	"ui.js"
	"api.js"
	"auth.js"
	"quota.js"
	"stylesheet.css"
	"github-copilot-icon.svg"
	"LICENSE"
)

schema_file="org.gnome.shell.extensions.copilot-usage.gschema.xml"

if [ "$repo_dir" = "$target_dir" ]; then
	echo "Refusing to deploy from the installed extension directory"
	exit 1
fi

mkdir -p "$extensions_dir"
rm -rf "$target_dir"

mkdir -p "$target_dir"
for file in "${extension_files[@]}"; do
	cp "$repo_dir/$file" "$target_dir/$file"
done

mkdir -p "$target_dir/schemas"
cp "$repo_dir/schemas/$schema_file" "$target_dir/schemas/$schema_file"
glib-compile-schemas "$target_dir/schemas"

# Backward compatibility for live GNOME Shell sessions that may still have
# old extension code loaded and expecting proxy-url in the schema.
gsettings set org.gnome.shell.extensions.copilot-usage proxy-url '' >/dev/null 2>&1 || true

if ! command -v gnome-extensions >/dev/null 2>&1; then
	echo "Installed extension to: $target_dir"
	echo "Enable with: gnome-extensions enable $uuid"
	exit 0
fi

shell_major=""
if command -v gnome-shell >/dev/null 2>&1; then
	if shell_version_output="$(gnome-shell --version 2>/dev/null)"; then
		if [[ "$shell_version_output" =~ ([0-9]+)\. ]]; then
			shell_major="${BASH_REMATCH[1]}"
		elif [[ "$shell_version_output" =~ ([0-9]+)$ ]]; then
			shell_major="${BASH_REMATCH[1]}"
		fi
	fi
fi

if [ -n "$shell_major" ] && ! grep -q "\"$shell_major\"" "$repo_dir/metadata.json"; then
	echo "Warning: metadata.json does not list GNOME Shell $shell_major in shell-version."
	echo "The extension may stay hidden until shell-version includes $shell_major."
fi

if ! gnome-extensions list >/dev/null 2>&1; then
	echo "Installed extension to: $target_dir"
	echo "Could not query GNOME Shell over D-Bus from this session."
	echo "Enable later with: gnome-extensions enable $uuid"
	exit 0
fi

known=0
for _ in {1..12}; do
	if gnome-extensions info "$uuid" >/dev/null 2>&1; then
		known=1
		break
	fi
	sleep 0.5
done

if [ "$known" -eq 1 ]; then
	was_enabled=0
	if gnome-extensions list --enabled | grep -qx "$uuid"; then
		was_enabled=1
		gnome-extensions disable "$uuid" || true
	fi

	if gnome-extensions enable "$uuid"; then
		if [ "$was_enabled" -eq 1 ]; then
			echo "Reloaded extension: $uuid"
		else
			echo "Enabled extension: $uuid"
		fi
	else
		echo "Installed extension, but automatic enable failed."
		echo "Try again after reloading GNOME Shell: gnome-extensions enable $uuid"
	fi
else
	echo "Installed extension to: $target_dir"
	echo "GNOME Shell has not discovered it yet."
	echo "Reload GNOME Shell, then run: gnome-extensions enable $uuid"
	echo "  - X11: Alt+F2, type r, press Enter"
	echo "  - Wayland: log out and log back in"
fi
