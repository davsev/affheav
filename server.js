require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const workflow = require('./services/workflow');
const scheduler = require('./scheduler');
const { appendLogs } = require('./services/googleSheets');
const { query: dbQuery } = require('./db');
const { migrate } = require('./db/migrate');
const { findUser, createUser, updateUser } = require('./services/userService');
const { validateToken, markUsed } = require('./services/inviteService');

const app = express();
app.set('trust proxy', 1); // Trust Railway/proxy HTTPS headers
app.use(express.json());

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

// ── Passport / Google OAuth ───────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID     || 'ci-placeholder',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'ci-placeholder',
    callbackURL:  process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
    passReqToCallback: true,
  },
  async (req, accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      let user = await findUser(profile.id);

      if (!user) {
        // New user — determine registration path
        let assignedRole   = 'group_admin'; // default for self-registrants
        let assignedStatus = 'pending';     // all self-registrants wait for approval
        let assignedGroupAdminId = null;

        const inviteToken = req.session.inviteToken;
        let inv = null;
        if (inviteToken) {
          inv = await validateToken(inviteToken);
          if (!inv || inv.email.toLowerCase() !== email.toLowerCase()) {
            return done(null, false, { message: 'invalid_invite' });
          }
          await markUsed(inviteToken);
          delete req.session.inviteToken;
          // Invited as group_user by a Group Admin — approved immediately
          assignedRole         = inv.invited_role || 'group_user';
          assignedStatus       = 'approved';
          assignedGroupAdminId = inv.group_admin_id || null;
        }
        // Bootstrap admin check is handled inside createUser (ADMIN_GOOGLE_EMAIL logic)

        user = await createUser({
          googleId:     profile.id,
          email,
          name:         profile.displayName,
          photo:        profile.photos?.[0]?.value,
          role:         assignedRole,
          status:       assignedStatus,
          groupAdminId: assignedGroupAdminId,
        });
      } else {
        // Existing user — refresh name/photo
        user = await updateUser(profile.id, {
          name:  profile.displayName,
          photo: profile.photos?.[0]?.value,
        });
      }

      if (user.status === 'suspended') {
        return done(null, false, { message: 'suspended' });
      }

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// Store only the user id in the session; re-fetch on every request for live role/status
passport.serializeUser((user, done) => done(null, user.googleId));
passport.deserializeUser(async (googleId, done) => {
  try {
    const user = await findUser(googleId);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated() && req.user) return next();
  res.status(401).json({ success: false, error: 'Unauthorized' });
};

const isAdmin = (req, res, next) => {
  if (req.user?.role === 'admin') return next();
  res.status(403).json({ success: false, error: 'Forbidden' });
};

// ── Public Auth Routes ────────────────────────────────────────────────────────
// Store invite token in session before redirecting to Google
app.get('/auth/invite/:token', (req, res, next) => {
  req.session.inviteToken = req.params.token;
  req.session.save(() => {
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });
});

app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureMessage: true, failureRedirect: '/?error=unauthorized' }),
  (req, res) => {
    const msgs = req.session.messages || [];
    if (msgs.includes('suspended'))      return res.redirect('/?error=suspended');
    if (msgs.includes('invalid_invite')) return res.redirect('/?error=invalid_invite');
    // Redirect pending users to a waiting page
    if (req.user?.status === 'pending') return res.redirect('/pending');
    res.redirect('/');
  }
);

app.get('/pending', (req, res) => {
  if (!req.user) return res.redirect('/');
  if (req.user.status === 'approved') return res.redirect('/');
  res.send(`
    <!DOCTYPE html>
    <html lang="he" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>ממתין לאישור</title>
      <style>
        body { font-family: Arial, sans-serif; background: #1a1a2e; color: #e0e0e0;
               display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #16213e; padding: 2rem; border-radius: 12px; text-align: center; max-width: 400px; }
        h1 { color: #4ecca3; margin-bottom: 1rem; }
        p  { color: #a0a0b0; line-height: 1.6; }
        a  { color: #4ecca3; text-decoration: none; display: inline-block; margin-top: 1rem; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>בקשתך התקבלה</h1>
        <p>חשבונך ממתין לאישור מנהל המערכת.<br>תקבל הודעה כשהחשבון יאושר.</p>
        <a href="/auth/logout">יציאה</a>
      </div>
    </body>
    </html>
  `);
});
app.post('/auth/logout', (req, res) => {
  req.logout(() => res.json({ success: true }));
});

