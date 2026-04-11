const googleSheets = require('./googleSheets');
const openai = require('./openai');
const whatsapp = require('./whatsapp');
const facebook = require('./facebook');
const instagram = require('./instagram');
const { getSubjectById, getGroupsBySubject } = require('./subjectService');

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

function log(msg, level = 'info') {
  const entry = { ts: new Date().toISOString(), level, msg };
  console.log(`[${level.toUpperCase()}] ${msg}`);
  if (_emit) _emit(entry);
}

/**
 * Run one full product send cycle:
 * 1. Get next unsent product from Google Sheets (filtered by subject if provided)
 * 2. Generate Hebrew message via OpenAI
 * 3. Send to WhatsApp via MacroDroid (using subject-specific webhook if configured)
 * 4. Post to Facebook page (using subject-specific credentials if configured)
 * 5. Mark row as sent in Google Sheets
 *
 * @param {object} [overrideProduct] - If provided, use this product instead of fetching next unsent
 * @param {object} [opts]
 * @param {string[]} [opts.platforms]  - Which platforms to send to
 * @param {string}   [opts.subject]    - Subject/niche id to filter products and use credentials for
 */
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
    log('Fetching next unsent product from Google Sheets...');
    product = await googleSheets.getNextUnsent(subject !== undefined ? { subject } : {});
    if (!product) {
      log('No unsent products found. Workflow complete.', 'warn');
      return { success: false, reason: 'no_unsent_products' };
    }
    log(`Found product: "${product.Text}" → ${product.Link}`);
  }

  // Step 2: Generate message (or reuse saved Hebrew message)
  // Only reuse if the saved text is a fully generated message (contains the product link)
  // BUT: if the niche has a custom prompt, always regenerate to ensure correct niche tone
  const hasNichePrompt = !!(subjectConfig?.prompt && subjectConfig.prompt.trim());
  const isSavedMessage = !hasNichePrompt && /[\u05D0-\u05EA]/.test(product.Text) && product.Link && product.Text.includes(product.Link);
  let message;
  if (isSavedMessage) {
    message = product.Text;
    log(`Using saved Hebrew message (${message.length} chars)`);
  } else {
    if (hasNichePrompt && /[\u05D0-\u05EA]/.test(product.Text) && product.Link && product.Text.includes(product.Link)) {
      log('Niche has custom prompt — regenerating message instead of using cached version');
    }
    log('Generating Hebrew marketing message via OpenAI...');
    message = await openai.generateMessage({
      Text: product.Text,
      Link: product.Link,
      join_link: product.join_link,
      promptOverride: subjectConfig?.prompt || null,
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

  const results = { product, message, whatsapp: null, facebook: null, instagram: null };

  // Step 3: WhatsApp — send to selected groups (or product's wa_group as fallback)
  if (sendWA) {
    // Resolve which groups to send to
    let groupsToSend = [];
    if (waGroupIds && waGroupIds.length > 0 && subject && userId) {
      // Fetch all groups for this niche and filter to selected ids
      const allGroups = await getGroupsBySubject(subject, userId);
      groupsToSend = allGroups.filter(g => waGroupIds.includes(g.id));
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
            text:       message,
            image:      product.image,
            wa_group:   group.waGroup,
            webhookUrl: subjectConfig?.macrodroidUrl || null,
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
      // Fallback: use product's wa_group string (legacy / no DB groups configured)
      try {
        log(`Sending to WhatsApp group: ${product.wa_group}`);
        const waResult = await whatsapp.send({
          text:       message,
          image:      product.image,
          wa_group:   product.wa_group,
          webhookUrl: subjectConfig?.macrodroidUrl || null,
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
    // null = platform was skipped (preserve existing value), '' = tried but failed
    const sentAt      = !sendWA ? null : (results.whatsapp?.success  ? new Date().toISOString() : '');
    const facebookAt  = !sendFB ? null : (results.facebook?.success  ? new Date().toISOString() : '');
    const instagramAt = !sendIG ? null : (results.instagram?.success  ? new Date().toISOString() : '');
    await googleSheets.markSent(product.Link, { sentAt, facebookAt, instagramAt });
    log('✓ Google Sheet updated');
  } catch (err) {
    log(`✗ Failed to update Google Sheet: ${err.message}`, 'error');
  }

  log('■ Workflow complete');
  return { success: true, results };
}

module.exports = { run, setEmitter, log };
