#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

zip -r ../baReminder.zip \
    extension.js \
    prefs.js \
    metadata.json \
    stylesheet.css \
    schemas/*.gschema.xml

echo "Created: $(realpath ../baReminder.zip)"
