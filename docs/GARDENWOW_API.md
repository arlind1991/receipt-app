# SnapReceipt → GardenWow platform API

How SnapReceipt (receipts.gardenwow.uk) sends a scanned receipt into the GardenWow platform as a
**job cost**, attached to a client and optionally a visit. These are server-to-server calls: SnapReceipt's
server calls the platform. The browser never does.

Base URL: `https://app.gardenwow.uk/api/integrations/snapreceipt`

## Auth

Every request sends:

```
Authorization: Bearer <SNAPRECEIPT_API_KEY>
```

- The key is set on the platform (`SNAPRECEIPT_API_KEY`, plus `SNAPRECEIPT_COMPANY_ID` for the GardenWow
  company) and copied into SnapReceipt's **server** environment.
- SnapReceipt is a public, multi-account app. Only the GardenWow owner's account should ever reach these
  calls, so gate the feature on that account server-side. Never send the key to a browser.
- Wrong or missing key → `401 {"error":"unauthorized"}`. Platform not configured →
  `500 {"error":"not_configured"}`.
- To rotate the key, change it in both places (Vercel env for the platform, then redeploy).

## 1. Find a client

`GET /clients?q=<text>`

Matches name, organisation, email, or a property's postcode / first address line. Returns up to 20,
sorted by name. With no `q`, it returns the first 20 by name.

```json
200 {
  "clients": [
    { "id": "3f0c…", "name": "The Grange", "organisationName": "The Grange Estate",
      "addressLine1": "57 Woodford Road", "postcode": "E18 2EY" }
  ]
}
```

## 2. List a client's visits around the receipt date

`GET /clients/{clientId}/visits?around=YYYY-MM-DD`

Lists visits from 14 days before to 7 days after `around` (default: today, UK). Offer these so the user
can pick the visit the materials were for, or "no visit".

```json
200 {
  "visits": [
    { "id": "9a1d…", "date": "2026-10-20", "slot": "am", "status": "scheduled",
      "serviceLabel": "Garden maintenance", "address": "57 Woodford Road, E18 2EY" }
  ]
}
```

- Unknown client → `404`.
- Bad `around` → `400`.

## 3. Send a receipt

`POST /receipts` as `multipart/form-data`:

| Field | Required | Notes |
|---|---|---|
| `photo` | yes | The receipt image file. JPEG, PNG or WebP, max 10 MB. It's checked by content, not just type. **Convert HEIC to JPEG first.** |
| `externalId` | yes | SnapReceipt's own receipt id: 1–200 chars of `A-Z a-z 0-9 . _ : -`. This makes retries safe (see below). |
| `clientId` | yes | From call 1. |
| `visitId` | no | From call 2. It must be one of that client's visits. |
| `merchant` | no | Up to 200 chars. |
| `receiptDate` | yes | `YYYY-MM-DD`. |
| `totalPence` | yes | **Whole number of pence, VAT included**, as printed. £12.34 → `1234`. Convert the AI's decimal with `Math.round(value * 100)`. |
| `vatPence` | no | The VAT part in pence, when the receipt shows it. Must be ≤ `totalPence`. |
| `currency` | no | ISO 4217, default `GBP`. Non-GBP receipts are stored but left out of the platform's £ totals. |
| `notes` | no | Up to 2000 chars. |

Responses:

- `201 {"id":"…","created":true}`: stored.
- `200 {"id":"…","created":false}`: this `externalId` was already received. Nothing changed (it's a
  retry). To correct a receipt, delete it (call 4) and send it again.
- `400 {"error":"Invalid receipt","fields":{"totalPence":"…"}}`: fix the input. A retry won't help.
- `422`: the client or visit can't be used (e.g. the visit belongs to another client).
- `502`: the photo couldn't be stored. Nothing was kept, so retry.
- `500`: platform error. Retry later.

Example (Node, server side):

```ts
const form = new FormData();
form.set('photo', new Blob([jpegBytes], { type: 'image/jpeg' }), 'receipt.jpg');
form.set('externalId', receipt.id);
form.set('clientId', clientId);
if (visitId) form.set('visitId', visitId);
form.set('merchant', receipt.merchant);
form.set('receiptDate', receipt.date);            // 'YYYY-MM-DD'
form.set('totalPence', String(Math.round(receipt.total * 100)));
if (receipt.vat != null) form.set('vatPence', String(Math.round(receipt.vat * 100)));
form.set('currency', receipt.currency ?? 'GBP');

const res = await fetch(`${BASE}/receipts`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.GARDENWOW_API_KEY}` },
  body: form,
});
```

## 4. Undo a receipt

`DELETE /receipts/{externalId}` removes the receipt and its photo from the platform.

- `200 {"deleted":true}`
- `404`: never received, or already deleted.

## Where it shows up in the platform

Admin/office only. Gardeners and clients never see costs.

- **Visit page:** the Costs section lists receipts on that visit. Each can be moved to another of the
  client's visits, or deleted.
- **Client page:** the Costs section lists all the client's receipts, with this-month and all-time totals
  (inc VAT, VAT and ex-VAT) and the visit each one belongs to.

Data: the `public.job_costs` table and the private `job-cost-receipts` storage bucket
(`supabase/migrations/20261017140000_job_costs.sql`).
