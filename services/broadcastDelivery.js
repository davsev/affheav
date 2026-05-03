// ── Broadcast Delivery ────────────────────────────────────────────────────────
// Thin orchestrator: sends a broadcast_messages record to WhatsApp + Facebook.
// Called from routes/broadcasts.js (fire-now) and scheduler/index.js (cron).

const { getSubjectById, getGroupsBySubject } = require('./subjectService');
const whatsapp = require('./whatsapp');
const facebook = require('./facebook');

// Delay between WhatsApp group sends — matches workflow.js (WA_GROUP_DELAY_MS)
const WA_GROUP_DELAY_MS = 2 * 60 * 1000;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Shared log emitter injected from server.js (same pattern as workflow.js)
let _emit = null;
function setEmitter(fn) { _emit = fn; }

function log(msg, level = 'info') {
  const entry = { ts: new Date().toISOString(), level, msg: `[broadcast] ${msg}` };
  console.log(`[${level.toUpperCase()}] [broadcast] ${msg}`);
  if (_emit) _emit(entry);
}

// Build absolute image URL from stored relative path.
// broadcast_messages.image_url stores relative paths like "uploads/broadcasts/uuid.jpg"
// Facebook Graph API and MacroDroid webhook both require absolute URLs.
function buildImageUrl(imageUrl) {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('http')) return imageUrl; // already absolute
  const base = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/${imageUrl.replace(/^\//, '')}`;
}

// Normalize broadcast object: accept camelCase (from service) or snake_case (from DB row)
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
// Sends broadcast to all WhatsApp groups (sequenced, 2-min delay) and Facebook.
// Returns: { whatsapp: Array|Object, facebook: Object }
// Each platform result is independent — failure in one does not affect the other.
async function send(broadcast, userId, { fireNow = false } = {}) {
  const b       = _normalize(broadcast);
  log(`▶ Firing broadcast: "${b.label}" (subject: ${b.subject_id})`);

  const subject = await getSubjectById(b.subject_id, userId);
  if (!subject) {
    log(`Subject not found: ${b.subject_id}`, 'error');
    throw new Error(`Subject not found: ${b.subject_id}`);
  }
  log(`Subject: "${subject.name}" | provider: ${subject.waProvider || 'macrodroid'}`);

  const imageUrl = buildImageUrl(b.image_url);
  const results  = { whatsapp: null, facebook: null };

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  try {
    let groups = await getGroupsBySubject(b.subject_id, userId);
    log(`WhatsApp groups from table: ${groups.length}`);

    // Fallback to subject-level wa_group when no whatsapp_groups rows exist (matches workflow.js)
    if (groups.length === 0 && subject.waGroup) {
      log(`No groups in table — falling back to subject wa_group: ${subject.waGroup}`);
      groups = [{ name: subject.name, waGroup: subject.waGroup }];
    }

    if (groups.length === 0) {
      log('No WhatsApp groups configured for this subject — skipping WhatsApp', 'warn');
      results.whatsapp = { success: false, error: 'No WhatsApp groups configured for this subject' };
    } else {
      results.whatsapp = [];
      for (let i = 0; i < groups.length; i++) {
        if (i > 0 && !fireNow) {
          log('⏳ Waiting 2 minutes before next group...');
          await sleep(WA_GROUP_DELAY_MS);
        }
        const g = groups[i];
        try {
          log(`Sending to WhatsApp group: "${g.name}" (${g.waGroup})`);
          const r = await whatsapp.send({
            text:       b.text,
            image:      imageUrl,
            wa_group:   g.waGroup,
            webhookUrl: subject.macrodroidUrl || null,
          });
          results.whatsapp.push({ group: g.name, ...r });
          if (r.success) {
            log(`✓ WhatsApp sent to "${g.name}"`);
          } else {
            log(`⚠ WhatsApp not OK for "${g.name}": ${JSON.stringify(r.raw)}`, 'warn');
          }
        } catch (err) {
          log(`✗ WhatsApp failed for "${g.name}": ${err.message}`, 'error');
          results.whatsapp.push({ group: g.name, success: false, error: err.message });
        }
      }
    }
  } catch (err) {
    log(`✗ WhatsApp error: ${err.message}`, 'error');
    results.whatsapp = { success: false, error: err.message };
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
