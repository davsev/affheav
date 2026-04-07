const { google } = require('googleapis');
const path = require('path');
const { shortenUrl } = require('./spooMe');
require('dotenv').config();

let sheetsClient = null;

async function getClient() {
  if (sheetsClient) return sheetsClient;

  const authConfig = { scopes: ['https://www.googleapis.com/auth/spreadsheets'] };

  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    authConfig.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  } else {
    authConfig.keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  const auth = new google.auth.GoogleAuth(authConfig);
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'fishing';

// Actual column order in sheet (A–L):
// A: long_url, B: Link (spoo.me), C: image, D: empty, E: Text, F: join_link, G: wa_group, H: sent, I: facebook, J: clicks, K: subject, L: instagram
const COL = {
  long_url: 0,    // A — original affiliate URL
  Link: 1,        // B — spoo.me short link
  image: 2,       // C — product image URL
  Text: 4,        // E — product title
  join_link: 5,   // F
  wa_group: 6,    // G
  sent: 7,        // H
  facebook: 8,    // I
  clicks: 9,      // J — spoo.me click count (synced on demand)
  subject: 10,    // K — subject/niche identifier
  instagram: 11,  // L — instagram post timestamp
};

async function getAllProducts({ subject, waGroupName, includeAll } = {}) {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2:L`,
  });

  const rows = res.data.values || [];
  const mapped = rows
    .map((row, idx) => ({
      row_number: idx + 2,
      long_url: row[COL.long_url] || '',
      Link: row[COL.Link] || '',
      image: row[COL.image] || '',
      Text: row[COL.Text] || '',
      join_link: row[COL.join_link] || '',
      wa_group: row[COL.wa_group] || '',
      sent: row[COL.sent] || '',
      facebook: row[COL.facebook] || '',
      clicks: row[COL.clicks] !== undefined && row[COL.clicks] !== '' ? parseInt(row[COL.clicks]) : null,
      subject: row[COL.subject] || '',
      instagram: row[COL.instagram] || '',
    }));

  // When includeAll=true (e.g. shorten-all) we keep every row that has at least a long_url or Link.
  // Otherwise only show products that already have a spoo.me short link.
  const products = includeAll
    ? mapped.filter(p => p.long_url || p.Link)
    : mapped.filter(p => p.Link && p.Link.startsWith('https://spoo.me/')); // only show products with a spoo.me link

  if (subject !== undefined && subject !== null && subject !== '') {
    return products.filter(p =>
      p.subject === subject ||
      (waGroupName && p.wa_group === waGroupName)
    );
  }
  return products;
}

async function getNextUnsent({ subject } = {}) {
  const products = await getAllProducts({ subject });
  return products.find(p => !p.sent) || null;
}

async function markSent(link, { sentAt, facebookAt, instagramAt } = {}) {
  const products = await getAllProducts();
  const product = products.find(p => p.Link === link);
  if (!product) throw new Error(`Product not found: ${link}`);

  const sheets = await getClient();
  const rowRange = `${SHEET_NAME}!H${product.row_number}:L${product.row_number}`;

  // Preserve existing value if new value is null (platform was skipped)
  const newSentAt      = sentAt      !== null ? (sentAt      || product.sent      || new Date().toISOString()) : product.sent;
  const newFacebookAt  = facebookAt  !== null ? (facebookAt  || product.facebook  || '') : product.facebook;
  const newInstagramAt = instagramAt !== null ? (instagramAt || product.instagram || '') : product.instagram;

  // Columns H=sent, I=facebook, J=clicks (don't overwrite), K=subject (don't overwrite), L=instagram
  // We skip J and K by reading their current values
  const clicksVal  = product.clicks  !== null ? String(product.clicks) : '';
  const subjectVal = product.subject || '';

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: rowRange,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[newSentAt, newFacebookAt, clicksVal, subjectVal, newInstagramAt]],
    },
  });
}

async function updateProductLink(rowNumber, newLink) {
  const sheets = await getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!B${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[newLink]] },
  });
}

async function updateProductText(link, text) {
  const products = await getAllProducts();
  const product = products.find(p => p.Link === link);
  if (!product) throw new Error(`Product not found: ${link}`);

  const sheets = await getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!E${product.row_number}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[text]] },
  });
}

async function addProduct({ Link, image, Text, join_link, wa_group, subject = '' }) {
  const shortLink = await shortenUrl(Link);
  const sheets = await getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:K`,
    valueInputOption: 'RAW',
    requestBody: {
      // A: long_url, B: Link (spoo.me), C: image, D: '', E: Text, F: join_link, G: wa_group, H: sent, I: facebook, J: clicks, K: subject
      values: [[Link, shortLink, image, '', Text, join_link, wa_group, '', '', '', subject]],
    },
  });
}

const SETTINGS_SHEET = 'Settings';

async function getSetting(key) {
  try {
    const sheets = await getClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SETTINGS_SHEET}!A:B`,
    });
    const rows = res.data.values || [];
    const row = rows.find(r => r[0] === key);
    return row ? row[1] : null;
  } catch {
    return null;
  }
}

async function setSetting(key, value) {
  const sheets = await getClient();
  // Read existing to find row or append
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SETTINGS_SHEET}!A:B`,
  });
  const rows = res.data.values || [];
  const rowIdx = rows.findIndex(r => r[0] === key);

  if (rowIdx >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SETTINGS_SHEET}!A${rowIdx + 1}:B${rowIdx + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[key, value]] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SETTINGS_SHEET}!A:B`,
      valueInputOption: 'RAW',
      requestBody: { values: [[key, value]] },
    });
  }
}

// Move a row from one position to another (1-based row numbers including header)
async function moveRow(fromRowNumber, toRowNumber) {
  const sheets = await getClient();

  // Get the sheet (tab) ID
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found`);
  const sheetId = sheet.properties.sheetId;

  // Convert 1-based row numbers to 0-based indices
  const sourceIndex = fromRowNumber - 1;
  const destIndex   = toRowNumber - 1;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        moveDimension: {
          source: {
            sheetId,
            dimension: 'ROWS',
            startIndex: sourceIndex,
            endIndex:   sourceIndex + 1,
          },
          destinationIndex: destIndex,
        },
      }],
    },
  });
}

// Sync click counts from spoo.me into Column J for all matching products
async function syncClicks(clicksMap) {
  const products = await getAllProducts();
  const sheets = await getClient();

  const data = products
    .filter(p => p.Link && clicksMap[p.Link] !== undefined)
    .map(p => ({
      range: `${SHEET_NAME}!J${p.row_number}`,
      values: [[clicksMap[p.Link]]],
    }));

  if (!data.length) return 0;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });

  return data.length;
}

// ── Subjects ──────────────────────────────────────────────────────────────────
// Subjects are stored in Settings sheet under key "subjects" as JSON array:
// [{ id, name, whatsappUrl, facebookPageId, facebookToken, facebookAppId, facebookAppSecret }]

async function getSubjects() {
  try {
    const raw = await getSetting('subjects');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveSubjects(subjects) {
  await setSetting('subjects', JSON.stringify(subjects));
}

module.exports = { getAllProducts, getNextUnsent, markSent, addProduct, updateProductText, updateProductLink, getSetting, setSetting, moveRow, syncClicks, getSubjects, saveSubjects };
