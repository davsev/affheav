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

// Actual column order in sheet (A–I):
// A: Link, B: image(short), C: image(cdn), D: empty, E: Text, F: join_link, G: wa_group, H: sent, I: facebook
const COL = {
  Link: 0,
  image: 2,      // C — direct CDN image URL
  Text: 4,       // E — product title
  join_link: 5,  // F
  wa_group: 6,   // G
  sent: 7,       // H
  facebook: 8,   // I
};

async function getAllProducts() {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2:I`,
  });

  const rows = res.data.values || [];
  return rows
    .map((row, idx) => ({
      row_number: idx + 2,
      Link: row[COL.Link] || '',
      image: row[COL.image] || '',
      Text: row[COL.Text] || '',
      join_link: row[COL.join_link] || '',
      wa_group: row[COL.wa_group] || '',
      sent: row[COL.sent] || '',
      facebook: row[COL.facebook] || '',
    }))
    .filter(p => p.Link); // skip empty rows
}

async function getNextUnsent() {
  const products = await getAllProducts();
  return products.find(p => !p.sent) || null;
}

async function markSent(link, { sentAt, facebookAt } = {}) {
  const products = await getAllProducts();
  const product = products.find(p => p.Link === link);
  if (!product) throw new Error(`Product not found: ${link}`);

  const sheets = await getClient();
  const rowRange = `${SHEET_NAME}!H${product.row_number}:I${product.row_number}`;

  // Preserve existing value if new value is null (platform was skipped)
  const newSentAt    = sentAt    !== null ? (sentAt    || product.sent    || new Date().toISOString()) : product.sent;
  const newFacebookAt = facebookAt !== null ? (facebookAt || product.facebook || '') : product.facebook;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: rowRange,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[newSentAt, newFacebookAt]],
    },
  });
}

async function updateProductLink(rowNumber, newLink) {
  const sheets = await getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A${rowNumber}`,
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

async function addProduct({ Link, image, Text, join_link, wa_group }) {
  const shortLink = await shortenUrl(Link);
  const sheets = await getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:G`,
    valueInputOption: 'RAW',
    requestBody: {
      // A: Link, B: '', C: image, D: '', E: Text, F: join_link, G: wa_group, H: sent, I: facebook
      values: [[shortLink, '', image, '', Text, join_link, wa_group, '', '']],
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

module.exports = { getAllProducts, getNextUnsent, markSent, addProduct, updateProductText, updateProductLink, getSetting, setSetting, moveRow };
