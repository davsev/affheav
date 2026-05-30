/**
 * instanceManager.js
 *
 * Manages multiple WhatsApp Web JS instances (pools of phone clients).
 * Boots persisted phones on startup, exposes send/query API to workflow.js.
 */
const { query } = require('../../db');
const { PhoneClient } = require('./phoneClient');

class InstanceManager {
  constructor() {
    this._clients = new Map();   // phoneId → PhoneClient
    this._qrListeners = new Map(); // phoneId → Set<SSE-res>
    this._log = null;
  }

  setLogger(logFn) { this._log = logFn; }

  _emit(phoneId, msg, level = 'info') {
    if (this._log) this._log(msg, level);
    else console.log(`[WA ${phoneId}] ${msg}`);
  }

  /** Boot all phones from DB on server startup */
  async start() {
    const { rows } = await query(`
      SELECT p.*, i.user_id
      FROM   whatsapp_phones p
      JOIN   whatsapp_instances i ON i.id = p.instance_id
      ORDER  BY p.id
    `);

    await Promise.all(rows.map(row => this._bootPhone(row)));
    console.log(`[InstanceManager] Booted ${this._clients.size} phone(s)`);
  }

  async _bootPhone(row) {
    const client = new PhoneClient({
      phoneId:    row.id,
      instanceId: row.instance_id,
      onQr:       (id, qr) => this._broadcastQr(id, qr),
      onReady:    (id)     => this._notifyReady(id),
      onDisconnected: (id) => this._notifyDisconnected(id),
      onLog:      (msg, level) => this._emit(row.id, msg, level),
    });
    this._clients.set(row.id, client);

    try {
      await client.init();
    } catch (err) {
      this._emit(row.id, `Failed to init phone ${row.id}: ${err.message}`, 'error');
    }
  }

  // ── QR SSE ─────────────────────────────────────────────────────────────────

  subscribeQr(phoneId, res) {
    if (!this._qrListeners.has(phoneId)) {
      this._qrListeners.set(phoneId, new Set());
    }
    this._qrListeners.get(phoneId).add(res);
    res.on('close', () => this._qrListeners.get(phoneId)?.delete(res));
  }

  _broadcastQr(phoneId, qr) {
    const listeners = this._qrListeners.get(phoneId);
    if (!listeners) return;
    for (const res of listeners) {
      res.write(`data: ${JSON.stringify({ qr })}\n\n`);
    }
  }

  _notifyReady(phoneId) {
    const listeners = this._qrListeners.get(phoneId);
    if (!listeners) return;
    for (const res of listeners) {
      res.write(`data: ${JSON.stringify({ ready: true })}\n\n`);
      res.end();
    }
    listeners.clear();
  }

  _notifyDisconnected(phoneId) {}

  // ── Instance CRUD ──────────────────────────────────────────────────────────

