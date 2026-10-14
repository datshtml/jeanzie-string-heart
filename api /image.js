// GET  /api/image?id=ID  -> the photo
// POST /api/image        -> { data: "data:image/jpeg;base64,..." } upload (admin only). Returns { url }.
// Photos are resized in the browser before upload, so each is usually 100–400 KB.
const crypto = require("crypto");
const L = require("./_lib");
const MAX_BYTES = 2.5 * 1024 * 1024;

module.exports = L.wrap(async (req, res) => {
  if (req.method === "GET") {
    const id = String(L.getQuery(req).id || "");
    if (!/^[a-f0-9]{24}$/.test(id)) return L.send(res, 400, { error: "Bad id" });
    const data = await L.redis("GET", L.K.img(id));
    if (!data) return L.send(res, 404, { error: "Not found" });
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(data);
    if (!m) return L.send(res, 404, { error: "Not found" });
    const buf = Buffer.from(m[2], "base64");
    res.statusCode = 200;
    res.setHeader("Content-Type", m[1]);
    res.setHeader("Content-Length", buf.length);
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Each upload gets a new id, so photos never change and can be cached forever.
    res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    return res.end(buf);
  }

  if (req.method === "POST") {
    if (!L.requireAdmin(req, res)) return;
    const { data } = await L.readBody(req);
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ""));
    if (!m) return L.send(res, 400, { error: "Please upload a JPG, PNG or WebP photo." });
    const bytes = Math.floor(m[2].length * 3 / 4);
    if (bytes > MAX_BYTES) return L.send(res, 413, { error: "That photo is too large even after resizing. Try a smaller one." });
    const id = crypto.randomBytes(12).toString("hex");
    await L.redis("SET", L.K.img(id), `data:${m[1]};base64,${m[2]}`);
    return L.send(res, 201, { url: `/api/image?id=${id}` });
  }

  if (req.method === "DELETE") {
    // Removes a photo that was uploaded but never saved to a product (e.g. editor cancelled).
    if (!L.requireAdmin(req, res)) return;
    const id = String(L.getQuery(req).id || "");
    if (!/^[a-f0-9]{24}$/.test(id)) return L.send(res, 400, { error: "Bad id" });
    const used = (await L.getProducts()).some(p => (p.images || []).includes(`/api/image?id=${id}`));
    if (!used) await L.redis("DEL", L.K.img(id));
    return L.send(res, 200, { ok: true, kept: used });
  }

  L.send(res, 405, { error: "Method not allowed" });
});