// ── Test-only Auth Bypass ─────────────────────────────────────────────────────
// Creates a real session for a synthetic user — no Google OAuth required.
// ONLY available when NODE_ENV=test. Never exposed in production.
if (process.env.NODE_ENV === 'test') {
  app.post('/auth/test-login', async (req, res) => {
    try {
      const role = req.body?.role === 'user' ? 'user' : 'admin';
      const googleId = `test-${role}`;
      const email    = `test-${role}@affiliate-heaven.test`;
      const user = await createUser({ googleId, email, name: `Test ${role}`, photo: null });
      // Force the role regardless of ADMIN_GOOGLE_EMAIL env var
      const { query: dbQuery } = require('./db');
      await dbQuery('UPDATE users SET role = $1 WHERE google_id = $2', [role, googleId]);
      user.role = role;
      req.login(user, (err) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, user: { id: user.id, email: user.email, role: user.role } });
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

app.get('/api/me', (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ success: false });
  const { id, email, name, photo, role, preferredLang } = req.user;
  res.json({ success: true, user: { id, email, name, photo, role, preferredLang: preferredLang || 'en' } });
});

// ── Load persisted prompt ─────────────────────────────────────────────────────
const promptStore = require('./services/promptStore');
const { getSetting } = require('./services/googleSheets');
getSetting('openai_prompt').then(saved => {
  if (saved) {
    promptStore.set(saved);
    console.log('✓ Loaded prompt from Google Sheets');
  }
}).catch(() => {});

// ── SSE Log Stream ────────────────────────────────────────────────────────────
// Map from res → { subjectId: string|null, userId: string }
const sseClients = new Map();

// Buffer for pending log entries not yet flushed to Google Sheets
let _pendingLogs = [];

app.get('/api/logs', isAuthenticated, (req, res) => {
  const subjectId = req.query.subjectId || null;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.set(res, { subjectId, userId: req.user.id });
  req.on('close', () => sseClients.delete(res));
});

// Persistent log history from DB, scoped by user and optionally by subject
app.get('/api/logs/history', isAuthenticated, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const subjectId = req.query.subjectId || null;
    let sql, params;
    if (subjectId) {
      sql = `SELECT ts, level, msg FROM logs WHERE user_id = $1 AND subject_id = $2 ORDER BY ts DESC LIMIT $3`;
      params = [req.user.id, subjectId, limit];
    } else {
      sql = `SELECT ts, level, msg FROM logs WHERE user_id = $1 ORDER BY ts DESC LIMIT $2`;
      params = [req.user.id, limit];
    }
    const { rows } = await dbQuery(sql, params);
    const logs = rows.reverse().map(r => ({
      ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts,
      level: r.level,
      msg: r.msg,
    }));
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function emitLog(entry) {
  _pendingLogs.push(entry);
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const [client, meta] of sseClients) {
    // Only send to clients belonging to the same user
    if (meta.userId !== entry.userId) continue;
    // If client is filtered to a specific subject, skip non-matching entries
    if (meta.subjectId && meta.subjectId !== entry.subjectId) continue;
    client.write(data);
  }
  // Persist to DB
  dbQuery(
    `INSERT INTO logs(user_id, subject_id, ts, level, msg) VALUES($1,$2,$3,$4,$5)`,
    [entry.userId || null, entry.subjectId || null, entry.ts, entry.level, entry.msg]
  ).catch(err => console.error('[logs] DB insert failed:', err.message));
}

// Flush pending logs to Google Sheets every 60 seconds (backward compat)
setInterval(async () => {
  if (_pendingLogs.length === 0) return;
  const batch = _pendingLogs.splice(0);
  await appendLogs(batch);
}, 60 * 1000);

// Purge logs older than 7 days — runs once on startup then every 24 hours
async function purgeOldLogs() {
  try {
    const { rowCount } = await dbQuery(`DELETE FROM logs WHERE ts < NOW() - INTERVAL '7 days'`);
    if (rowCount > 0) console.log(`[logs] Purged ${rowCount} entries older than 7 days`);
  } catch (err) {
    console.error('[logs] Purge failed:', err.message);
  }
}
purgeOldLogs();
setInterval(purgeOldLogs, 24 * 60 * 60 * 1000);

// Flush on graceful shutdown
process.on('SIGTERM', async () => {
  if (_pendingLogs.length > 0) {
    await appendLogs(_pendingLogs.splice(0));
  }
  process.exit(0);
});

workflow.setEmitter(emitLog);
require('./services/broadcastDelivery').setEmitter(emitLog);

// ── Protected API Routes ──────────────────────────────────────────────────────
app.use('/api/products',  isAuthenticated, require('./routes/products'));
app.use('/api/send',      isAuthenticated, require('./routes/send'));
app.use('/api/schedules', isAuthenticated, require('./routes/schedules'));
app.use('/api/subjects',  isAuthenticated, require('./routes/subjects'));
app.use('/api/scrape',    isAuthenticated, require('./routes/scrape'));
app.use('/api/facebook',      isAuthenticated, require('./routes/facebook'));
app.use('/api/prompt',        isAuthenticated, require('./routes/prompt'));
app.use('/api/aliexpress',        isAuthenticated, require('./routes/aliexpress-api'));
app.use('/api/affiliates',        isAuthenticated, require('./routes/affiliates'));
app.use('/api/discover',          isAuthenticated, require('./routes/discover'));
app.use('/api/users',             isAuthenticated, require('./routes/users'));
app.use('/api/broadcasts',        isAuthenticated, require('./routes/broadcasts'));
app.use('/api/analytics',         isAuthenticated, require('./routes/analytics'));
app.use('/api/whatsapp-service',  isAuthenticated, require('./routes/whatsapp-service'));
app.use('/api/settings',          isAuthenticated, require('./routes/settings'));

// ── Static + SPA Fallback ─────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4562;

app.listen(PORT, async () => {
  console.log(`\n🎯 Affiliate Heaven running at http://localhost:${PORT}\n`);
  if (process.env.DATABASE_URL) {
    await migrate().catch(err => console.error('[db] Migration failed:', err.stack || err.message));
    // Belt-and-suspenders: ensure the subjects.timezone column exists even if the
    // main migration was interrupted before reaching that step on a previous deploy.
    try {
      await dbQuery(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Jerusalem'`);
    } catch (err) {
      console.warn('[db] Could not ensure subjects.timezone column:', err.message);
    }
  } else {
    console.warn('[db] DATABASE_URL not set — skipping DB migration');
  }
  scheduler.setLogger(workflow.log);
  scheduler.setWorkflowRunner((opts) => workflow.run(null, opts || {}));
  const count = await scheduler.startAll();
  console.log(`📅 ${count} schedule(s) loaded`);
  const bcount = await scheduler.startBroadcasts();
  console.log(`📡 ${bcount} broadcast(s) loaded\n`);
});
