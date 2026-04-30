# C&R Field Receiving

iPad web app for HVAC techs to receive vendor deliveries (Daikin, Coburns) on the
job site and mark Purchase Orders as Received in ServiceTitan — without going
back to a computer.

Runs in Safari on iPad (iOS 16+). No native install. Pure HTML/CSS/JS.

## V1 Workflow

1. Tech opens app in Safari on iPad
2. Picks an open PO from the filtered list (vendor = Daikin / Coburns, status = Sent / Pending)
3. Sees the expected line items
4. Scans each box barcode with the iPad camera → item gets checked off
5. For equipment items, app prompts for the serial number (scan or type)
6. Enters the vendor invoice / document # (e.g. `HQ88066`)
7. Taps **Confirm & Receive** → ServiceTitan POST /receipts → PO marked Received

## Project layout

```
Field Recieving App/
├── index.html              App shell, all four views (list/detail/success/error)
├── css/app.css             iPad-first styles, C&R brand
├── js/api.js               ServiceTitan client + mock data toggle
├── js/scanner.js           Camera barcode scan (BarcodeDetector + ZXing fallback)
├── js/app.js               View routing, state, PO list/detail/submit logic
├── worker/
│   ├── index.js            Cloudflare Worker proxy (holds Client Secret)
│   └── wrangler.toml       Worker config + ALLOWED_ORIGIN
└── README.md
```

## Run locally (mock data)

The app ships with `CONFIG.useMock = true` in `js/api.js`, so you can validate the
UI without any credentials wired up.

```bash
cd "Field Recieving App"
python3 -m http.server 8080
# then open http://localhost:8080 on your laptop, or
# http://<your-laptop-ip>:8080 on the iPad over the same Wi-Fi
```

Camera access requires HTTPS on iOS (localhost is exempt on a desktop, but on
iPad you'll need the GitHub Pages URL or a tunnel like `cloudflared` to test
the scanner).

## Wire up live ServiceTitan

### 1. Deploy the Cloudflare Worker proxy

```bash
cd worker
npm install -g wrangler          # one-time
wrangler login

# Set the secrets — these stay on Cloudflare, never on the iPad:
wrangler secret put ST_CLIENT_ID
wrangler secret put ST_CLIENT_SECRET
wrangler secret put ST_TENANT_ID
wrangler secret put ST_APP_KEY    # the App Key from the ST developer portal

wrangler deploy
```

Wrangler prints a URL like `https://cr-st-proxy.<account>.workers.dev`.

### 2. Point the client at the Worker

Edit `js/api.js`:

```js
window.CONFIG = {
  useMock: false,                                              // flip to false
  tenantId: '4029621142',
  proxyBase: 'https://cr-st-proxy.<account>.workers.dev',      // your Worker URL
  ...
};
```

### 3. Lock CORS

Edit `worker/wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGIN = "https://ligon4594.github.io"
```

Re-deploy with `wrangler deploy`.

## Deploy the iPad app to GitHub Pages

```bash
git init
git add .
git commit -m "Initial scaffold of Field Receiving app"
git branch -M main
git remote add origin https://github.com/ligon4594/cr-field-receiving.git
git push -u origin main
```

Then in GitHub: **Settings → Pages → Source: `main` / root → Save**.

The site will be live at `https://ligon4594.github.io/cr-field-receiving/`.

## Add to iPad home screen

In Safari on the iPad: **Share → Add to Home Screen**. The app launches
fullscreen with the C&R logo.

## Business rules baked in

- Vendor allowlist: `Daikin Comfort`, `Coburns` (in `CONFIG.allowedVendors`)
- Status allowlist: `Sent`, `Pending`
- Equipment line items must capture a serial number before confirming
- Vendor document # is required before submit is enabled
- A scan that doesn't match any line item shows a "No match found" warning —
  it never silently succeeds
- Running progress shown as `X / Y items confirmed` on the detail screen

## Style

- Navy bg `#0a1628`, orange accent `#E87722`, cream highlight `#F5E3B3`
- All touch targets ≥ 56px (gloved hands)
- High contrast text for outdoor sun
- No hover-dependent UI

## Not in V1

- Invoice OCR
- Offline mode
- Creating new POs
- Bulk operations

## Testing the error path

While in mock mode, type `FAIL` as the vendor document # and submit — the mock
API will throw, exercising the error view + Retry flow.

## Troubleshooting

- **CORS error from the Worker**: the iPad's origin isn't in `ALLOWED_ORIGIN`.
  Update `worker/wrangler.toml` and redeploy.
- **Camera doesn't open on iPad**: the page must be served over HTTPS. GitHub
  Pages or `cloudflared tunnel` will do it; plain `python -m http.server` on
  your laptop won't.
- **Token errors**: check the Worker logs with `wrangler tail`. The most common
  cause is a typo in one of the four secrets.
- **PO list is empty**: double-check the PO's vendor name in ServiceTitan
  matches `Daikin Comfort` / `Coburns` exactly (case-insensitive contains).
