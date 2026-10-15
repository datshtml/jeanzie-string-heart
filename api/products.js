// GET    /api/products            -> public list of visible products + settings
// GET    /api/products?admin=1    -> full list incl. hidden (admin only)
// POST   /api/products            -> { product } create | { action:"stock", id, variants } | { action:"settings", ... } | { action:"removeSamples" } | { action:"scan", code, delta, variant? }
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
    if (q.sales) {
      if (!L.requireAdmin(req, res)) return;
      const rows = (await L.redis("LRANGE", L.K.sales, 0, 199)) || [];
      return L.send(res, 200, { sales: rows.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean) });
    }
    if (q.admin) {
      if (!L.requireAdmin(req, res)) return;
      if (L.ensureCodes(products)) await L.saveProducts(products);
      return L.send(res, 200, { products, settings });
    }
    const visible = products.filter(p => !p.hidden).map(({ code, ...p }) => p);
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

    if (body.action === "scan") {
      // Scanned barcode: sell (-1) or restock (+1) one piece.
      if (L.ensureCodes(products)) await L.saveProducts(products);
      const code = String(body.code || "").trim().toUpperCase();
      const delta = body.delta === 1 ? 1 : -1;
      const p = products.find(x => x.code === code);
      if (!p) return L.send(res, 404, { error: L.CODE_RE.test(code) ? "This barcode isn't linked to any product. It may belong to a removed product." : "That's not a JeanZie barcode." });
      const names = Object.keys(p.variants);
      let v = body.variant;
      if (v !== undefined && !names.includes(v)) return L.send(res, 400, { error: "That option no longer exists." });
      if (v === undefined) {
        if (names.length === 1) v = names[0];
        else if (delta < 0) {
          const inStock = names.filter(n => p.variants[n] > 0);
          if (inStock.length === 1) v = inStock[0];
          else if (inStock.length === 0) return L.send(res, 409, { error: `${p.name} is already sold out.`, product: p });
        }
        if (v === undefined) return L.send(res, 200, { needVariant: true, product: p });
      }
      const before = p.variants[v];
      if (delta < 0 && before <= 0) return L.send(res, 409, { error: `${p.name}${names.length > 1 ? " — " + v : ""} is already at 0.`, product: p });
      p.variants[v] = Math.min(99999, before + delta);
      p.updatedAt = new Date().toISOString();
      await L.saveProducts(products);
      await L.addLog(`${delta < 0 ? "Sold (scan)" : "Restocked (scan)"}: ${p.name}${names.length > 1 ? " — " + v : ""} ${before}→${p.variants[v]}`);
      return L.send(res, 200, { product: p, variant: v, before, after: p.variants[v], delta });
    }

    if (body.action === "sale") {
      // Checkout: deduct every item in the cart at once and save a receipt.
      const input = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
      if (!input.length) return L.send(res, 400, { error: "The cart is empty." });
      const lines = [];
      for (const it of input) {
        const p = products.find(x => x.id === it.id);
        if (!p) return L.send(res, 404, { error: "An item in the cart no longer exists. Remove it and try again." });
        const v = String(it.variant ?? "");
        if (!(v in p.variants)) return L.send(res, 400, { error: `“${v}” no longer exists for ${p.name}. Remove it and try again.` });
        const qty = Math.max(1, Math.min(999, parseInt(it.qty, 10) || 1));
        const same = lines.find(l => l.p === p && l.variant === v);
        if (same) same.qty += qty; else lines.push({ p, variant: v, qty });
      }
      for (const l of lines) {
        if (l.p.variants[l.variant] < l.qty) {
          const multi = Object.keys(l.p.variants).length > 1;
          return L.send(res, 409, { error: `Only ${l.p.variants[l.variant]} left of ${l.p.name}${multi ? " — " + l.variant : ""}. Adjust the cart and try again.` });
        }
      }
      const total = lines.reduce((a, l) => a + l.p.price * l.qty, 0);
      const method = ["Cash", "GCash", "Card", "Other"].includes(body.method) ? body.method : "Cash";
      const cash = method === "Cash" ? Math.max(0, Math.round(Number(body.cash) || 0)) : 0;
      if (method === "Cash" && cash && cash < total) return L.send(res, 400, { error: "Cash received is less than the total." });
      const now = new Date().toISOString();
      for (const l of lines) { l.p.variants[l.variant] -= l.qty; l.p.updatedAt = now; }
      const no = await L.redis("INCR", L.K.receiptNo);
      const sale = {
        no: "R-" + String(no).padStart(5, "0"), t: now, method, total,
        cash: cash || 0, change: cash ? cash - total : 0, voided: false,
        items: lines.map(l => ({ id: l.p.id, name: l.p.name, variant: l.variant, multi: Object.keys(l.p.variants).length > 1, price: l.p.price, qty: l.qty }))
      };
      await L.saveProducts(products);
      await L.redis("LPUSH", L.K.sales, JSON.stringify(sale));
      await L.redis("LTRIM", L.K.sales, 0, 1999);
      const count = lines.reduce((a, l) => a + l.qty, 0);
      await L.addLog(`Sale ${sale.no}: ${count} item${count === 1 ? "" : "s"}, ₱${total.toLocaleString("en-PH")} (${method})`);
      return L.send(res, 201, { sale });
    }

    if (body.action === "voidSale") {
      // Cancels a sale and puts the items back in stock.
      const rows = (await L.redis("LRANGE", L.K.sales, 0, 1999)) || [];
      const i = rows.findIndex(r => { try { return JSON.parse(r).no === body.no; } catch { return false; } });
      if (i < 0) return L.send(res, 404, { error: "Receipt not found." });
      const sale = JSON.parse(rows[i]);
      if (sale.voided) return L.send(res, 400, { error: "This sale was already voided." });
      for (const it of sale.items) {
        const p = products.find(x => x.id === it.id);
        if (p && it.variant in p.variants) { p.variants[it.variant] = Math.min(99999, p.variants[it.variant] + it.qty); p.updatedAt = new Date().toISOString(); }
      }
      sale.voided = true; sale.voidedAt = new Date().toISOString();
      await L.saveProducts(products);
      await L.redis("LSET", L.K.sales, i, JSON.stringify(sale));
      await L.addLog(`Voided sale ${sale.no} — items returned to stock`);
      return L.send(res, 200, { sale });
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
    L.ensureCodes(products); // new product gets its barcode automatically
    await L.saveProducts(products);
    await L.addLog(`Added: ${p.name} (${p.id})`);
    return L.send(res, 201, { product: p });
  }

  if (req.method === "PUT") {
    const i = products.findIndex(x => x.id === q.id);
    if (i < 0) return L.send(res, 404, { error: "Product not found." });
    const old = products[i];
    const p = L.cleanProduct(body.product, old.id);
    p.code = old.code; // barcode never changes, so printed labels keep working
    await deleteImages((old.images || []).filter(u => !p.images.includes(u)));
    products[i] = p;
    L.ensureCodes(products);
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
