const { query } = require('../db');
const openai = require('./openai');
const whatsapp = require('./whatsapp');
const facebook = require('./facebook');
const instagram = require('./instagram');

// Resolve subject config (credentials) from Postgres
async function resolveSubjectConfig(subjectId, userId) {
  if (!subjectId || !userId) return null;
  try {
    const { rows } = await query(
      'SELECT * FROM subjects WHERE id = $1 AND user_id = $2',
      [subjectId, userId]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      name:               r.name,
      whatsappUrl:        r.macrodroid_url       || '',
      facebookPageId:     r.facebook_page_id     || '',
      facebookToken:      r.facebook_token       || '',
      facebookAppId:      r.facebook_app_id      || '',
      facebookAppSecret:  r.facebook_app_secret  || '',
      instagramAccountId: r.instagram_account_id || '',
      prompt:             r.openai_prompt        || '',
      waEnabled:          r.wa_enabled,
      fbEnabled:          r.fb_enabled,
      instagramEnabled:   r.instagram_enabled,
      waGroupName:        r.wa_group             || '',
    };
  } catch {
    return null;
  }
}

// Get next unsent product for a user (optionally filtered by subjectId)
async function getNextUnsent({ userId, subjectId } = {}) {
  let rows;
  if (subjectId) {
    ({ rows } = await query(
      `SELECT * FROM products
       WHERE user_id = $1 AND subject_id = $2
         AND sent_at IS NULL AND short_link IS NOT NULL AND short_link != ''
       ORDER BY sort_order ASC NULLS LAST, created_at ASC
       LIMIT 1`,
      [userId, subjectId]
    ));
  } else {
    ({ rows } = await query(
      `SELECT * FROM products
       WHERE user_id = $1
         AND sent_at IS NULL AND short_link IS NOT NULL AND short_link != ''
       ORDER BY sort_order ASC NULLS LAST, created_at ASC
       LIMIT 1`,
      [userId]
    ));
  }
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id:        r.id,
    long_url:  r.long_url    || '',
    Link:      r.short_link  || '',
    image:     r.image       || '',
    Text:      r.text        || '',
    join_link: r.join_link   || '',
    wa_group:  r.wa_group    || '',
    sent:      r.sent_at     ? new Date(r.sent_at).toISOString() : '',
    subject:   r.subject_id  || '',
    clicks:    r.clicks      ?? null,
  };
}

// Mark product as sent in Postgres
async function markSent(productId, { sentAt, facebookAt, instagramAt } = {}) {
  const updates = [];
  const values  = [];
  let i = 1;

  // null = platform was skipped (preserve existing), '' or value = update
  if (sentAt !== null) {
    updates.push(`sent_at = $${i++}`);
    values.push(sentAt ? new Date(sentAt) : new Date());
  }
  if (facebookAt !== null) {
    updates.push(`facebook_at = $${i++}`);
    values.push(facebookAt ? new Date(facebookAt) : null);
  }
  if (instagramAt !== null) {
    updates.push(`instagram_at = $${i++}`);
    values.push(instagramAt ? new Date(instagramAt) : null);
  }
  if (!updates.length) return;
  updates.push(`updated_at = NOW()`);
  values.push(productId);

  await query(`UPDATE products SET ${updates.join(', ')} WHERE id = $${i}`, values);
}

// Save generated message back to product
async function updateProductText(productId, text) {
  await query('UPDATE products SET text = $1, updated_at = NOW() WHERE id = $2', [text, productId]);
}

// Global log emitter — set by server.js
let _emit = null;
function setEmitter(fn) { _emit = fn; }

function log(msg, level = 'info') {
  const entry = { ts: new Date().toISOString(), level, msg };
  console.log(`[${level.toUpperCase()}] ${msg}`);
  if (_emit) _emit(entry);
}

/**
 * Run one full product send cycle.
 *
 * @param {object} [overrideProduct] - If provided, use this product instead of fetching next unsent
 * @param {object} [opts]
 * @param {string[]} [opts.platforms]  - Which platforms to send to
 * @param {string}   [opts.userId]     - User ID (required when no overrideProduct)
 * @param {string}   [opts.subjectId]  - Subject/niche ID to filter products and resolve credentials
 */
