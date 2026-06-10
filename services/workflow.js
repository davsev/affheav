const { query } = require('../db');
const openai = require('./openai');
const whatsapp = require('./whatsapp');
const facebook = require('./facebook');
const instagram = require('./instagram');
const { getSubjectById, getGroupsBySubject } = require('./subjectService');
const { resolveUrl } = require('./aliexpressSync');

const WA_GROUP_DELAY_MS = 2 * 60 * 1000; // 2 minutes between WhatsApp groups

// Resolve subject config (credentials) by subject id and user id
async function resolveSubjectConfig(subjectId, userId) {
  if (!subjectId || !userId) return null;
  return getSubjectById(subjectId, userId);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Global log emitter — set by server.js so routes/scheduler can share it
let _emit = null;
function setEmitter(fn) { _emit = fn; }

function log(msg, level = 'info', context = null) {
  const entry = { ts: new Date().toISOString(), level, msg, ...context };
  console.log(`[${level.toUpperCase()}] ${msg}`);
  if (_emit) _emit(entry);
}

// Returns a scoped log function that attaches { userId, subjectId } to every entry
function makeScopedLog(context) {
  return (msg, level = 'info') => log(msg, level, context);
}

async function getUserSetting(userId, key) {
  const { rows } = await query(
    'SELECT value FROM settings WHERE user_id = $1 AND key = $2',
    [userId, key]
  );
  return rows[0]?.value ?? null;
}

// Get next unsent product for a user from Postgres
function _productRow(r) {
  return {
    id:                   r.id,
    long_url:             r.long_url    || '',
    Link:                 r.short_link  || '',
    image:                r.image       || '',
    Text:                 r.text        || '',
    join_link:            r.join_link   || '',
    wa_group:             r.wa_group    || '',
    sent:                 r.sent_at     ? new Date(r.sent_at).toISOString() : '',
    subject:              r.subject_id  || '',
    skip_ai:              r.skip_ai     || false,
    video_url:            r.video_url   || '',
    use_video:            r.use_video   || false,
    affiliate_source_name: r.affiliate_source_name || null,
    affiliate_source_description: r.affiliate_source_description || null,
  };
}

async function getNextUnsent({ userId, subject } = {}) {
  let rows;
  const join = `LEFT JOIN affiliate_sources afs ON afs.id = p.affiliate_source_id`;
  const cols = `p.*, afs.name AS affiliate_source_name, afs.description AS affiliate_source_description`;
  if (subject) {
    ({ rows } = await query(
      `SELECT ${cols} FROM products p ${join}
       WHERE p.user_id = $1 AND p.subject_id = $2
         AND p.sent_at IS NULL AND p.short_link IS NOT NULL AND p.short_link != ''
       ORDER BY p.sort_order ASC NULLS LAST, p.created_at ASC LIMIT 1`,
      [userId, subject]
    ));
  } else {
    ({ rows } = await query(
      `SELECT ${cols} FROM products p ${join}
       WHERE p.user_id = $1
         AND p.sent_at IS NULL AND p.short_link IS NOT NULL AND p.short_link != ''
       ORDER BY p.sort_order ASC NULLS LAST, p.created_at ASC LIMIT 1`,
      [userId]
    ));
  }
  return rows[0] ? _productRow(rows[0]) : null;
}

// Find oldest-sent product that is still live (not 404) — used as fallback when queue is empty
async function getFallbackProduct({ userId, subject } = {}) {
  const args = [userId];
  const subjectClause = subject ? `AND p.subject_id = $${args.push(subject)}` : '';
  const { rows } = await query(
    `SELECT p.*, afs.name AS affiliate_source_name, afs.description AS affiliate_source_description
     FROM products p
     LEFT JOIN affiliate_sources afs ON afs.id = p.affiliate_source_id
     WHERE p.user_id = $1 ${subjectClause}
       AND p.sent_at IS NOT NULL
       AND p.short_link IS NOT NULL AND p.short_link != ''
       AND p.long_url   IS NOT NULL AND p.long_url   != ''
     ORDER BY p.sent_at ASC
     LIMIT 20`,
    args
  );

  for (const r of rows) {
    const { status } = await resolveUrl(r.long_url);
    if (status === 404) {
      log(`⚠ Fallback candidate "${(r.text || '').slice(0, 50)}" returned 404 — skipping`, 'warn');
      continue;
    }
    log(`Recycling product sent on ${new Date(r.sent_at).toLocaleDateString('he-IL')}: "${(r.text || '').slice(0, 50)}"`);
    return { ...r, ..._productRow(r), sent: new Date(r.sent_at).toISOString() };
  }
  return null;
}

// Mark product as sent in Postgres
async function markSent(productId, { sentAt, facebookAt, instagramAt, fbPostId, igMediaId } = {}) {
  const updates = [];
  const values  = [];
  let i = 1;
  if (sentAt !== null) {
    updates.push(`sent_at = $${i++}`);
    values.push(sentAt ? new Date(sentAt) : null);
  }
  if (facebookAt !== null) {
    updates.push(`facebook_at = $${i++}`);
    values.push(facebookAt ? new Date(facebookAt) : null);
  }
  if (instagramAt !== null) {
    updates.push(`instagram_at = $${i++}`);
    values.push(instagramAt ? new Date(instagramAt) : null);
  }
  if (fbPostId) {
    updates.push(`fb_post_id = $${i++}`);
    values.push(fbPostId);
  }
  if (igMediaId) {
    updates.push(`ig_media_id = $${i++}`);
    values.push(igMediaId);
  }
  if (!updates.length) return;
  updates.push(`send_count = send_count + 1`);
  updates.push(`updated_at = NOW()`);
  values.push(productId);
  await query(`UPDATE products SET ${updates.join(', ')} WHERE id = $${i}`, values);
}

// Save generated message back to product in Postgres
async function updateProductText(productId, text) {
  await query('UPDATE products SET text = $1, updated_at = NOW() WHERE id = $2', [text, productId]);
}

/**
 * @param {object} [overrideProduct]
 * @param {object} [opts]
 * @param {string[]} [opts.platforms]       - ['whatsapp','facebook','instagram']
 * @param {string}   [opts.subject]         - subject/niche id
 * @param {string}   [opts.userId]          - owner user id (required for DB lookups)
 * @param {string[]} [opts.waGroupIds]      - selected whatsapp_groups ids to send to
 */
async function run(overrideProduct = null, { platforms = ['whatsapp', 'facebook', 'instagram'], subject, userId, waGroupIds } = {}) {
  const sendWA = platforms.includes('whatsapp');
  const sendFB = platforms.includes('facebook');
  const sendIG = platforms.includes('instagram');
  const log = makeScopedLog({ userId: userId || null, subjectId: subject || null });
  log('▶ Workflow started');

  // Resolve subject credentials (if subject is specified)
  const subjectConfig = (subject && userId) ? await resolveSubjectConfig(subject, userId) : null;
  if (subject) {
    log(`Niche: ${subjectConfig ? subjectConfig.name : subject}`);
  }

  // Step 1: Get product
  let product;
  if (overrideProduct) {
    product = overrideProduct;
    log(`Using provided product: ${product.Text}`);
  } else {
    log('Fetching next unsent product from DB...');
    product = await getNextUnsent({ userId, subject });
    if (!product) {
      const recycle = userId && await getUserSetting(userId, 'recycle_products');
      if (recycle === 'true') {
        log('No unsent products — searching for oldest sent product to recycle...');
        product = await getFallbackProduct({ userId, subject });
        if (!product) {
          log('No recyclable products available (all returned 404).', 'warn');
          return { success: false, reason: 'no_products' };
        }
      } else {
        log('No unsent products found. Workflow complete.', 'warn');
        return { success: false, reason: 'no_unsent_products' };
      }
    }
    log(`Found product: "${product.Text}" → ${product.Link}`);
  }

  // Step 2: Generate message (or reuse saved Hebrew message)
  // Only reuse if the saved text is a fully generated message (contains the product link)
  // BUT: if the niche has a custom prompt, always regenerate to ensure correct niche tone
  const hasNichePrompt = !!(subjectConfig?.prompt && subjectConfig.prompt.trim());
  const isSavedMessage = !hasNichePrompt && /[\u05D0-\u05EA]/.test(product.Text) && product.Link && product.Text.includes(product.Link);
  let message;
  if (product.skip_ai) {
    message = product.Text;
    log(`skip_ai flag set — using product text as-is (${message.length} chars)`);
  } else if (isSavedMessage) {
    message = product.Text;
    log(`Using saved Hebrew message (${message.length} chars)`);
  } else {
    if (hasNichePrompt && /[\u05D0-\u05EA]/.test(product.Text) && product.Link && product.Text.includes(product.Link)) {
      log('Niche has custom prompt — regenerating message instead of using cached version');
    }
    log('Generating Hebrew marketing message via OpenAI...');
    message = await openai.generateMessage({
      Text:           product.Text,
      Link:           product.Link,
      join_link:      product.join_link,
      promptOverride: subjectConfig?.prompt || null,
      sourceName:     product.affiliate_source_name        || null,
      sourceDescription: product.affiliate_source_description || null,
    });
    log(`Message generated (${message.length} chars)`);
    // Save generated message back to DB so resends don't regenerate
    try {
      await updateProductText(product.id, message);
      log('✓ Generated message saved to DB');
    } catch (err) {
      log(`⚠ Could not save message to DB: ${err.message}`, 'warn');
    }
  }

  const results = { product, message, whatsapp: null, facebook: null, instagram: null };

  // Step 3: WhatsApp — send to selected groups (or product's wa_group as fallback)
  if (sendWA) {
    // Resolve which groups to send to
    let groupsToSend = [];
    if (subject && userId) {
      const allGroups = await getGroupsBySubject(subject, userId);
      if (waGroupIds && waGroupIds.length > 0) {
        // Manual send: filter to only the selected groups
        groupsToSend = allGroups.filter(g => waGroupIds.includes(g.id));
      } else {
        // Scheduler (or send-all): use every group configured for this niche
        groupsToSend = allGroups;
      }
    }

    if (groupsToSend.length > 0) {
      results.whatsapp = [];
      for (let i = 0; i < groupsToSend.length; i++) {
        const group = groupsToSend[i];
        if (i > 0) {
          log(`⏳ Waiting 2 minutes before sending to next group...`);
          await sleep(WA_GROUP_DELAY_MS);
        }
        try {
          log(`Sending to WhatsApp group: ${group.name} (${group.waGroup})`);
          const waResult = await whatsapp.send({
            text:     message,
            image:    product.image,
            videoUrl: (product.use_video && product.video_url) ? product.video_url : undefined,
            wa_group: group.waGroup,
          });
          results.whatsapp.push({ group: group.name, ...waResult });
          if (waResult.success) {
            log(`✓ WhatsApp sent to "${group.name}"`);
          } else {
            log(`⚠ WhatsApp response not OK for "${group.name}": ${JSON.stringify(waResult.raw)}`, 'warn');
          }
        } catch (err) {
          log(`✗ WhatsApp failed for "${group.name}": ${err.message}`, 'error');
          results.whatsapp.push({ group: group.name, success: false, error: err.message });
        }
      }
    } else {
      // Fallback: use niche-level wa_group, then product's wa_group (legacy)
      const waGroup = subjectConfig?.waGroup || product.wa_group;
      if (!waGroup) {
        log('⚠ No WhatsApp group configured for this niche — skipping WhatsApp', 'warn');
        results.whatsapp = { success: false, error: 'no_wa_group_configured' };
      } else {
      try {
        log(`Sending to WhatsApp group: ${waGroup}`);
        const waResult = await whatsapp.send({
          text:     message,
          image:    product.image,
          videoUrl: (product.use_video && product.video_url) ? product.video_url : undefined,
          wa_group: waGroup,
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
      } // end else (waGroup exists)
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
        facebookToken: subjectConfig?.facebookToken || null,
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
    const igToken     = subjectConfig?.facebookToken; // same Page token works for IG
    if (!igAccountId || !igToken) {
      log('⏭ Instagram skipped — no Instagram Account ID or token configured for this niche', 'warn');
      results.instagram = { success: false, error: 'not_configured' };
    } else if (!product.image) {
      log('⏭ Instagram skipped — product has no image', 'warn');
      results.instagram = { success: false, error: 'no_image' };
    } else {
      try {
        log(`Posting to Instagram (${igAccountId})...`);
        const igResult = await instagram.postPhoto({
          igUserId: igAccountId,
          accessToken: igToken,
          imageUrl: product.image,
          caption: message,
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

  // Step 6: Mark sent
  try {
    // null  = platform was skipped (preserve existing DB value)
    // null  = platform tried but failed (don't mark as sent so it can be retried)
    // isoString = success
    const waSuccess = Array.isArray(results.whatsapp)
      ? results.whatsapp.some(r => r.success)
      : !!results.whatsapp?.success;
    const sentAt      = !sendWA ? null : (waSuccess                ? new Date().toISOString() : null);
    const facebookAt  = !sendFB ? null : (results.facebook?.success  ? new Date().toISOString() : null);
    const instagramAt = !sendIG ? null : (results.instagram?.success ? new Date().toISOString() : null);
    const fbPostId    = results.facebook?.data?.post_id || results.facebook?.data?.id || null;
    const igMediaId   = results.instagram?.data?.id || null;
    await markSent(product.id, { sentAt, facebookAt, instagramAt, fbPostId, igMediaId });
    log('✓ DB updated');
  } catch (err) {
    log(`✗ Failed to update Google Sheet: ${err.message}`, 'error');
  }

  log('■ Workflow complete');
  return { success: true, results };
}

module.exports = { run, setEmitter, log };
