// fetch with a hard timeout. A stalled upstream (Apify run-sync holding a
// connection open, a slow twitterapi call) must never block the whole cron past
// the serverless limit — abort it so the caller can fail that one call and the
// run still reaches finish().
export async function fetchWithTimeout(url, options = {}, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
