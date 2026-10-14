# JeanZie String HeArts — Website + Admin

- **Showcase** (`/`): customers browse your crochet pieces. No login, no ordering.
- **Admin** (`/admin`): you log in with a password to add, edit and remove products, upload photos, update stock, hide pieces, and set your contact link.

Changes you make in the admin show on the website for everyone within a few seconds.

## What's in this folder
| Path | What it is |
|---|---|
| `index.html` | The showcase website |
| `admin.html` | The admin page (opens at `/admin`) |
| `api/` | Small server code that Vercel runs: login, products, photos, activity log |
| `assets/shared.js` | Crochet illustrations + shared helpers |
| `images/` | Your logo and favicon |
| `vercel.json`, `package.json`, `robots.txt` | Settings for Vercel and search engines |

## One-time setup on Vercel (about 5 minutes)

### 1. Upload the files to GitHub
Open your repository on GitHub → **Add file → Upload files**. Drag in **everything inside this folder**, including the `api`, `assets` and `images` folders. Click **Commit changes**. (It's fine to replace the old `index.html`.)

### 2. Add the free database
In Vercel, open your project → **Storage** tab → **Create Database** → choose **Upstash** (Redis) → pick the free plan → **Connect** it to this project. Vercel adds the database keys for you automatically.

### 3. Set your admin password
Project → **Settings → Environment Variables** → add:
- **Key:** `ADMIN_PASSWORD`
- **Value:** a long password only you know, e.g. 3–4 random words like `yarn-mango-teapot-river`

Click **Save**.

### 4. Redeploy
Project → **Deployments** → on the latest one click **⋯ → Redeploy**. (New settings only apply after a redeploy.)

### 5. Log in
Go to `https://YOUR-SITE.vercel.app/admin` and enter your password.

## Using the admin
- **+ Add product:** photos (first one is the main photo, up to 6), name, price, category, description, material, days to make, options (colors or sizes) with how many you have of each.
- **Stock:** quick +/− for each color/size.
- **Edit:** change anything, reorder or remove photos, or tick **Hide from website** to hide a piece without deleting it.
- **Remove:** deletes the product and its photos for good.
- **Remove sample products:** clears the example pieces that come with the site.
- **Settings:** low-stock warning level, categories, and your contact link (e.g. Facebook page) for the "Message us" button.
- **Export CSV:** download your stock list for Excel or Google Sheets.

## Security
- Your password lives only in Vercel's settings — it is never inside the website's code.
- After 5 wrong passwords, logins from that device are locked for 15 minutes.
- You stay logged in for 8 hours, then need to log in again. Use **Log out** on shared computers.
- Turn on two-step login for your GitHub and Vercel accounts — they control the whole site.
- To change your password: edit `ADMIN_PASSWORD` in Vercel and redeploy. Everyone logged in gets logged out.

## Free plan limits
The free Upstash database holds 250 MB — roughly a few hundred product photos, since photos are shrunk automatically before upload.
