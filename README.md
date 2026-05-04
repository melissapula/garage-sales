# Garage Sale Tracker

A garage sale map and route-planning app — originally built for Bemidji, MN, but open to listings anywhere. Anyone can browse the map; signed-in users can post sales, save the ones they want to visit, build day-routes through them, and chat with sellers.

## Stack

- **Nuxt 4** + TypeScript + Tailwind CSS (mobile-first)
- **Supabase** — Postgres + Auth + Row-Level Security + Storage + pg_cron
- **Mapbox** — GL JS (map), Geocoding API (forward + reverse), Directions API, Optimization API
- **vuedraggable** for drag-and-drop stop reordering

Brand:

- Primary orange `#F97316`, secondary sky blue `#0EA5E9`
- Active pin `#22C55E`, upcoming pin `#EAB308`
- Cream background `#FFFBEB`
- Fonts: Playfair Display (display) + DM Sans (body)

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in:
    - `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
    - `MAPBOX_TOKEN`
    - `PUBLIC_SITE_URL` (defaults to `http://localhost:3000`)
3. Apply the SQL migrations in `supabase/migrations/` to your Supabase project, in order:
    - `0001_init.sql` — core tables + pg_cron cleanup job
    - `0002_saved_sales_and_routes.sql` — wishlist + route planner schema
    - `0003_storage_sale_photos.sql` — public photo bucket + RLS
    - `0004_profiles.sql` — profile table + signup trigger + backfill
    - `0005_messaging.sql` — contact toggle + message threads + RLS
    - `0006_sale_status.sql` — owner status column on sales
    - `0007_realtime_messaging.sql` — adds messaging tables to the Supabase Realtime publication
    - `0008_delete_account.sql` — `delete_my_account()` RPC for self-service account deletion
    - `0009_storage_image_only.sql` — restricts `sale-photos` bucket to image MIME types
    - `0010_public_routes.sql` — public-share columns on `routes`
    - `0011_extend_cleanup_window.sql` — extends sale cleanup grace period to 30 days past `end_date`
    - `0012_messaging_rls_hardening.sql` — locks `messages` UPDATE to `read_at` only; threads INSERT requires `garage_sale_id` + `contact_enabled`; drops user-facing UPDATE policy on threads
    - `0013_unread_counts_rpc.sql` — `unread_counts_by_thread()` RPC replacing the inbox's N+1 fan-out
    - `0014_thread_hide_per_user.sql` — per-user thread hide flags + `hide_thread()` and `find_or_create_thread()` RPCs; drops user-facing thread DELETE
4. In Supabase, enable email confirmation OR manually confirm your test user under **Authentication → Users**.
5. `npm run dev` and open http://localhost:3000

To seed test sales, edit `scripts/seed-data.json` (each entry needs a real `user_id` UUID) and run `node scripts/seed-sales.mjs`. The script geocodes each address via Mapbox before inserting.

## Deploy to Vercel

Nuxt's Nitro engine auto-detects Vercel — no `vercel.json` needed.

1. **Push to GitHub** (already configured: `origin = melissapula/garage-sales`).
2. In the Vercel dashboard, click **New Project** and import the GitHub repo. Framework should auto-detect as **Nuxt**.
3. Under **Environment Variables**, add:
    - `SUPABASE_URL`
    - `SUPABASE_KEY`
    - `SUPABASE_SERVICE_ROLE_KEY` (only needed if you run the seed script via Vercel; usually skip)
    - `MAPBOX_TOKEN`
    - `PUBLIC_SITE_URL` — set to your Vercel domain (e.g. `https://garage-sales.vercel.app`)
4. **Deploy**.
5. **Configure Supabase Auth URLs.** In the Supabase dashboard → **Authentication → URL Configuration**:
    - **Site URL:** your Vercel domain
    - **Redirect URLs (allow list):** add the Vercel domain plus `https://your-domain/confirm`, `https://your-domain/reset-password`. (Keep `http://localhost:3000` entries for local dev.)
6. **Mapbox token URL restrictions** (recommended). In your Mapbox account → tokens → restrict the public token's URL allowlist to your Vercel domain plus `localhost`.
7. **Verify Open Graph previews** by pasting a sale URL into Facebook's [Sharing Debugger](https://developers.facebook.com/tools/debug/) and clicking *Scrape Again*. The preview should pull the sale's title, address, dates, and first photo.

