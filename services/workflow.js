const googleSheets = require('./googleSheets');
const openai = require('./openai');
const whatsapp = require('./whatsapp');
const facebook = require('./facebook');

// Global log emitter — set by server.js so routes/scheduler can share it
let _emit = null;
function setEmitter(fn) { _emit = fn; }

function log(msg, level = 'info') {
  const entry = { ts: new Date().toISOString(), level, msg };
  console.log(`[${level.toUpperCase()}] ${msg}`);
  if (_emit) _emit(entry);
}

/**
 * Run one full product send cycle:
 * 1. Get next unsent product from Google Sheets
 * 2. Generate Hebrew message via OpenAI
 * 3. Send to WhatsApp via MacroDroid
 * 4. Post to Facebook page
 * 5. Mark row as sent in Google Sheets
 *
 * @param {object} [overrideProduct] - If provided, use this product instead of fetching next unsent
 */
async function run(overrideProduct = null, { platforms = ['whatsapp', 'facebook'] } = {}) {
  const sendWA = platforms.includes('whatsapp');
  const sendFB = platforms.includes('facebook');
  log('▶ Workflow started');

  // Step 1: Get product
  let product;
  if (overrideProduct) {
    product = overrideProduct;
    log(`Using provided product: ${product.Text}`);
  } else {
    log('Fetching next unsent product from Google Sheets...');
    product = await googleSheets.getNextUnsent();
    if (!product) {
      log('No unsent products found. Workflow complete.', 'warn');
      return { success: false, reason: 'no_unsent_products' };
    }
    log(`Found product: "${product.Text}" → ${product.Link}`);
  }

  // Step 2: Generate message (or reuse saved Hebrew message)
  const isHebrew = /[\u05D0-\u05EA]/.test(product.Text);
  let message;
  if (isHebrew && product.Text.includes(product.Link)) {
    message = product.Text;
    log(`Using saved Hebrew message (${message.length} chars)`);
  } else if (isHebrew) {
    // Saved Hebrew text exists but link is missing — append it
    message = `${product.Text}\n\nקישור למוצר:\n${product.Link}\n\nקישור להצטרפות לקבוצה:\n${product.join_link}`;
    log(`Using saved Hebrew message + appended links (${message.length} chars)`);
  } else {
    log('Generating Hebrew marketing message via OpenAI...');
    message = await openai.generateMessage({
      Text: product.Text,
      Link: product.Link,
      join_link: product.join_link,
    });
    log(`Message generated (${message.length} chars)`);
    // Save generated message back to sheet so resends don't regenerate
    try {
      await googleSheets.updateProductText(product.Link, message);
      log('✓ Generated message saved to sheet');
    } catch (err) {
      log(`⚠ Could not save message to sheet: ${err.message}`, 'warn');
    }
  }

  const results = { product, message, whatsapp: null, facebook: null };

  // Step 3: WhatsApp
  if (sendWA) {
    try {
      log(`Sending to WhatsApp group: ${product.wa_group}`);
      const waResult = await whatsapp.send({
        text: message,
        image: product.image,
        wa_group: product.wa_group,
      });
      results.whatsapp = waResult;
      if (waResult.success) {
        log('✓ WhatsApp message sent successfully');
      } else {
        log(`⚠ WhatsApp response not OK: ${JSON.stringify(waResult.raw)}`, 'warn');
      }
    } catch (err) {
      log(`✗ WhatsApp failed: ${err.message}`, 'error');
      results.whatsapp = { success: false, error: err.message };
    }
  } else {
    log('⏭ WhatsApp skipped');
  }

  // Step 4: Facebook
  if (sendFB) {
    try {
      log('Posting to Facebook page...');
      const fbResult = await facebook.postPhoto({
        message,
        imageUrl: product.image,
      });
      results.facebook = fbResult;
      log(`✓ Facebook post published (id: ${fbResult.data?.post_id || fbResult.data?.id})`);
    } catch (err) {
      log(`✗ Facebook failed: ${err.message}`, 'error');
      results.facebook = { success: false, error: err.message };
    }
  } else {
    log('⏭ Facebook skipped');
  }

  // Step 5: Mark sent
  try {
    // null = platform was skipped (preserve existing value), '' = tried but failed
    const sentAt    = !sendWA ? null : (results.whatsapp?.success  ? new Date().toISOString() : '');
    const facebookAt = !sendFB ? null : (results.facebook?.success ? new Date().toISOString() : '');
    await googleSheets.markSent(product.Link, { sentAt, facebookAt });
    log('✓ Google Sheet updated');
  } catch (err) {
    log(`✗ Failed to update Google Sheet: ${err.message}`, 'error');
  }

  log('■ Workflow complete');
  return { success: true, results };
}

module.exports = { run, setEmitter, log };
