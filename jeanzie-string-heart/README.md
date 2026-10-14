# Jeanzie String Heart — Crochet Showcase + Stock Monitor

A static website for a handmade crochet business: a product showcase plus a stock monitor.
No login, no cart, no ordering. No build step — plain HTML/CSS/JS, so it runs on Vercel as-is.

## Pages
- **Showcase** (`/`) — hero, category tiles (Amigurumi, Wearables, Bags, Gifts & Home), product grid with filters, search and sorting, and a product popup showing material, make time and availability per color/size.
- **Stock Monitor** (`/#inventory`, or the "Stock Monitor" button) — totals (products, pieces on hand, retail value, low stock, sold out), pieces by category, a "needs restocking" list with make times, a sortable/filterable table, per-variant stock adjusting, a change log, and JSON/CSV export.

## Deploy to Vercel
**Option A — website**
1. Put this folder in a GitHub repo (or use the Vercel CLI below).
2. Go to https://vercel.com/new and import the repo.
3. Framework preset: **Other**. Leave build command and output directory empty.
4. Click **Deploy**.

**Option B — CLI**
```bash
npm i -g vercel
cd jeanzie-string-heart
vercel        # preview
vercel --prod # live site
```

## Editing products
Open `index.html` and find `DEFAULT_PRODUCTS` near the top of the `<script>`. Each product:

```js
{ id:"JSH-A01", name:"Honey Bear Plush", category:"Amigurumi", type:"bear",
  price:650, color:"#c98a4b", colorName:"Honey",
  material:"Milk cotton yarn, poly fill", makeDays:3,
  tag:"Bestseller", isNew:false, description:"...",
  variantLabel:"Color", variants:{Honey:4, Cocoa:2, Cream:3}, image:"" }
```

- `category`: Amigurumi, Wearables, Bags, Gifts & Home
- `type` (built-in illustration): bear, bunny, chick, beanie, top, cardigan, tote, sling, coaster, blanket, bouquet, keychain, scrunchie
- `image`: put your real product photos in `images/` and set e.g. `"images/honey-bear.jpg"`. Leave `""` to use the illustration.
- `variantLabel` + `variants`: pieces on hand per color or size.
- `makeDays`: roughly how long one piece takes — shown to visitors when something is sold out.

## How stock updates work
There's no backend or login, so changes made in the Stock Monitor are saved **in that browser only**.
To publish updated stock for everyone:
1. In the Stock Monitor, click **Export JSON**.
2. Paste the exported list over `DEFAULT_PRODUCTS` in `index.html`.
3. Redeploy (or push to GitHub if it's connected to Vercel).

**Reset** clears browser-saved changes and goes back to the numbers in the file.
The low stock threshold defaults to 3 pieces (handmade quantities are small) and can be changed on the page.

Note: the Stock Monitor link is visible to visitors. Since there's no login, anyone can view it, but any edits they make only affect their own browser — your published stock stays the same.
