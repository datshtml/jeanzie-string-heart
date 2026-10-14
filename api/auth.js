// GET    /api/auth  -> is this browser logged in?
// POST   /api/auth  -> log in with { password }
// DELETE /api/auth  -> log out
const L = require("./_lib");
const MAX_TRIES = 5, LOCK_SECONDS = 15 * 60;

module.exports = L.wrap(async (req, res) => {
  if (req.method === "GET") {
    return L.send(res, 200, {
      admin: L.isAdmin(req),
      passwordSet: !!process.env.ADMIN_PASSWORD,
      databaseConnected: !!((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN))
    });
  }

  if (req.method === "DELETE") {
    return L.send(res, 200, { ok: true }, { "Set-Cookie": L.clearSessionCookie() });
  }

  if (req.method === "POST") {
    if (!process.env.ADMIN_PASSWORD) return L.send(res, 503, { error: "The admin password hasn't been set up yet. Add ADMIN_PASSWORD in your Vercel project settings, then redeploy." });
    const failKey = L.K.fail(L.clientIp(req));
    const fails = parseInt(await L.redis("GET", failKey), 10) || 0;
    if (fails >= MAX_TRIES) {
      const ttl = await L.redis("TTL", failKey);
      return L.send(res, 429, { error: `Too many wrong passwords. Try again in ${Math.max(1, Math.ceil((ttl > 0 ? ttl : LOCK_SECONDS) / 60))} minutes.` });
    }
    const { password } = await L.readBody(req);
    // Small delay makes guessing slower.
    await new Promise(r => setTimeout(r, 400));
    if (!L.passwordMatches(password)) {
      const n = await L.redis("INCR", failKey);
      if (n === 1) await L.redis("EXPIRE", failKey, LOCK_SECONDS);
      const left = MAX_TRIES - n;
      return L.send(res, 401, { error: left > 0 ? `Wrong password. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong passwords. Try again in 15 minutes." });
    }
    await L.redis("DEL", failKey);
    await L.addLog("Admin logged in");
    return L.send(res, 200, { ok: true }, { "Set-Cookie": L.makeSessionCookie() });
  }

  L.send(res, 405, { error: "Method not allowed" });
});