## Features

### Browse

`/browse` — public, three-column desktop layout (filters | list | map), tabbed on mobile.

- **Filters:** day (auto-built from data) and time bucket (morning < noon, afternoon noon–5, evening 5pm+).
- **Map:** Mapbox GL JS. Pins colored green (today) or yellow (upcoming). Past sales are filtered out. On the visitor's first time on the page, the browser prompts for location — if granted, the map centers on their coordinates; otherwise it falls back to Bemidji. The choice is cached in `localStorage` (`gst:user-location`) so we never re-prompt; the on-map "📍" button stays available for explicit re-centering.
- **Sync:** hovering a pin shows a transient popover; clicking pins it as a persistent popover (with close X) and replaces the middle list with a detail card. Click outside to clear.
- **Mobile tabs:** list / map / filters tabs are mutually exclusive — tapping any tab clears the selected sale, so list shows the full filtered list and map shows all filtered pins. Selecting a sale stacks the detail card above the map by default.
- **"Let's go!" button** on cards and popovers adds the sale to the user's saved-sales wishlist.

### Posting a sale

`/post` and `/post/[id]` — auth-required.

- Required fields: title, geocoded address, start/end date, start/end time.
- Validation: no past dates on new posts, end ≥ start, end-time > start-time on single-day sales. Submit button is disabled until valid.
- Photos: multi-upload, browser-side compression (max 1920px, JPEG ~85% quality), thumbnail previews, remove buttons. Stored in the `sale-photos` Supabase bucket under `<user_id>/<uuid>.jpg`.
- "Allow people to message me about this sale" toggle (default on) controls the message-owner button.
- Mapbox forward geocoding biased toward Bemidji proximity.

### Sale detail

`/sale/[id]` — public.

- Photo gallery with click-to-open lightbox (arrow keys, swipe, click outside, Esc).
- Dates, address, description.
- Owner status banner ("Running late", "Winding down") when set.
- "Let's go!" / "On your list — remove?" toggle.
- "Message owner" button (shown only if signed in, not the owner, and contact-enabled).
- Owner-only Edit/Delete buttons. Delete also cleans up photos from storage.
- Owner-only status pills (Open / Running late / Winding down / Closed early). "Closed early" hides the sale from the browse map.
- Open Graph meta tags for rich link previews on Facebook/Messenger/Discord.
- "Share to Facebook" (FB sharer URL) + "Copy link" buttons.

### My sales

`/my-sales` — auth-required. Lists the signed-in user's posts (newest first) with status badges, photo counts, Edit/Delete buttons.

### Saved sales + routes

`/itineraries` — auth-required.

- Top section: saved-sales wishlist (filtered to upcoming/active).
- "Plan a route" form: pick a name and date.
- Below: list of existing routes with delete buttons.

`/itineraries/[id]` — the route builder.

- **Stops list:** drag-and-drop reorder via the handle icon. Numbered visit order matches map markers.
- **Map:** start point pin (blue), numbered orange pins for each stop, blue polyline once a route is built.
- **Available saved sales:** any saved sales happening on the route's date that aren't yet in the route, with "+ Add" buttons.
- **Build options:**
    - **Use my order** — drives stops in the dragged order via Mapbox Directions API.
    - **Optimize order** — finds the shortest path via Mapbox Optimization API. (Mapbox v1 only supports round-trip or fixed-endpoints; we use round-trip mode.)
    - "Return to start" checkbox toggles whether the route ends back at the start point. Honored by both build options.
- **Start point:** browser geolocation (with reverse-geocoded confirmation address) OR typed address (Mapbox forward geocoding).
- **Departure time:** drives the timeline. Defaults to 8:00 AM.
- **Timeline:** for each stop, arrival time, departure time, and drive duration from the previous stop. 30 minutes per stop. Final "Drive home" entry shows return-leg duration and arrival-home time.
- **Open in Google Maps** / **Open in Apple Maps** buttons deep-link with all stops in order, ready to start navigation. Honors round-trip toggle. Google's link caps at 9 waypoints; the warning surfaces when the cap kicks in.

