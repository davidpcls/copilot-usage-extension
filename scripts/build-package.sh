#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
dist_dir="$repo_dir/dist"
uuid="copilot-usage@davidpcls"
staging_dir="$dist_dir/$uuid"
archive_path="$dist_dir/$uuid.shell-extension.zip"

runtime_files=(
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

if ! command -v zip >/dev/null 2>&1; then
    echo "Missing required tool: zip"
    exit 1
fi

rm -rf "$staging_dir"
mkdir -p "$staging_dir/schemas"

for file in "${runtime_files[@]}"; do
    cp "$repo_dir/$file" "$staging_dir/$file"
done

cp "$repo_dir/schemas/$schema_file" "$staging_dir/schemas/$schema_file"
glib-compile-schemas "$staging_dir/schemas"

rm -f "$archive_path"
(
    cd "$staging_dir"
    zip -qr "$archive_path" .
)

echo "Created package: $archive_path"