  async createInstance(userId, { name, description }) {
    const { rows } = await query(
      `INSERT INTO whatsapp_instances (user_id, name, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [userId, name, description || null]
    );
    return rows[0];
  }

  async deleteInstance(instanceId) {
    const phones = await this._getInstancePhones(instanceId);
    await Promise.all(phones.map(p => this._destroyPhone(p.id)));
    await query(`DELETE FROM whatsapp_instances WHERE id = $1`, [instanceId]);
  }

  async listInstances(userId) {
    const { rows: instances } = await query(
      `SELECT * FROM whatsapp_instances WHERE user_id = $1 ORDER BY created_at`,
      [userId]
    );
    const { rows: phones } = await query(
      `SELECT p.* FROM whatsapp_phones p
       JOIN whatsapp_instances i ON i.id = p.instance_id
       WHERE i.user_id = $1
       ORDER BY p.id`,
      [userId]
    );

    return instances.map(inst => ({
      ...inst,
      phones: phones
        .filter(p => p.instance_id === inst.id)
        .map(p => this._phoneRow(p)),
    }));
  }

  // ── Phone CRUD ─────────────────────────────────────────────────────────────

  async addPhone(instanceId, { displayName } = {}) {
    const { rows } = await query(
      `INSERT INTO whatsapp_phones (instance_id, display_name, status)
       VALUES ($1, $2, 'pending_qr') RETURNING *`,
      [instanceId, displayName || null]
    );
    const row = rows[0];
    await this._bootPhone(row);
    return this._phoneRow(row);
  }

  async removePhone(phoneId) {
    await this._destroyPhone(phoneId);
    await query(`DELETE FROM whatsapp_phones WHERE id = $1`, [phoneId]);
  }

  async _destroyPhone(phoneId) {
    const client = this._clients.get(phoneId);
    if (client) {
      await client.destroy();
      this._clients.delete(phoneId);
    }
  }

  async reconnectPhone(phoneId) {
    const client = this._clients.get(phoneId);
    if (client) {
      await client.destroy();
      this._clients.delete(phoneId);
    }
    const { rows } = await query(`SELECT p.*, i.user_id FROM whatsapp_phones p JOIN whatsapp_instances i ON i.id = p.instance_id WHERE p.id = $1`, [phoneId]);
    if (rows[0]) await this._bootPhone(rows[0]);
  }

  async logoutPhone(phoneId) {
    const client = this._clients.get(phoneId);
    if (client) await client.logout();
  }

  getPhoneStatus(phoneId) {
    const client = this._clients.get(phoneId);
    if (!client) return 'unknown';
    return client.status || 'pending_qr';
  }

  async getPhoneGroups(phoneId) {
    const client = this._clients.get(phoneId);
    if (!client || !client.isConnected()) return [];
    return client.getGroups();
  }

  async _getInstancePhones(instanceId) {
    const { rows } = await query(`SELECT * FROM whatsapp_phones WHERE instance_id = $1`, [instanceId]);
    return rows;
  }

  _phoneRow(row) {
    return {
      id:           row.id,
      instanceId:   row.instance_id,
      displayName:  row.display_name,
      status:       this.getPhoneStatus(row.id),
      lastSeen:     row.last_seen,
      createdAt:    row.created_at,
    };
  }

  // ── Send API (used by workflow.js) ─────────────────────────────────────────

  /** Send to a WhatsApp group. Looks up which phone owns the group. */
  async sendToGroup(groupId, text, { imageUrl, videoUrl } = {}) {
    const client = await this._resolveClientForGroup(groupId);
    return client.sendMessage(groupId, text, { imageUrl, videoUrl });
  }

  /** Resolve the phone client assigned to a given whatsapp_group.id */
  async _resolveClientForGroup(waGroupDbId) {
    const { rows } = await query(
      `SELECT phone_id, wa_group FROM whatsapp_groups WHERE id = $1`,
      [waGroupDbId]
    );
    if (!rows.length) throw new Error(`WhatsApp group ${waGroupDbId} not found`);

    const { phone_id, wa_group } = rows[0];

    if (phone_id) {
      const client = this._clients.get(phone_id);
      if (client?.isConnected()) return { sendMessage: (gid, ...a) => client.sendMessage(wa_group, ...a) };
    }

    // Fallback: find any connected client
    for (const [, client] of this._clients) {
      if (client.isConnected()) {
        return { sendMessage: (gid, ...a) => client.sendMessage(wa_group, ...a) };
      }
    }

    throw new Error('No connected WhatsApp phone available');
  }

  /** Lower-level: send to a raw WhatsApp group JID via a specific phone */
  async sendViaPhone(phoneId, groupJid, text, opts = {}) {
    const client = this._clients.get(phoneId);
    if (!client) throw new Error(`Phone ${phoneId} not found`);
    return client.sendMessage(groupJid, text, opts);
  }

  /** Send to a raw WhatsApp group JID via any available connected phone (legacy fallback) */
  async sendToJid(groupJid, text, { imageUrl, videoUrl } = {}) {
    for (const [, client] of this._clients) {
      if (client.isConnected()) {
        return client.sendMessage(groupJid, text, { imageUrl, videoUrl });
      }
    }
    throw new Error('No connected WhatsApp phone available');
  }
}

module.exports = new InstanceManager();
