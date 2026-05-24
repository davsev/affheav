require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const workflow = require('./services/workflow');
const scheduler = require('./scheduler');
const { appendLogs, getRecentLogs } = require('./services/googleSheets');
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
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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
app.get('/api/me', (req, res) => {
  if (!req.isAuthenticated() || !req.user) return res.status(401).json({ success: false });
  const { id, email, name, photo, role } = req.user;
  res.json({ success: true, user: { id, email, name, photo, role } });
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
const sseClients = new Set();
const logHistory = [];
const LOG_HISTORY_MAX = 500;

// Buffer for pending log entries not yet flushed to Google Sheets
let _pendingLogs = [];

app.get('/api/logs', isAuthenticated, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  for (const entry of logHistory) res.write(`data: ${JSON.stringify(entry)}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Persistent log history from Google Sheets (authenticated)
app.get('/api/logs/history', isAuthenticated, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const logs = await getRecentLogs(limit);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function emitLog(entry) {
  logHistory.push(entry);
  if (logHistory.length > LOG_HISTORY_MAX) logHistory.shift();
  _pendingLogs.push(entry);
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of sseClients) client.write(data);
}

// Flush pending logs to Google Sheets every 60 seconds
setInterval(async () => {
  if (_pendingLogs.length === 0) return;
  const batch = _pendingLogs.splice(0);
  await appendLogs(batch);
}, 60 * 1000);

// Flush on graceful shutdown
process.on('SIGTERM', async () => {
  if (_pendingLogs.length > 0) {
    await appendLogs(_pendingLogs.splice(0));
  }
  process.exit(0);
});

workflow.setEmitter(emitLog);

// ── Protected API Routes ──────────────────────────────────────────────────────
app.use('/api/products',  isAuthenticated, require('./routes/products'));
app.use('/api/send',      isAuthenticated, require('./routes/send'));
app.use('/api/schedules', isAuthenticated, require('./routes/schedules'));
app.use('/api/subjects',  isAuthenticated, require('./routes/subjects'));
app.use('/api/scrape',    isAuthenticated, require('./routes/scrape'));
app.use('/api/facebook',      isAuthenticated, require('./routes/facebook'));
app.use('/api/prompt',        isAuthenticated, require('./routes/prompt'));
app.use('/api/aliexpress',    isAuthenticated, require('./routes/aliexpress-api'));
app.use('/api/users',         isAuthenticated, require('./routes/users'));

// ── Static + SPA Fallback ─────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`\n🎯 Affiliate Heaven running at http://localhost:${PORT}\n`);
  if (process.env.DATABASE_URL) {
    await migrate().catch(err => console.error('[db] Migration failed:', err.message));
  } else {
    console.warn('[db] DATABASE_URL not set — skipping DB migration');
  }
  scheduler.setWorkflowRunner((opts) => workflow.run(null, opts || {}));
  // opts contains { userId, subjectId } passed by the scheduler per job
  const count = await scheduler.startAll();
  console.log(`📅 ${count} schedule(s) loaded\n`);
});
