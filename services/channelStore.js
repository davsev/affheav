/**
 * Channel store — manages affiliation channel configs.
 * Each channel has: id, name, sheetName (Google Sheet tab).
 * Facebook tokens are stored separately under facebook_page_id_{id} and facebook_page_token_{id}.
 * Persisted to the Google Sheets Settings tab.
 */

const { getSetting, setSetting } = require('./googleSheets');

const DEFAULT_CHANNEL = { id: 'fishing', name: 'דיג', sheetName: 'fishing' };

let _channels = null;

async function load() {
  const raw = await getSetting('channels');
  _channels = raw ? JSON.parse(raw) : [DEFAULT_CHANNEL];
  return _channels;
}

async function save() {
  await setSetting('channels', JSON.stringify(_channels));
}

async function getAll() {
  if (!_channels) await load();
  return _channels;
}

async function getById(id) {
  const channels = await getAll();
  return channels.find(c => c.id === id) || null;
}

async function add({ name, sheetName }) {
  await getAll();
  // Derive a stable id from the sheetName
  const id = sheetName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  if (_channels.find(c => c.id === id)) {
    throw new Error(`Channel with id "${id}" already exists`);
  }
  const channel = { id, name, sheetName };
  _channels.push(channel);
  await save();
  return channel;
}

async function update(id, { name, sheetName }) {
  await getAll();
  const idx = _channels.findIndex(c => c.id === id);
  if (idx === -1) throw new Error(`Channel not found: ${id}`);
  if (name !== undefined) _channels[idx].name = name;
  if (sheetName !== undefined) _channels[idx].sheetName = sheetName;
  await save();
  return _channels[idx];
}

async function remove(id) {
  await getAll();
  const idx = _channels.findIndex(c => c.id === id);
  if (idx === -1) throw new Error(`Channel not found: ${id}`);
  _channels.splice(idx, 1);
  await save();
}

async function getFacebookConfig(channelId) {
  const pageId    = await getSetting(`facebook_page_id_${channelId}`);
  const pageToken = await getSetting(`facebook_page_token_${channelId}`);
  return {
    pageId:    pageId    || null,
    pageToken: pageToken || null,
    hasToken:  !!pageToken,
  };
}

async function setFacebookConfig(channelId, { pageId, pageToken }) {
  if (pageId    !== undefined) await setSetting(`facebook_page_id_${channelId}`,    pageId);
  if (pageToken !== undefined) await setSetting(`facebook_page_token_${channelId}`, pageToken);
}

// Invalidate in-memory cache (useful after external changes)
function invalidate() {
  _channels = null;
}

module.exports = { getAll, getById, add, update, remove, getFacebookConfig, setFacebookConfig, invalidate };
