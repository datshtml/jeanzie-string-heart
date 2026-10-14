// GET /api/log -> recent admin changes (admin only)
const L = require("./_lib");

module.exports = L.wrap(async (req, res) => {
  if (req.method !== "GET") return L.send(res, 405, { error: "Method not allowed" });
  if (!L.requireAdmin(req, res)) return;
  const rows = (await L.redis("LRANGE", L.K.log, 0, 59)) || [];
  L.send(res, 200, { log: rows.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean) });
});
