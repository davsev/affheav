const { google } = require('googleapis');
const path = require('path');
require('dotenv').config();

let sheetsClient = null;

async function getClient() {
  if (sheetsClient) return sheetsClient;

  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

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
  const sheets = await getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:G`,
    valueInputOption: 'RAW',
    requestBody: {
      // A: Link, B: '', C: image, D: '', E: Text, F: join_link, G: wa_group, H: sent, I: facebook
      values: [[Link, '', image, '', Text, join_link, wa_group, '', '']],
    },
  });
}

module.exports = { getAllProducts, getNextUnsent, markSent, addProduct, updateProductText };
