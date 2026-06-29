#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
schema_dir="$repo_dir/schemas"
metadata_file="$repo_dir/metadata.json"

echo "Validating GSettings schema..."
glib-compile-schemas --strict --dry-run "$schema_dir"

echo "Validating metadata.json..."
python3 -m json.tool "$metadata_file" >/dev/null

echo "Validation passed."
