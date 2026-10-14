// Shared helpers for the API. Files starting with "_" are not exposed as endpoints on Vercel.
const crypto = require("crypto");

/* ---------------- Database (Upstash Redis over REST, no packages needed) ---------------- */
const DB_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const DB_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(...command) {
  if (!DB_URL || !DB_TOKEN) {
    const err = new Error("Database not connected. Add an Upstash Redis database in your Vercel project's Storage tab.");
    err.status = 503;
    throw err;
  }
  const r = await fetch(DB_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${DB_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const err = new Error("Database error: " + (data.error || r.status));
    err.status = 502;
    throw err;
  }
  return data.result;
}

const K = {
  products: "jsh:products",
  settings: "jsh:settings",
  log: "jsh:log",
  img: id => "jsh:img:" + id,
  fail: ip => "jsh:fail:" + ip
};

/* ---------------- Request / response helpers ---------------- */
function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== "") {
    if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
    if (Buffer.isBuffer(req.body)) { try { return JSON.parse(req.body.toString("utf8")); } catch { return {}; } }
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 4 * 1024 * 1024) throw Object.assign(new Error("Upload too large"), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

function getQuery(req) {
  if (req.query) return req.query;
  const u = new URL(req.url, "http://x");
  return Object.fromEntries(u.searchParams);
}

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  return (xf ? String(xf).split(",")[0] : req.socket?.remoteAddress || "unknown").trim();
}

/* ---------------- Admin session (signed cookie) ---------------- */
const COOKIE = "jsh_admin";
const SESSION_HOURS = 8;

function secretKey() {
  const pw = process.env.ADMIN_PASSWORD || "";
  return crypto.createHash("sha256").update("jsh-session|" + (process.env.SESSION_SECRET || "") + "|" + pw).digest();
}
function sign(value) {
  return crypto.createHmac("sha256", secretKey()).update(value).digest("hex");
}
function makeSessionCookie() {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const token = `${exp}.${sign("admin." + exp)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}
function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
function isAdmin(req) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const raw = req.headers.cookie || "";
  const m = raw.split(/;\s*/).find(c => c.startsWith(COOKIE + "="));
  if (!m) return false;
  const [exp, sig] = m.slice(COOKIE.length + 1).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign("admin." + exp);
  const a = Buffer.from(sig, "hex"), b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Blocks requests from other websites: browsers won't send this custom header cross-site.
function requireAdmin(req, res) {
  if (!isAdmin(req)) { send(res, 401, { error: "Please log in again." }); return false; }
  if (req.method !== "GET" && req.headers["x-jsh"] !== "1") { send(res, 403, { error: "Request blocked." }); return false; }
  return true;
}
function passwordMatches(input) {
  const pw = process.env.ADMIN_PASSWORD || "";
  const a = crypto.createHash("sha256").update(String(input || "")).digest();
  const b = crypto.createHash("sha256").update(pw).digest();
  return pw.length > 0 && crypto.timingSafeEqual(a, b);
}

/* ---------------- Data ---------------- */
const { SEED_PRODUCTS } = require("./_seed");
const DEFAULT_SETTINGS = { threshold: 3, categories: ["Amigurumi", "Wearables", "Bags", "Gifts & Home"] };

async function getProducts() {
  const raw = await redis("GET", K.products);
  if (raw === null || raw === undefined) {
    await redis("SET", K.products, JSON.stringify(SEED_PRODUCTS));
    return JSON.parse(JSON.stringify(SEED_PRODUCTS));
  }
  try { return JSON.parse(raw); } catch { return []; }
}
async function saveProducts(list) { await redis("SET", K.products, JSON.stringify(list)); }
async function getSettings() {
  const raw = await redis("GET", K.settings);
  try { return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) }; } catch { return { ...DEFAULT_SETTINGS }; }
}
async function addLog(msg) {
  await redis("LPUSH", K.log, JSON.stringify({ t: new Date().toISOString(), msg: String(msg).slice(0, 400) }));
  await redis("LTRIM", K.log, 0, 199);
}

const IMG_RE = /^\/api\/image\?id=[a-f0-9]{24}$/;
const imgId = url => (IMG_RE.test(url) ? url.split("=")[1] : null);
const TYPES = ["bear", "bunny", "chick", "beanie", "top", "cardigan", "tote", "sling", "coaster", "blanket", "bouquet", "keychain", "scrunchie", "yarn"];

function str(v, max) { return String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max); }
// Like str() but keeps line breaks (for descriptions).
function text(v, max) { return String(v ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max); }
function cleanProduct(input, existingId) {
  const p = input || {};
  const variants = {};
  const vin = p.variants && typeof p.variants === "object" ? p.variants : {};
  for (const [k, v] of Object.entries(vin).slice(0, 30)) {
    const name = str(k, 40);
    if (name) variants[name] = Math.max(0, Math.min(99999, parseInt(v, 10) || 0));
  }
  if (!Object.keys(variants).length) variants["One size"] = 0;
  const images = (Array.isArray(p.images) ? p.images : []).filter(u => IMG_RE.test(u)).slice(0, 6);
  return {
    id: existingId || ("JSH-" + crypto.randomBytes(3).toString("hex").toUpperCase()),
    name: str(p.name, 80) || "Untitled piece",
    category: str(p.category, 40) || "Gifts & Home",
    type: TYPES.includes(p.type) ? p.type : "yarn",
    price: Math.max(0, Math.min(1000000, Math.round(Number(p.price) || 0))),
    color: /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : "#e5391a",
    material: str(p.material, 80),
    makeDays: Math.max(0, Math.min(365, parseInt(p.makeDays, 10) || 0)),
    tag: str(p.tag, 24),
    isNew: !!p.isNew,
    hidden: !!p.hidden,
    sample: false,
    description: text(p.description, 1500),
    variantLabel: str(p.variantLabel, 20) || "Variant",
    variants,
    images,
    updatedAt: new Date().toISOString()
  };
}

function wrap(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (e) { send(res, e.status || 500, { error: e.status ? e.message : "Something went wrong. Please try again." }); if (!e.status) console.error(e); }
  };
}

module.exports = { redis, K, send, readBody, getQuery, clientIp, makeSessionCookie, clearSessionCookie, isAdmin, requireAdmin, passwordMatches, getProducts, saveProducts, getSettings, addLog, cleanProduct, imgId, wrap, DEFAULT_SETTINGS };
