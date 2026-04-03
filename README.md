# SnapReceipt

A mobile-first receipt capture PWA built with Next.js App Router, TypeScript, Tailwind, and Supabase.

## What it does

- Opens directly to `/camera`
- Uses the phone camera with a full-screen capture UI
- Lets the user preview the photo before saving
- Uploads the image to the Supabase `receipts` storage bucket
- Inserts a matching row into the `receipts` table
- Supports optional folder selection, inline folder creation, and last-used folder memory
- Shows a searchable receipts list and a receipt detail screen
- Includes installable PWA metadata and a lightweight service worker

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file:

```bash
cp .env.example .env.local
```

3. Fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

4. In Supabase, enable:

- Email authentication in Authentication > Providers
- Your desired email flow in Supabase Auth, such as magic link or email OTP
- A Storage bucket named `receipts` if you do not run the SQL migration through the CLI

5. Run the SQL in `supabase/migrations/001_initial_schema.sql`

6. Start the app:

```bash
npm run dev
```

7. Open `http://localhost:3000` on your phone.

For camera testing on a real device, use HTTPS or a secure local tunnel if your phone is not on the same trusted local network.

## Supabase schema

The migration creates:

- `folders`
- `receipts`
- row-level security policies scoped to `auth.uid()`
- the `receipts` storage bucket
- storage policies so each user only accesses files inside their own `<user-id>/...` folder path

## Project structure

- `src/app/camera/page.tsx` camera-first capture screen
- `src/app/receipts/page.tsx` searchable receipts list
- `src/app/receipts/[id]/page.tsx` receipt detail screen
- `src/lib/receipt-service.ts` Supabase storage and database calls
- `src/lib/supabase/*` Supabase client and anonymous session bootstrap
- `supabase/migrations/001_initial_schema.sql` database and storage setup

## Notes

- OCR is intentionally stubbed for now with placeholder extracted fields.
- The app saves immediately after capture without forcing folder selection.
- Receipt images are stored privately and rendered through signed URLs.
- The app now uses persisted Supabase email sessions, so returning users stay signed in on the same browser/device.
