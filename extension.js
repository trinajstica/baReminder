'use strict';

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Load reminders array from the settings JSON string.
 * Returns [] on parse error or empty string.
 */
function loadReminders(settings) {
    const raw = settings.get_string('reminders-json');
    if (!raw || raw.trim() === '') return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
        return [];
    }
}

/**
 * Save the reminders array back to settings as a JSON string.
 */
function saveReminders(settings, reminders) {
    settings.set_string('reminders-json', JSON.stringify(reminders));
}

/**
 * Format a Date object to a locale-aware short string for display in the panel
 * popup list (e.g. "14:30 – Buy milk").
 */
function formatReminderRow(reminder) {
    const dt = new Date(reminder.datetime);
    const hhmm = dt.toLocaleString('default', {
        hour: '2-digit', minute: '2-digit', hour12: false
    });
    const date = dt.toLocaleDateString('default', {
        day: '2-digit', month: '2-digit', year: '2-digit'
    });
    return `${date}  ${hhmm}  –  ${reminder.title}`;
}

/**
 * Play a sound file given by URI.
 * Returns the Gio.Subprocess so the caller can stop it, or null.
 */
function playSound(settings) {
    if (!settings.get_boolean('play-sound')) return null;
    const uri = settings.get_string('sound-file-path');
    try {
        const file = Gio.File.new_for_uri(uri);
        if (!file.query_exists(null)) return null;
        return Gio.Subprocess.new(
            ['gst-play-1.0', '--no-interactive', file.get_path()],
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
        );
    } catch (_e) {
        return null;
    }
}

// ─── Scheduler ──────────────────────────────────────────────────────────────

/**
 * Lightweight scheduler that polls every 15 s and fires callbacks
 * for reminders whose datetime has passed.
 */
class ReminderScheduler {
    constructor(extension) {
        this._extension = extension;
        this._timerId = null;
        this._firedIds = new Set();
    }

