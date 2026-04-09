#!/usr/bin/env bash
# install.sh – compile schemas and install baReminder GNOME extension
# Supports GNOME 45+ (Wayland, ESM-based extensions)
set -euo pipefail

UUID="baReminder@barko.generacija.si"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

# ── Dependency checks ─────────────────────────────────────────────────────────
for cmd in glib-compile-schemas; do
    if ! command -v "${cmd}" &>/dev/null; then
        echo "ERROR: '${cmd}' not found. Install glib2-devel / libglib2.0-dev." >&2
        exit 1
    fi
done

# ── Compile GSettings schema ──────────────────────────────────────────────────
echo "Compiling GSettings schemas…"
glib-compile-schemas "${SRC_DIR}/schemas/"

# ── Create installation directory ────────────────────────────────────────────
echo "Installing to ${INSTALL_DIR}…"
mkdir -p "${INSTALL_DIR}"

# ── Copy extension files ──────────────────────────────────────────────────────
# Exclude development / VCS artefacts.
rsync -a \
    --exclude='.git/' \
    --exclude='.gitignore' \
    --exclude='install.sh' \
    --exclude='*.md' \
    --exclude='*.zip' \
    --exclude='node_modules/' \
    "${SRC_DIR}/" \
    "${INSTALL_DIR}/"

echo ""
echo "Extension installed successfully."
echo ""
echo "To activate it, run ONE of the following:"
echo "  • gnome-extensions enable ${UUID}"
echo "  • Or open 'Extensions' app and enable 'baReminder'"
echo ""
echo "If GNOME Shell is already running (Wayland), you must LOG OUT and back in"
echo "for the extension to load (Wayland does not support in-session restarts)."
echo ""

# Attempt to enable automatically if gnome-extensions is available.
if command -v gnome-extensions &>/dev/null; then
    if gnome-extensions list 2>/dev/null | grep -q "^${UUID}$"; then
        echo "Enabling extension automatically…"
        gnome-extensions enable "${UUID}" && echo "Enabled." || \
            echo "Could not enable automatically; please enable it manually."
    fi
fi
