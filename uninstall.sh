#!/usr/bin/env bash
# uninstall.sh – odstrani baReminder GNOME razširitev
set -euo pipefail

UUID="baReminder@barko.generacija.si"
INSTALL_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

# Onemogoči razširitev, če je nameščena
if command -v gnome-extensions &>/dev/null; then
    if gnome-extensions list 2>/dev/null | grep -q "^${UUID}$"; then
        echo "Onemogočam razširitev…"
        gnome-extensions disable "${UUID}" || true
    fi
fi

# Odstrani namestitveni direktorij
if [[ -d "${INSTALL_DIR}" ]]; then
    echo "Odstranjujem ${INSTALL_DIR}…"
    rm -rf "${INSTALL_DIR}"
    echo "Razširitev odstranjena."
else
    echo "Razširitev ni nameščena (${INSTALL_DIR} ne obstaja)."
fi

echo ""
echo "Za popolno uveljavitev se odjavite in prijavite (Wayland)."