    start() {
        // Run immediately, then every 15 seconds.
        this._check();
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, 15, () => {
                this._check();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    stop() {
        if (this._timerId !== null) {
            GLib.Source.remove(this._timerId);
            this._timerId = null;
        }
    }

    /** Force a fresh check (e.g. after the reminders list changed). */
    refresh() {
        this._check();
    }

    _check() {
        const settings = this._extension.getSettings();
        const reminders = loadReminders(settings);
        const now = Date.now();
        let changed = false;

        for (const reminder of reminders) {
            if (!reminder.enabled) continue;
            if (reminder.fired) continue;
            if (this._firedIds.has(reminder.id)) continue;

            const dt = new Date(reminder.datetime).getTime();
            // Fire if we are within the 15 s polling window after the target.
            if (dt <= now && now - dt < 20_000) {
                this._firedIds.add(reminder.id);
                reminder.fired = true;
                changed = true;
                this._extension.showNotification(reminder);
            }
        }

        if (changed)
            saveReminders(settings, reminders);
    }
}

// ─── Panel button ────────────────────────────────────────────────────────────

const ReminderPanelButton = GObject.registerClass(
class ReminderPanelButton extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'baReminder', false);

        this._extension = extension;
        this._settings = extension.getSettings();

        // Panel icon
        this._icon = new St.Icon({
            icon_name: 'preferences-system-time-symbolic',
            style_class: 'system-status-icon barem-panel-icon',
        });
        this.add_child(this._icon);

        // Badge label (shows count of upcoming reminders today)
        this._badge = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'barem-badge',
        });
        this.add_child(this._badge);

        this._buildMenu();
        this._rowSignalIds = [];

        // Rebuild the list whenever the stored JSON changes.
        this._settingsChangedId = this._settings.connect(
            'changed::reminders-json',
            () => this._rebuildList()
        );

        // Rebuild the list every time the menu is opened (so past reminders
        // are immediately shown as struck-through without a re-login).
        this._menuOpenId = this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) this._rebuildList();
        });

        this._rebuildList();
    }

    _buildMenu() {
        // ── Header ──────────────────────────────────────────────────────
        const headerItem = new PopupMenu.PopupBaseMenuItem({
            can_focus: false, reactive: false,
        });
        const headerBox = new St.BoxLayout({
            vertical: false,
            style_class: 'barem-header-box',
            x_expand: true,
        });
        const titleLabel = new St.Label({
            text: _('Reminders'),
            style_class: 'barem-header-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(titleLabel);
        headerItem.add_child(headerBox);
        this.menu.addMenuItem(headerItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Scrollable list of reminders ────────────────────────────────
        this._listSection = new PopupMenu.PopupMenuSection();
        const scrollView = new St.ScrollView({
            style_class: 'barem-scroll',
            overlay_scrollbars: true,
        });
        scrollView.set_child(this._listSection.actor);
        const scrollItem = new PopupMenu.PopupBaseMenuItem({
            can_focus: false, reactive: false,
        });
        scrollItem.add_child(scrollView);
        this.menu.addMenuItem(scrollItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Open preferences button ─────────────────────────────────────
        const prefsItem = new PopupMenu.PopupMenuItem(_('Manage Reminders…'));
        prefsItem.connect('activate', () => {
            this._extension.openPreferences();
        });
        this.menu.addMenuItem(prefsItem);
    }

    _rebuildList() {
        if (this._rowSignalIds) {
            for (const [actor, id] of this._rowSignalIds) {
                if (actor && id) actor.disconnect(id);
            }
            this._rowSignalIds = [];
        }
        this._listSection.removeAll();

        const reminders = loadReminders(this._settings);
        const now = new Date();

        // Sort by datetime ascending
        reminders.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

        // Count reminders due today for the badge
        const todayEnd = new Date(now);
        todayEnd.setHours(23, 59, 59, 999);
        const todayCount = reminders.filter(r =>
            r.enabled && new Date(r.datetime) >= now && new Date(r.datetime) <= todayEnd
        ).length;

        this._badge.text = todayCount > 0 ? String(todayCount) : '';

        if (reminders.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem(
                _('No reminders yet. Click "Manage Reminders…"'), {
                    reactive: false,
                    style_class: 'barem-empty-label',
                }
            );
            this._listSection.addMenuItem(emptyItem);
            return;
        }

        for (const reminder of reminders) {
            const isFired = !!reminder.fired;
            const item = new PopupMenu.PopupBaseMenuItem({
                style_class: isFired ? 'barem-reminder-row-past' : 'barem-reminder-row',
            });

            const rowBox = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                style_class: 'barem-row-box',
            });

            // Enable/disable toggle dot
            const toggleBtn = new St.Button({
                style_class: reminder.enabled
                    ? 'barem-toggle barem-toggle-on'
                    : 'barem-toggle barem-toggle-off',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const toggleId = toggleBtn.connect('clicked', () => {
                reminder.enabled = !reminder.enabled;
                const all = loadReminders(this._settings);
                const idx = all.findIndex(r => r.id === reminder.id);
                if (idx !== -1) all[idx].enabled = reminder.enabled;
                saveReminders(this._settings, all);
                // scheduler refresh is triggered via settings-changed
            });
            this._rowSignalIds.push([toggleBtn, toggleId]);

            // Reminder text
            const textBox = new St.BoxLayout({ vertical: true, x_expand: true });
            const rowLabel = new St.Label({
                text: formatReminderRow(reminder),
                style_class: isFired ? 'barem-row-label-muted' : 'barem-row-label',
                x_expand: true,
            });
            textBox.add_child(rowLabel);

            if (reminder.message && reminder.message.trim() !== '') {
                const msgLabel = new St.Label({
                    text: reminder.message,
                    style_class: 'barem-row-message',
                    x_expand: true,
                });
                textBox.add_child(msgLabel);
            }

            // Delete button
            const delBtn = new St.Button({
                label: '✕',
                style_class: 'barem-delete-btn',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const deleteId = delBtn.connect('clicked', () => {
                const all = loadReminders(this._settings);
                saveReminders(
                    this._settings,
                    all.filter(r => r.id !== reminder.id)
                );
            });
            this._rowSignalIds.push([delBtn, deleteId]);

            rowBox.add_child(toggleBtn);
            rowBox.add_child(textBox);
            rowBox.add_child(delBtn);
            item.add_child(rowBox);
            this._listSection.addMenuItem(item);
        }
    }

    destroy() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._menuOpenId) {
            this.menu.disconnect(this._menuOpenId);
            this._menuOpenId = null;
        }
        super.destroy();
    }
});

// ─── Notification overlay ────────────────────────────────────────────────────

/**
 * Show a full-screen centred notification overlay with auto-close and manual
 * close button.
 */
function showReminderOverlay(reminder, settings) {
    const autoClose = settings.get_boolean('auto-close');
    const autoCloseSeconds = settings.get_int('auto-close-seconds');

    const soundProc = playSound(settings);

    const container = new St.BoxLayout({
        vertical: true,
        style_class: 'barem-notification-box',
        reactive: true,
    });

    const titleLabel = new St.Label({
        text: reminder.title,
        style_class: 'barem-notification-title',
    });
    container.add_child(titleLabel);

    if (reminder.message && reminder.message.trim() !== '') {
        const msgLabel = new St.Label({
            text: reminder.message,
            style_class: 'barem-notification-message',
        });
        container.add_child(msgLabel);
    }

    const closeBtn = new St.Button({
        label: _('Close'),
        style_class: 'barem-notification-close',
    });

    let countdown = null;
    let countdownLabel = null;

    if (autoClose) {
        countdownLabel = new St.Label({
            text: `(${autoCloseSeconds})`,
            style_class: 'barem-notification-countdown',
        });
        container.add_child(countdownLabel);
    }
    container.add_child(closeBtn);

    Main.uiGroup.add_child(container);

    // Centre on the primary monitor
    const monitor = Main.layoutManager.primaryMonitor;
    container.set_position(
        monitor.x + Math.floor((monitor.width - container.width) / 2),
        monitor.y + Math.floor((monitor.height - container.height) / 2)
    );

    let modalGrab = Main.pushModal(container);
    let timerId = null;
    let secondsLeft = autoCloseSeconds;

    function dismiss() {
        if (soundProc) {
            try { soundProc.force_exit(); } catch (_e) {}
        }
        if (timerId !== null) {
            GLib.Source.remove(timerId);
            timerId = null;
        }
        if (modalGrab) {
            Main.popModal(modalGrab);
            modalGrab = null;
        }
        if (container.get_parent()) {
            Main.uiGroup.remove_child(container);
        }
    }

    closeBtn.connect('clicked', dismiss);

    if (autoClose) {
        timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            secondsLeft--;
            if (countdownLabel && countdownLabel.get_parent()) {
                countdownLabel.text = `(${secondsLeft})`;
            }
            if (secondsLeft <= 0) {
                dismiss();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }
}

// ─── Extension entry point ───────────────────────────────────────────────────

export default class baReminderExtension extends Extension {
    enable() {
        this._panelButton = new ReminderPanelButton(this);
        Main.panel.addToStatusArea('baReminder', this._panelButton);

        this._scheduler = new ReminderScheduler(this);
        this._scheduler.start();

        // Refresh scheduler when reminders change
        this._settingsChangedId = this.getSettings().connect(
            'changed::reminders-json',
            () => this._scheduler.refresh()
        );
    }

    disable() {
        if (this._settingsChangedId) {
            this.getSettings().disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._scheduler) {
            this._scheduler.stop();
            this._scheduler = null;
        }
        if (this._panelButton) {
            this._panelButton.destroy();
            this._panelButton = null;
        }
    }

    /** Called by the scheduler when a reminder fires. */
    showNotification(reminder) {
        showReminderOverlay(reminder, this.getSettings());
    }
}
