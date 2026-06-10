const { query } = require('../db');

function _row(r) {
  if (!r) return null;
  return {
    id:            r.id,
    userId:        r.user_id,
    name:          r.name,
    domain:        r.domain        || '',
    linkTemplate:  r.link_template || '',
    affiliateCode: r.affiliate_code || '',
    description:   r.description   || '',
    createdAt:     r.created_at,
    updatedAt:     r.updated_at,
  };
}

async function getSourcesByUser(userId) {
  const { rows } = await query(
    'SELECT * FROM affiliate_sources WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  );
  return rows.map(_row);
}

async function getSourceById(id, userId) {
  const { rows } = await query(
    'SELECT * FROM affiliate_sources WHERE id = $1 AND user_id = $2 LIMIT 1',
    [id, userId]
  );
  return _row(rows[0]);
}

// Find a source whose domain matches (partial hostname match)
async function detectSourceByUrl(url, userId) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const { rows } = await query(
      `SELECT * FROM affiliate_sources
       WHERE user_id = $1 AND domain IS NOT NULL AND domain != ''
       ORDER BY created_at ASC`,
      [userId]
    );
    const match = rows.find(r => {
      const d = (r.domain || '').replace(/^www\./, '').toLowerCase();
      return hostname.endsWith(d) || d.endsWith(hostname);
    });
    return _row(match || null);
  } catch {
    return null;
  }
}

async function createSource(userId, fields) {
  const { rows } = await query(
    `INSERT INTO affiliate_sources (user_id, name, domain, link_template, affiliate_code, description)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      userId,
      fields.name,
      fields.domain        || null,
      fields.linkTemplate  || null,
      fields.affiliateCode || null,
      fields.description   || null,
    ]
  );
  return _row(rows[0]);
}

async function updateSource(id, userId, fields) {
  const allowed = {
    name:          'name',
    domain:        'domain',
    linkTemplate:  'link_template',
    affiliateCode: 'affiliate_code',
    description:   'description',
  };

  const updates = [];
  const values  = [];
  let   i       = 1;

  for (const [jsKey, col] of Object.entries(allowed)) {
    if (fields[jsKey] !== undefined) {
      updates.push(`${col} = $${i++}`);
      values.push(fields[jsKey] || null);
    }
  }

  if (!updates.length) return getSourceById(id, userId);
  updates.push(`updated_at = NOW()`);
  values.push(id, userId);

  await query(
    `UPDATE affiliate_sources SET ${updates.join(', ')}
     WHERE id = $${i} AND user_id = $${i + 1}`,
    values
  );
  return getSourceById(id, userId);
}

async function deleteSource(id, userId) {
  await query(
    'DELETE FROM affiliate_sources WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
}

// Build an affiliate link using the source's link_template.
// Template placeholders: {url} (raw), {url_enc} (URI-encoded), {code}
function buildAffiliateLink(url, source) {
  if (!source?.linkTemplate || !source.linkTemplate.trim()) return url;
  return source.linkTemplate
    .replace(/\{url_enc\}/g, encodeURIComponent(url))
    .replace(/\{url\}/g,     url)
    .replace(/\{code\}/g,    source.affiliateCode || '');
}

module.exports = {
  getSourcesByUser,
  getSourceById,
  detectSourceByUrl,
  createSource,
  updateSource,
  deleteSource,
  buildAffiliateLink,
};
