// ── Broadcast Delivery ────────────────────────────────────────────────────────
// Sends a broadcast_messages record to WhatsApp + Facebook.
// Called from routes/broadcasts.js (fire-now) and scheduler/index.js (cron).

const { getSubjectById } = require('./subjectService');
const whatsapp = require('./whatsapp');
const facebook = require('./facebook');

// Shared log emitter injected from server.js
let _emit = null;
function setEmitter(fn) { _emit = fn; }

function log(msg, level = 'info') {
  const entry = { ts: new Date().toISOString(), level, msg: `[broadcast] ${msg}` };
  console.log(`[${level.toUpperCase()}] [broadcast] ${msg}`);
  if (_emit) _emit(entry);
}

// Build absolute image URL from a stored relative path
function buildImageUrl(imageUrl) {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http')) return imageUrl;
  const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/${imageUrl.replace(/^\//, '')}`;
}

// Accept camelCase (from service) or snake_case (from DB row)
function _normalize(b) {
  return {
    id:         b.id,
    label:      b.label,
    text:       b.text,
    image_url:  b.image_url  ?? b.imageUrl  ?? null,
    subject_id: b.subject_id ?? b.subjectId ?? null,
    user_id:    b.user_id    ?? b.userId    ?? null,
  };
}

// ── send ──────────────────────────────────────────────────────────────────────
// Returns: { whatsapp: Object, facebook: Object }
// Each platform result is independent — failure in one does not affect the other.
async function send(broadcast, userId) {
  const b = _normalize(broadcast);
  log(`▶ Firing broadcast: "${b.label}" (subject: ${b.subject_id})`);

  const subject = await getSubjectById(b.subject_id, userId);
  if (!subject) {
    log(`Subject not found: ${b.subject_id}`, 'error');
    throw new Error(`Subject not found: ${b.subject_id}`);
  }
  log(`Subject: "${subject.name}" | wa_group: ${subject.waGroup || '(none)'}`);

  const imageUrl = buildImageUrl(b.image_url);
  const results  = { whatsapp: null, facebook: null };

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  if (!subject.waGroup) {
    log('No wa_group configured on subject — skipping WhatsApp', 'warn');
    results.whatsapp = { success: false, error: 'No wa_group configured on subject' };
  } else {
    try {
      log(`Sending to WhatsApp group: ${subject.waGroup}`);
      const r = await whatsapp.send({
        text:     b.text,
        image:    imageUrl,
        wa_group: subject.waGroup,
      });
      results.whatsapp = { ...r, group: subject.name };
      if (r.success) {
        log(`✓ WhatsApp sent (chat: "${r.chatName || subject.waGroup}")`);
      } else {
        log(`⚠ WhatsApp not OK: ${JSON.stringify(r.raw)}`, 'warn');
      }
    } catch (err) {
      log(`✗ WhatsApp failed: ${err.message}`, 'error');
      results.whatsapp = { success: false, error: err.message };
    }
  }

  // ── Facebook (independent of WhatsApp result) ─────────────────────────────
  try {
    log('Posting to Facebook...');
    let fbResult;
    if (imageUrl) {
      fbResult = await facebook.postPhoto({
        message:        b.text,
        imageUrl,
        facebookPageId: subject.facebookPageId || null,
        facebookToken:  subject.facebookToken  || null,
      });
    } else {
      fbResult = await facebook.postText({
        message:        b.text,
        facebookPageId: subject.facebookPageId || null,
        facebookToken:  subject.facebookToken  || null,
      });
    }
    results.facebook = fbResult;
    if (fbResult.success) {
      log(`✓ Facebook posted (id: ${fbResult.data?.post_id || fbResult.data?.id})`);
    } else {
      log(`⚠ Facebook not OK: ${JSON.stringify(fbResult)}`, 'warn');
    }
  } catch (err) {
    log(`✗ Facebook failed: ${err.message}`, 'error');
    results.facebook = { success: false, error: err.message };
  }

  log(`■ Broadcast complete — WA: ${JSON.stringify(results.whatsapp)} | FB: ${JSON.stringify(results.facebook)}`);
  return results;
}

module.exports = { send, setEmitter };
