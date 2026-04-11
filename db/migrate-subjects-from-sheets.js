/**
 * One-time migration: reads subjects from Google Sheets Settings tab
 * and inserts them into the PostgreSQL subjects table for the admin user.
 *
 * Run once:  node db/migrate-subjects-from-sheets.js
 */
require('dotenv').config();
const { query } = require('./index');
const { getSubjects } = require('../services/googleSheets');

async function main() {
  // Find the admin user
  const { rows: adminRows } = await query(
    `SELECT id, email FROM users WHERE role = 'admin' LIMIT 1`
  );
  if (!adminRows.length) {
    console.error('✗ No admin user found in DB. Log in first to create the admin account.');
    process.exit(1);
  }
  const adminId = adminRows[0].id;
  console.log(`✓ Admin user: ${adminRows[0].email} (${adminId})`);

  // Read subjects from Google Sheets
  const subjects = await getSubjects();
  if (!subjects.length) {
    console.log('No subjects found in Google Sheets — nothing to migrate.');
    process.exit(0);
  }
  console.log(`Found ${subjects.length} subject(s) in Google Sheets:`);
  subjects.forEach(s => console.log(`  · ${s.name} (id: ${s.id})`));

  // Insert each subject (skip if already exists by name for idempotency)
  let inserted = 0;
  let skipped  = 0;

  for (const s of subjects) {
    const { rows: existing } = await query(
      `SELECT id FROM subjects WHERE user_id = $1 AND name = $2 LIMIT 1`,
      [adminId, s.name]
    );
    if (existing.length) {
      console.log(`  ⏭ Skipped (already exists): ${s.name}`);
      skipped++;
      continue;
    }

    await query(
      `INSERT INTO subjects
         (user_id, name, macrodroid_url, facebook_page_id, facebook_token,
          facebook_app_id, facebook_app_secret, instagram_account_id,
          join_link, openai_prompt, wa_enabled, fb_enabled, instagram_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        adminId,
        s.name,
        s.whatsappUrl           || null,
        s.facebookPageId        || null,
        s.facebookToken         || null,
        s.facebookAppId         || null,
        s.facebookAppSecret     || null,
        s.instagramAccountId    || null,
        s.joinLink              || null,
        s.prompt                || null,
        s.waEnabled             !== false,
        s.fbEnabled             !== false,
        s.instagramEnabled      === true,
      ]
    );

    // If the subject had a waGroupName, create a whatsapp_group entry too
    if (s.waGroupName) {
      const { rows: newSubj } = await query(
        `SELECT id FROM subjects WHERE user_id = $1 AND name = $2 LIMIT 1`,
        [adminId, s.name]
      );
      if (newSubj.length) {
        await query(
          `INSERT INTO whatsapp_groups (user_id, subject_id, name, wa_group, join_link)
           VALUES ($1, $2, $3, $4, $5)`,
          [adminId, newSubj[0].id, s.waGroupName, s.waGroupName, s.joinLink || null]
        );
        console.log(`  ✓ Migrated: ${s.name} + קבוצה: ${s.waGroupName}`);
      }
    } else {
      console.log(`  ✓ Migrated: ${s.name}`);
    }
    inserted++;
  }

  console.log(`\nDone: ${inserted} migrated, ${skipped} skipped.`);
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
