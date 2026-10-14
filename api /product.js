// GET    /api/products            -> public list of visible products + settings
// GET    /api/products?admin=1    -> full list incl. hidden (admin only)
// POST   /api/products            -> { product } create | { action:"stock", id, variants } | { action:"settings", ... } | { action:"removeSamples" }
// PUT    /api/products?id=ID      -> { product } update
// DELETE /api/products?id=ID      -> remove product and its photos
const L = require("./_lib");

const total = p => Object.values(p.variants || {}).reduce((a, b) => a + (+b || 0), 0);

async function deleteImages(urls) {
  for (const u of urls) { const id = L.imgId(u); if (id) await L.redis("DEL", L.K.img(id)); }
}

module.exports = L.wrap(async (req, res) => {
  const q = L.getQuery(req);

  if (req.method === "GET") {
    const [products, settings] = await Promise.all([L.getProducts(), L.getSettings()]);
    if (q.admin) {
      if (!L.requireAdmin(req, res)) return;
      return L.send(res, 200, { products, settings });
    }
    const visible = products.filter(p => !p.hidden);
    return L.send(res, 200, { products: visible, settings: { threshold: settings.threshold, categories: settings.categories, contactUrl: settings.contactUrl || "", contactText: settings.contactText || "" } },
      { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=30" });
  }

  if (!L.requireAdmin(req, res)) return;
  const body = await L.readBody(req);
  const products = await L.getProducts();

  if (req.method === "POST") {
    if (body.action === "stock") {
      const p = products.find(x => x.id === body.id);
      if (!p) return L.send(res, 404, { error: "Product not found." });
      const before = total(p), changes = [];
      for (const k of Object.keys(p.variants)) {
        if (body.variants && k in body.variants) {
          const v = Math.max(0, Math.min(99999, parseInt(body.variants[k], 10) || 0));
          if (v !== p.variants[k]) changes.push(`${k} ${p.variants[k]}→${v}`);
          p.variants[k] = v;
        }
      }
      if (changes.length) {
        p.updatedAt = new Date().toISOString();
        await L.saveProducts(products);
        await L.addLog(`Stock: ${p.name} — ${changes.join(", ")} (total ${before}→${total(p)})`);
      }
      return L.send(res, 200, { product: p });
    }

    if (body.action === "settings") {
      const cur = await L.getSettings();
      const next = { ...cur };
      if (body.threshold !== undefined) next.threshold = Math.max(0, Math.min(999, parseInt(body.threshold, 10) || 0));
      if (body.contactUrl !== undefined) {
        const u = String(body.contactUrl || "").trim().slice(0, 300);
        next.contactUrl = /^https:\/\/[^\s"'<>]+$/.test(u) ? u : "";
      }
      if (body.contactText !== undefined) next.contactText = String(body.contactText || "").trim().slice(0, 60);
      if (Array.isArray(body.categories)) {
        const cats = [...new Set(body.categories.map(c => String(c).trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
        if (cats.length) next.categories = cats;
      }
      await L.redis("SET", L.K.settings, JSON.stringify(next));
      await L.addLog("Settings updated");
      return L.send(res, 200, { settings: next });
    }

    if (body.action === "removeSamples") {
      const keep = products.filter(p => !p.sample);
      const removed = products.length - keep.length;
      await L.saveProducts(keep);
      await L.addLog(`Removed ${removed} sample products`);
      return L.send(res, 200, { removed });
    }

    if (products.length >= 500) return L.send(res, 400, { error: "Product limit reached (500)." });
    const p = L.cleanProduct(body.product);
    while (products.some(x => x.id === p.id)) p.id = L.cleanProduct({}).id;
    products.unshift(p);
    await L.saveProducts(products);
    await L.addLog(`Added: ${p.name} (${p.id})`);
    return L.send(res, 201, { product: p });
  }

  if (req.method === "PUT") {
    const i = products.findIndex(x => x.id === q.id);
    if (i < 0) return L.send(res, 404, { error: "Product not found." });
    const old = products[i];
    const p = L.cleanProduct(body.product, old.id);
    await deleteImages((old.images || []).filter(u => !p.images.includes(u)));
    products[i] = p;
    await L.saveProducts(products);
    await L.addLog(`Edited: ${p.name} (${p.id})`);
    return L.send(res, 200, { product: p });
  }

  if (req.method === "DELETE") {
    const p = products.find(x => x.id === q.id);
    if (!p) return L.send(res, 404, { error: "Product not found." });
    await deleteImages(p.images || []);
    await L.saveProducts(products.filter(x => x.id !== q.id));
    await L.addLog(`Removed: ${p.name} (${p.id})`);
    return L.send(res, 200, { ok: true });
  }

  L.send(res, 405, { error: "Method not allowed" });
});
