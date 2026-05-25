function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, { attempts = 3, delayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(delayMs);
    }
  }
  throw lastErr;
}

module.exports = { sleep, withRetry };
