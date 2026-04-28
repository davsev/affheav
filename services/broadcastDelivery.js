// ── Broadcast Delivery ────────────────────────────────────────────────────────
// Thin orchestrator: sends a broadcast_messages record to WhatsApp + Facebook.
// Called from routes/broadcasts.js (fire-now) and scheduler/index.js (cron).

const { getSubjectById, getGroupsBySubject } = require('./subjectService');
const whatsapp = require('./whatsapp');
const facebook = require('./facebook');

// Delay between WhatsApp group sends — matches workflow.js (WA_GROUP_DELAY_MS)
const WA_GROUP_DELAY_MS = 2 * 60 * 1000;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
async function send(broadcast, userId) {
  const b       = _normalize(broadcast);
  const subject = await getSubjectById(b.subject_id, userId);
  if (!subject) throw new Error(`Subject not found: ${b.subject_id}`);

  const imageUrl = buildImageUrl(b.image_url);
  const results  = { whatsapp: null, facebook: null };

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  try {
    const groups = await getGroupsBySubject(b.subject_id, userId);
    if (groups.length === 0) {
      results.whatsapp = { success: false, error: 'No WhatsApp groups configured for this subject' };
    } else {
      results.whatsapp = [];
      for (let i = 0; i < groups.length; i++) {
        if (i > 0) await sleep(WA_GROUP_DELAY_MS);
        const g = groups[i];
        try {
          const r = await whatsapp.send({
            text:       b.text,
            image:      imageUrl,
            wa_group:   g.waGroup,
            groupId:    g.waGroup,
            webhookUrl: subject.macrodroidUrl || null,
            provider:   subject.waProvider || 'macrodroid',
          });
          results.whatsapp.push({ group: g.name, ...r });
        } catch (err) {
          results.whatsapp.push({ group: g.name, success: false, error: err.message });
        }
      }
    }
  } catch (err) {
    results.whatsapp = { success: false, error: err.message };
  }

  // ── Facebook (independent of WhatsApp result) ─────────────────────────────
  try {
    let fbResult;
    if (imageUrl) {
      // Photo post — includes image
      fbResult = await facebook.postPhoto({
        message:        b.text,
        imageUrl,
        facebookPageId: subject.facebookPageId || null,
        facebookToken:  subject.facebookToken  || null,
      });
    } else {
      // Text-only post — no image (postPhoto rejects null imageUrl on /photos endpoint)
      fbResult = await facebook.postText({
        message:        b.text,
        facebookPageId: subject.facebookPageId || null,
        facebookToken:  subject.facebookToken  || null,
      });
    }
    results.facebook = fbResult;
  } catch (err) {
    results.facebook = { success: false, error: err.message };
  }

  return results;
}

module.exports = { send };
