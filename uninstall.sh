#!/usr/bin/env bash
# uninstall.sh – remove baReminder GNOME extension
set -euo pipefail

UUID="baReminder@barko.generacija.si"
INSTALL_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

# Disable the extension if it is installed
if command -v gnome-extensions &>/dev/null; then
    if gnome-extensions list 2>/dev/null | grep -q "^${UUID}$"; then
        echo "Disabling extension…"
        gnome-extensions disable "${UUID}" || true
    fi
fi

# Remove the installation directory
if [[ -d "${INSTALL_DIR}" ]]; then
    echo "Removing ${INSTALL_DIR}…"
    rm -rf "${INSTALL_DIR}"
    echo "Extension removed."
else
    echo "Extension is not installed (${INSTALL_DIR} does not exist)."
fi

echo ""
echo "For full effect, log out and log back in (Wayland)."