### Messaging

`/inbox` and `/inbox/[id]` — auth-required.

- Inbox lists conversations sorted by latest activity, with the other person's display name, sale subject, last-message preview, relative timestamp, and an unread-count badge. Skeleton rows render during a refetch so a sign-in transition doesn't flash the empty state.
- Thread page shows messages as bubbles (yours right-aligned in orange, theirs left-aligned in cream), 4000-char compose box, auto-marks unread messages read on view. URLs in messages render as clickable links via `<AutoLinkText>` (sender bubble uses white-underlined links to read against the orange).
- **Enter-to-send** is gated to devices with a real keyboard (`(hover: hover) and (pointer: fine)`). On mobile virtual keyboards Enter inserts a newline and the Send button ships the message.
- Started by clicking "Message owner" on a sale's detail page → calls the `find_or_create_thread()` RPC, which validates `contact_enabled` + sale ownership, finds an existing thread or inserts a new one, and auto-unhides the thread for the caller (so reopening a conversation you'd hidden doesn't create a duplicate).
- **Remove from inbox** — clicking the link in a thread calls the `hide_thread()` RPC, which only flips the caller's hide flag. The other participant still has the conversation and every message. A new reply from the other side resurfaces the thread for the hider via the on-message trigger.
- Navbar shows an unread-count badge driven by realtime deltas — INSERT from the other side increments, mark-read UPDATE decrements — instead of `count(*)` refetches per event.
- **Realtime** — incoming messages stream in via Supabase Realtime; the inbox list refreshes live and the unread badge updates via deltas without refreshing.

### Account

`/account` — auth-required. Edit your display name (the one shown in messages). The danger-zone "Delete my account" requires typing **DELETE** to confirm and calls the `delete_my_account()` RPC, which cascades through every sale, saved sale, route, and conversation tied to the user. Storage cleanup pages through the user's `sale-photos/<userId>/` folder so accounts with thousands of photos don't leave orphans.

### Reset password

`/reset-password` — checks `getSession()` on mount; without a recovery session it shows an "expired link" notice with a back-link to `/forgot-password`. The form has a confirm-password field with inline mismatch validation.

### Accessibility

`ConfirmModal` and `PhotoLightbox` use a `useFocusTrap` composable: focus is moved into the dialog on open, Tab cycles inside, and focus returns to the trigger on close. ConfirmModal's first focusable is Cancel by default, so a stray Enter on first paint cancels rather than firing destructive actions; Escape from anywhere still cancels.

### Lifecycle

- Past sales (end_date < today) are hidden from the browse map, but remain visible to their owner on `/my-sales`.
- A pg_cron job runs nightly at 03:00 UTC and deletes any sale whose end_date is more than 30 days past.
- Storage cleanup of photos happens client-side when the owner deletes the sale.

## Project layout

```
app/
  app.vue
  assets/css/tailwind.css
  components/
    BrowseFilters.vue, BrowseSaleCard.vue, BrowseSaleDetail.vue,
    BrowseMap.vue, RouteMap.vue, PhotoUploader.vue, PhotoLightbox.vue,
    ConfirmModal.vue, ToastContainer.vue, AutoLinkText.vue
  composables/
    useGarageSales.ts, useSavedSales.ts, useRoutes.ts,
    useRouteOptimizer.ts, useGeocode.ts, useMessaging.ts,
    useSalePhotos.ts, useToast.ts, useConfirm.ts, useFocusTrap.ts
  layouts/default.vue
  pages/
    index.vue, browse.vue, login.vue, signup.vue,
    forgot-password.vue, reset-password.vue, confirm.vue,
    account.vue, my-sales.vue, post.vue, post/[id].vue, sale/[id].vue,
    itineraries/index.vue, itineraries/[id].vue,
    inbox/index.vue, inbox/[id].vue, share/[id].vue
  utils/saleStatus.ts, utils/filters.ts, utils/ownerStatus.ts
scripts/
  seed-sales.mjs, seed-data.example.json
server/api/notifications/
  message.post.ts
supabase/migrations/
  0001_init.sql … 0014_thread_hide_per_user.sql
```
