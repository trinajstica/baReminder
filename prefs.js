'use strict';

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function saveReminders(settings, reminders) {
    settings.set_string('reminders-json', JSON.stringify(reminders));
}

function generateId() {
    return `rem_${GLib.get_real_time()}_${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Convert a JS Date to the string format required by Gtk.Entry for date/time:
 * GTK SpinButton friendly: "YYYY-MM-DD HH:MM"
 */
function dateToInputString(date) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function inputStringToDate(str) {
    // Accepts "YYYY-MM-DD HH:MM"
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!m) return null;
    const d = new Date(
        parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
        parseInt(m[4]), parseInt(m[5]), 0
    );
    return isNaN(d.getTime()) ? null : d;
}

// ─── Reminder row widget ──────────────────────────────────────────────────────

/**
 * A single row in the reminders list inside the prefs window.
 * Shows: enabled toggle | datetime | title | message | delete
 */
const ReminderRow = GObject.registerClass({
    Properties: {
        'reminder-id': GObject.ParamSpec.string(
            'reminder-id', '', '', GObject.ParamFlags.READWRITE, ''
        ),
    },
}, class ReminderRow extends Adw.ActionRow {
    _init(reminder, settings, onChanged) {
        super._init();

        this._reminderId = reminder.id;
        this._settings = settings;
        this._onChanged = onChanged;

        this.set_title(reminder.title || _('(no title)'));
        this.set_subtitle(
            new Date(reminder.datetime).toLocaleString('default', {
                dateStyle: 'medium', timeStyle: 'short'
            })
        );

        // Enable/disable switch on the left
        const enableSwitch = new Gtk.Switch({
            active: reminder.enabled,
            valign: Gtk.Align.CENTER,
        });
        enableSwitch.connect('state-set', (_sw, state) => {
            this._updateField('enabled', state);
            return false;
        });
        this.add_prefix(enableSwitch);

        // Delete button on the right
        const delBtn = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action', 'flat'],
            tooltip_text: _('Delete reminder'),
        });
        delBtn.connect('clicked', () => {
            const all = loadReminders(this._settings);
            saveReminders(
                this._settings,
                all.filter(r => r.id !== this._reminderId)
            );
            this._onChanged();
        });
        this.add_suffix(delBtn);
    }

    _updateField(field, value) {
        const all = loadReminders(this._settings);
        const idx = all.findIndex(r => r.id === this._reminderId);
        if (idx !== -1) {
            all[idx][field] = value;
            saveReminders(this._settings, all);
            this._onChanged();
        }
    }
});

// ─── "Add reminder" dialog ────────────────────────────────────────────────────

function buildAddDialog(parent, settings, onAdded) {
    const dialog = new Adw.Window({
        title: _('Add Reminder'),
        modal: true,
        transient_for: parent,
        default_width: 420,
        default_height: 460,
    });

    const toolbarView = new Adw.ToolbarView();
    const header = new Adw.HeaderBar();
    toolbarView.add_top_bar(header);

    const outerBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 0,
    });
    toolbarView.set_content(outerBox);
    dialog.set_content(toolbarView);

    const content = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({ title: _('New Reminder') });
    content.add(group);
    outerBox.append(content);

    // Title entry
    const titleRow = new Adw.EntryRow({
        title: _('Title'),
    });
    group.add(titleRow);

    // Message entry
    const messageRow = new Adw.EntryRow({
        title: _('Message (optional)'),
    });
    group.add(messageRow);

    // Date entry (YYYY-MM-DD)
    const dateRow = new Adw.EntryRow({
        title: _('Date (YYYY-MM-DD)'),
        text: dateToInputString(new Date()).split(' ')[0],
    });
    group.add(dateRow);

    // Time entry (HH:MM)
    const timeRow = new Adw.EntryRow({
        title: _('Time (HH:MM)'),
        text: dateToInputString(new Date()).split(' ')[1],
    });
    group.add(timeRow);

    // Error label
    const errorLabel = new Gtk.Label({
        label: '',
        css_classes: ['error'],
        xalign: 0,
        margin_start: 12,
        margin_bottom: 4,
    });

    // Add button
    const addBtn = new Gtk.Button({
        label: _('Add Reminder'),
        css_classes: ['suggested-action'],
        margin_start: 12,
        margin_end: 12,
        margin_bottom: 12,
    });

    const btnBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
    });
    btnBox.append(errorLabel);
    btnBox.append(addBtn);
    outerBox.append(btnBox);

    addBtn.connect('clicked', () => {
        const title = titleRow.get_text().trim();
        const dateStr = dateRow.get_text().trim();
        const timeStr = timeRow.get_text().trim();
        const message = messageRow.get_text().trim();

        if (!title) {
            errorLabel.set_label(_('Title is required.'));
            return;
        }

        const dt = inputStringToDate(`${dateStr} ${timeStr}`);
        if (!dt) {
            errorLabel.set_label(_('Invalid date or time format.'));
            return;
        }

        const reminder = {
            id: generateId(),
            title,
            datetime: dt.toISOString(),
            message,
            enabled: true,
        };

        const all = loadReminders(settings);
        all.push(reminder);
        saveReminders(settings, all);
        onAdded();
        dialog.close();
    });

    dialog.present();
}

// ─── Preferences window ───────────────────────────────────────────────────────

export default class baReminderPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.set_default_size(640, 600);

        // ── Reminders page ───────────────────────────────────────────────
        const remindersPage = new Adw.PreferencesPage({
            title: _('Reminders'),
            icon_name: 'preferences-system-time-symbolic',
        });
        window.add(remindersPage);

        const remindersGroup = new Adw.PreferencesGroup({
            title: _('Scheduled Reminders'),
            description: _('Add, enable/disable or delete reminders.'),
        });
        remindersPage.add(remindersGroup);

        const rebuildList = () => {
            // Remove all rows from the group and re-add them.
            // Adw.PreferencesGroup doesn't expose a clear() so we recreate it.
            // We instead rebuild just the children by using a separate inner group.
            this._rebuildReminderRows(remindersGroup, settings, rebuildList);
        };

        // Add reminder button in the group header
        const addBtn = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: _('Add new reminder'),
        });
        addBtn.connect('clicked', () => {
            buildAddDialog(window, settings, rebuildList);
        });
        remindersGroup.set_header_suffix(addBtn);

        rebuildList();

        // ── Settings page ────────────────────────────────────────────────
        const settingsPage = new Adw.PreferencesPage({
            title: _('Settings'),
            icon_name: 'preferences-other-symbolic',
        });
        window.add(settingsPage);

        // Sound group
        const soundGroup = new Adw.PreferencesGroup({ title: _('Sound') });
        settingsPage.add(soundGroup);

        const soundRow = new Adw.SwitchRow({
            title: _('Play sound on notification'),
        });
        settings.bind('play-sound', soundRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        soundGroup.add(soundRow);

        const soundFileRow = new Adw.ActionRow({
            title: _('Sound file'),
        });
        const chooseBtn = new Gtk.Button({
            label: this._soundLabel(settings),
            valign: Gtk.Align.CENTER,
        });
        chooseBtn.connect('clicked', () => {
            const chooser = new Gtk.FileDialog({
                title: _('Choose sound file'),
                modal: true,
            });
            chooser.open(window, null, (_dlg, result) => {
                try {
                    const file = chooser.open_finish(result);
                    if (file) {
                        settings.set_string('sound-file-path', file.get_uri());
                        chooseBtn.set_label(this._soundLabel(settings));
                    }
                } catch (_e) { /* cancelled */ }
            });
        });
        soundFileRow.add_suffix(chooseBtn);
        soundGroup.add(soundFileRow);

        // Notification group
        const notifGroup = new Adw.PreferencesGroup({ title: _('Notification') });
        settingsPage.add(notifGroup);

        const autoCloseRow = new Adw.SwitchRow({
            title: _('Auto-close notification'),
        });
        settings.bind('auto-close', autoCloseRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        notifGroup.add(autoCloseRow);

        const autoCloseSecondsRow = new Adw.SpinRow({
            title: _('Auto-close after (seconds)'),
            adjustment: new Gtk.Adjustment({
                lower: 3,
                upper: 60,
                step_increment: 1,
                value: settings.get_int('auto-close-seconds'),
            }),
        });
        settings.bind(
            'auto-close-seconds', autoCloseSecondsRow, 'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        notifGroup.add(autoCloseSecondsRow);
    }

    _soundLabel(settings) {
        const uri = settings.get_string('sound-file-path');
        const file = Gio.File.new_for_uri(uri);
        return file.get_basename() || _('None');
    }

    _rebuildReminderRows(group, settings, onChanged) {
        // Remove existing dynamic rows (class ReminderRow)
        // Adw.PreferencesGroup doesn't have a remove-all, so we maintain
        // a list ourselves.
        if (this._reminderRows) {
            for (const row of this._reminderRows) {
                group.remove(row);
            }
        }
        this._reminderRows = [];

        const reminders = loadReminders(settings);

        if (reminders.length === 0) {
            const emptyRow = new Adw.ActionRow({
                title: _('No reminders yet.'),
                subtitle: _('Click + to add your first reminder.'),
            });
            group.add(emptyRow);
            this._reminderRows.push(emptyRow);
            return;
        }

        // Sort by datetime
        reminders.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

        for (const reminder of reminders) {
            const row = new ReminderRow(reminder, settings, onChanged);
            group.add(row);
            this._reminderRows.push(row);
        }
    }
}