async function run(overrideProduct = null, { platforms = ['whatsapp', 'facebook', 'instagram'], userId, subjectId } = {}) {
  const sendWA = platforms.includes('whatsapp');
  const sendFB = platforms.includes('facebook');
  const sendIG = platforms.includes('instagram');
  log('▶ Workflow started');

  const subjectConfig = subjectId ? await resolveSubjectConfig(subjectId, userId) : null;
  if (subjectId) {
    log(`Subject: ${subjectConfig ? subjectConfig.name : subjectId}`);
  }

  // Step 1: Get product
  let product;
  if (overrideProduct) {
    product = overrideProduct;
    log(`Using provided product: ${product.Text}`);
  } else {
    log('Fetching next unsent product from DB...');
    product = await getNextUnsent({ userId, subjectId });
    if (!product) {
      log('No unsent products found. Workflow complete.', 'warn');
      return { success: false, reason: 'no_unsent_products' };
    }
    log(`Found product: "${product.Text}" → ${product.Link}`);
  }

  // Step 2: Generate or reuse message
  const hasNichePrompt = !!(subjectConfig?.prompt && subjectConfig.prompt.trim());
  const isSavedMessage = !hasNichePrompt && /[\u05D0-\u05EA]/.test(product.Text) && product.Link && product.Text.includes(product.Link);
  let message;
  if (isSavedMessage) {
    message = product.Text;
    log(`Using saved Hebrew message (${message.length} chars)`);
  } else {
    if (hasNichePrompt && /[\u05D0-\u05EA]/.test(product.Text) && product.Link && product.Text.includes(product.Link)) {
      log('Niche has custom prompt — regenerating message');
    }
    log('Generating Hebrew marketing message via OpenAI...');
    message = await openai.generateMessage({
      Text: product.Text,
      Link: product.Link,
      join_link: product.join_link,
      promptOverride: subjectConfig?.prompt || null,
    });
    log(`Message generated (${message.length} chars)`);
    try {
      await updateProductText(product.id, message);
      log('✓ Generated message saved to DB');
    } catch (err) {
      log(`⚠ Could not save message to DB: ${err.message}`, 'warn');
    }
  }

  const results = { product, message, whatsapp: null, facebook: null, instagram: null };

  // Step 3: WhatsApp
  if (sendWA) {
    try {
      log(`Sending to WhatsApp group: ${product.wa_group}`);
      const waResult = await whatsapp.send({
        text: message,
        image: product.image,
        wa_group: product.wa_group,
        webhookUrl: subjectConfig?.whatsappUrl || null,
      });
      results.whatsapp = waResult;
      if (waResult.success) log('✓ WhatsApp message sent successfully');
      else log(`⚠ WhatsApp response not OK: ${JSON.stringify(waResult.raw)}`, 'warn');
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
        facebookPageId: subjectConfig?.facebookPageId || null,
        facebookToken:  subjectConfig?.facebookToken  || null,
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

  // Step 5: Instagram
  if (sendIG) {
    const igAccountId = subjectConfig?.instagramAccountId;
    const igToken     = subjectConfig?.facebookToken;
    if (!igAccountId || !igToken) {
      log('⏭ Instagram skipped — no Instagram Account ID or token configured', 'warn');
      results.instagram = { success: false, error: 'not_configured' };
    } else if (!product.image) {
      log('⏭ Instagram skipped — product has no image', 'warn');
      results.instagram = { success: false, error: 'no_image' };
    } else {
      try {
        log(`Posting to Instagram (${igAccountId})...`);
        const igResult = await instagram.postPhoto({
          igUserId:    igAccountId,
          accessToken: igToken,
          imageUrl:    product.image,
          caption:     message,
        });
        results.instagram = igResult;
        log(`✓ Instagram post published (id: ${igResult.data?.id})`);
      } catch (err) {
        log(`✗ Instagram failed: ${err.message}`, 'error');
        results.instagram = { success: false, error: err.message };
      }
    }
  } else {
    log('⏭ Instagram skipped');
  }

  // Step 6: Mark sent in DB
  try {
    const sentAt     = !sendWA ? null : (results.whatsapp?.success  ? new Date().toISOString() : '');
    const facebookAt = !sendFB ? null : (results.facebook?.success  ? new Date().toISOString() : '');
    const instagramAt= !sendIG ? null : (results.instagram?.success ? new Date().toISOString() : '');
    await markSent(product.id, { sentAt, facebookAt, instagramAt });
    log('✓ DB updated');
  } catch (err) {
    log(`✗ Failed to update DB: ${err.message}`, 'error');
  }

  log('■ Workflow complete');
  return { success: true, results };
}

module.exports = { run, setEmitter, log };
