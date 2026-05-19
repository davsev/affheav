import fs from 'fs';
import path from 'path';

export default function globalSetup() {
  const authDir = path.join(__dirname, 'playwright/.auth');
  const authFile = path.join(authDir, 'admin.json');
  fs.mkdirSync(authDir, { recursive: true });
  // Write empty-but-valid storage state so Playwright doesn't error on read
  // before auth.setup.ts runs and overwrites it with a real session.
  if (!fs.existsSync(authFile)) {
    fs.writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }));
  }
}
