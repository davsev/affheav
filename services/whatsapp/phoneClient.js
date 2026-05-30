const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { query } = require('../../db');

const RECONNECT_DELAY_BASE = 5000;
const RECONNECT_DELAY_MAX  = 60000;

class PhoneClient {
  constructor({ phoneId, instanceId, onQr, onReady, onDisconnected, onLog }) {
    this.phoneId     = phoneId;
    this.instanceId  = instanceId;
    this.onQr        = onQr        || (() => {});
    this.onReady     = onReady     || (() => {});
    this.onDisconnected = onDisconnected || (() => {});
    this.onLog       = onLog       || (() => {});
    this.client      = null;
    this.groups      = null;
    this._reconnectDelay = RECONNECT_DELAY_BASE;
    this._destroyed  = false;
  }

  async init() {
    this._destroyed = false;
    this._createClient();
    await this.client.initialize();
  }

  _createClient() {
    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: `phone-${this.phoneId}` }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      },
    });

    this.client.on('qr', async (qr) => {
      await this._setStatus('pending_qr');
      this.onQr(this.phoneId, qr);
    });

    this.client.on('ready', async () => {
      this._reconnectDelay = RECONNECT_DELAY_BASE;
      this.groups = null;
      await this._setStatus('connected');
      this.onReady(this.phoneId);
      this.onLog(`Phone ${this.phoneId} connected`, 'info');
    });

    this.client.on('disconnected', async (reason) => {
      await this._setStatus('disconnected');
      this.onLog(`Phone ${this.phoneId} disconnected: ${reason}`, 'warn');
      this.onDisconnected(this.phoneId, reason);
      if (!this._destroyed) {
        this._scheduleReconnect();
      }
    });

    this.client.on('auth_failure', async (msg) => {
      this.onLog(`Phone ${this.phoneId} auth failure: ${msg}`, 'error');
      await this._setStatus('disconnected');
    });
  }

  _scheduleReconnect() {
    setTimeout(async () => {
      if (this._destroyed) return;
      this.onLog(`Phone ${this.phoneId} reconnecting...`, 'info');
      try {
        this._createClient();
        await this.client.initialize();
      } catch (err) {
        this.onLog(`Phone ${this.phoneId} reconnect failed: ${err.message}`, 'error');
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_DELAY_MAX);
        this._scheduleReconnect();
      }
    }, this._reconnectDelay);

    this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_DELAY_MAX);
  }

  async destroy() {
    this._destroyed = true;
    if (this.client) {
      try { await this.client.destroy(); } catch {}
      this.client = null;
    }
  }

  async logout() {
    if (this.client) {
      try { await this.client.logout(); } catch {}
    }
    await this._setStatus('pending_qr');
  }

  isConnected() {
    return this.client?.info?.wid != null;
  }

  async getGroups() {
    if (this.groups) return this.groups;
    if (!this.isConnected()) return [];
    const chats = await this.client.getChats();
    this.groups = chats
      .filter(c => c.isGroup)
      .map(c => ({ id: c.id._serialized, name: c.name }));
    return this.groups;
  }

  async sendMessage(groupId, text, { imageUrl, videoUrl } = {}) {
    if (!this.isConnected()) throw new Error(`Phone ${this.phoneId} not connected`);

    let media = null;

    if (videoUrl) {
      try {
        media = await MessageMedia.fromUrl(videoUrl, { unsafeMime: true });
      } catch {}
    }

    if (!media && imageUrl) {
      try {
        media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
      } catch {}
    }

    const chat = await this.client.getChatById(groupId);
    if (!chat) throw new Error(`Group ${groupId} not found on phone ${this.phoneId}`);

    if (media) {
      await chat.sendMessage(media, { caption: text });
    } else {
      await chat.sendMessage(text);
    }

    return { success: true, chatName: chat.name };
  }

  async _setStatus(status) {
    this.status = status;
    try {
      await query(
        `UPDATE whatsapp_phones SET status = $1, last_seen = NOW(), updated_at = NOW() WHERE id = $2`,
        [status, this.phoneId]
      );
    } catch {}
  }
}

module.exports = { PhoneClient };
