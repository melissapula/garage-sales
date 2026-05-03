# Bemidji Garage Sales — Project Context for Claude

> Read this file at the start of every session to get fully up to speed.
> Last updated: 2026-05-01

---

## What is this app?

A community garage sale platform for Bemidji, MN and the surrounding area. Locals post their sales, anyone browses them on a map, and signed-in users build daily driving routes through the ones they want to hit.

It's the sister project to Missa's larger app, **Frula Homes** (lives at `C:/Users/missa/fsbo-platform/`). Same general stack (Nuxt 4 + Supabase + Mapbox + Tailwind, mobile-first), different visual identity, much smaller surface area.

**Tagline (working):** find the weekend's best stops and route them all in one go.

---

## The person building this

**Missa (Melissa Freundschuh-Pula)** — Software Engineer at TransImpact, Bemidji MN. M.S. Software Engineering, B.S. Mathematics, U.S. Marine Corps veteran. Day-job stack is Angular/StencilJS/NestJS, but she's comfortable in the Vue/Nuxt world.

She built Frula Homes solo and is doing the same here. She works evenings and weekends, wants every session to ship something concrete, builds feature breadth before visual polish, and uses "we" when describing the project. Direct, technically strong, doesn't need hand-holding.

See `~/.claude/projects/C--Users-missa-garage-sales/memory/user_missa.md` for more.

---

## Tech stack (locked)

- **Frontend:** Nuxt 4 + TypeScript + Tailwind CSS, mobile-first.
- **Database / Auth / Storage:** Supabase (Postgres + RLS + Storage + pg_cron).
- **Maps:** Mapbox GL JS, Mapbox Geocoding v6 (forward + reverse), Mapbox Directions v5, Mapbox Optimization v1.
- **Drag-and-drop:** vuedraggable (wraps SortableJS, supports touch).
- **Photo storage:** Supabase Storage `sale-photos` bucket. Browser-side compression (canvas, max 1920px, JPEG ~0.85).
- **Email:** still using Supabase's default mailer for auth. Resend is set up for Frula but not wired in here.

### Brand

- Primary orange `#F97316` (Tailwind orange-500), secondary sky `#0EA5E9` (sky-500).
- Active pin `#22C55E`, upcoming pin `#EAB308`.
- Cream background `#FFFBEB`.
- Fonts: Playfair Display (display) + DM Sans (body), loaded from Google Fonts.

### Mobile-first rules (carried over from Frula)

- Build 375px first.
- Minimum 44px tap targets.
- Target page load under 3 seconds on mobile.

---

## Data model

### Tables

| Table             | Purpose                                                                 | Notes                                                                                     |
| ----------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `garage_sales`    | The core listing.                                                       | `photos text[]`, `contact_enabled boolean`, `status text` (open/running_late/winding_down/closed), dates/times, lat/lng. RLS: public read. |
| `saved_sales`     | Per-user wishlist (the "Let's go!" list).                               | PK `(user_id, garage_sale_id)`. RLS: owner-only.                                          |
| `routes`          | A planned outing on a specific day.                                     | `route_date date not null`. RLS: owner-only.                                              |
| `route_stops`     | Ordered sales within a route.                                           | PK `(route_id, garage_sale_id)`, `position int`. RLS: via parent route.                   |
| `profiles`        | One row per auth user with a `display_name`.                            | Auto-created via trigger on `auth.users` insert. RLS: public read, owner-only write.       |
| `message_threads` | A conversation between two users, optionally about a sale.              | `participant_one_id`, `participant_two_id`, `garage_sale_id` nullable. RLS: participants. |
| `messages`        | Individual messages.                                                    | `read_at` for unread counts. Trigger updates parent thread's `last_message_at` + preview. |

### Lifecycle / cron

- A pg_cron job runs nightly at 03:00 UTC: `delete from garage_sales where end_date < current_date - interval '30 days'`.
- Sale-photo storage cleanup happens client-side when the owner deletes the sale (best-effort).

### Migrations (in order)

1. `0001_init.sql` — `garage_sales`, `itineraries`, `itinerary_stops` (later dropped), pg_cron job.
2. `0002_saved_sales_and_routes.sql` — drops `itineraries`/`itinerary_stops`, adds `saved_sales`, `routes`, `route_stops`.
3. `0003_storage_sale_photos.sql` — public `sale-photos` storage bucket + RLS based on first path segment.
4. `0004_profiles.sql` — `profiles` table, signup trigger, backfill of existing users.
5. `0005_messaging.sql` — adds `garage_sales.contact_enabled`, `message_threads`, `messages`, and the last-message-update trigger.
6. `0006_sale_status.sql` — adds `garage_sales.status` column with check constraint.
7. `0007_realtime_messaging.sql` — adds `messages` and `message_threads` to the `supabase_realtime` publication.

---

## What's built

### Pages

```
/                     Landing
/browse               3-column map browse (filters | list/detail | map), public
/login, /signup       Auth (Supabase email/password)
/forgot-password,
/reset-password       Password reset flow
/confirm              Auth callback redirect
/post                 Create a sale (auth)
/post/[id]            Edit a sale (auth, owner-only)
/sale/[id]            Public detail page with share + message owner + owner status pills + photo lightbox
/account              Display-name editor (auth)
/my-sales             Owner's posts list (auth)
/itineraries          Saved sales + plan-a-route form + routes list (auth)
/itineraries/[id]     Route builder: stops, map, optimize, timeline, exports (auth)
/inbox                Threads list with unread counts (auth)
/inbox/[id]           Conversation view + reply box (auth)
```

### Components

`BrowseFilters`, `BrowseSaleCard`, `BrowseSaleDetail`, `BrowseMap`, `RouteMap`, `PhotoUploader`, `PhotoLightbox`.

### Composables

`useGarageSales`, `useSavedSales`, `useRoutes`, `useRouteOptimizer` (with `optimizeRoute`, `buildRouteFromOrder`, `buildTimeline`, `getCurrentPosition`), `useGeocode` (forward + reverse), `useMessaging` (`findOrCreateThread`, `sendMessage`, `markThreadRead`, `fetchInbox`, `fetchThreadWithMessages`, `useUnreadCount`), `useSalePhotos`.

### Utils

`saleStatus` (active/upcoming/past + pin colors + date/time formatters), `filters` (day + time-bucket filtering), `ownerStatus` (status options + badge/banner Tailwind class helpers).

### Key behaviors

- **Pin colors:** green = today between start/end date; yellow = start_date in future; past sales filtered out of `/browse`.
- **Time buckets:** morning < noon, afternoon noon–5pm, evening 5pm onward. Sales with no time set match all buckets.
- **Validation on post:** title, geocoded address, start/end date, start/end time all required. No past start_date on new posts; end_date >= today on edits; end_date >= start_date; end_time > start_time on single-day sales. Submit disabled until valid.
- **Browser-side photo compression:** canvas-based, max 1920px, JPEG ~0.85.
- **Routing — Mapbox v1 limitation:** the Optimization API doesn't support `destination=any` with `roundtrip=false` (returns `NotImplemented`). We default to round-trip; the "Return to start" checkbox toggles between `roundtrip=true` and a Directions-API one-way path.
- **Timeline:** `buildTimeline` consumes `stopLegs` (excludes the return-home leg). Default 30 min per stop. Departure defaults to 08:00 on the route's date. The return-home entry shows arrival-home time computed from the last stop's depart time + return-leg drive seconds.
- **Maps export:** Google Maps URL `dir/?api=1&...` and Apple Maps `?saddr&daddr=A+to:B`. Round-trip toggle is honored. Google caps at 9 waypoints; the UI warns when stops are dropped.
- **Facebook share:** standard share dialog (`facebook.com/sharer/sharer.php?u=...`). We can't auto-target a specific group — Meta deprecated `publish_to_groups` for general apps. The OG meta tags on `/sale/[id]` give the dialog a rich preview once the site is deployed.
- **Messaging:** thread is keyed by (pair of participants, sale_id). Find-or-create on first message. Unread count = my unread messages across all threads (RLS-filtered). Shown as a navbar badge.
- **Realtime:** `/inbox/[id]` subscribes to message INSERTs filtered to its `thread_id` and appends them live. `/inbox` subscribes to all message INSERTs (RLS-filtered) and refreshes. The default layout subscribes to message inserts/updates and refreshes the navbar badge. Channels are removed on unmount.
- **Owner status:** `garage_sales.status` is one of `open` (default), `running_late`, `winding_down`, `closed`. Closed sales are filtered out of `/browse` (`fetchActiveSales` adds `.neq('status', 'closed')`) but still visible to the owner on `/my-sales`. The owner sets status from quick-tap pills on `/sale/[id]`. Banner shows on detail and inline status badge shows on cards/popovers.
- **Photo lightbox:** `PhotoLightbox.vue` is a teleport-to-body modal with arrow-key + swipe + Esc + click-outside close. Fixed body overflow while open.

### Environment variables (in `.env`, gitignored)

- `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `MAPBOX_TOKEN`
- `PUBLIC_SITE_URL` (defaults to `http://localhost:3000`)

The repo is at https://github.com/melissapula/garage-sales (origin already configured).

### Scripts

- `scripts/seed-sales.mjs` — reads `scripts/seed-data.json`, geocodes each address via Mapbox, inserts via Supabase service role (bypasses RLS).

---

## Known gaps / what's left

- **Auth emails through Resend.** Currently we use Supabase's default mailer (rate-limited, generic sender). Frula already has a verified Resend domain we could borrow.
- **No mobile drawer for filters** — currently the browse page uses simple tab navigation between filters/list/map on small screens.
- **No deploy yet.** README has the Vercel walk-through — Missa needs to push the button and configure Supabase + Mapbox URL allowlists for the production domain. Once shipped, FB/Open Graph previews start working (FB's scraper needs a public URL).
- **No reviews / ratings.**
- **Mapbox Optimization caps at 11 stops** (12 coords with start). For larger routes we'd need to chunk or fall back to a heuristic.

---

## Working style notes (carried over from Frula)

- Direct, technically strong, doesn't need hand-holding.
- Wants enthusiasm AND honesty — flag structural problems clearly.
- Builds on evenings/weekends around full-time job + family.
- Every session should produce something real and shippable.
- Uses "we" — lean into the collaborative framing.
- "Build first, polish later" — feature breadth over visual polish.
- When checking work in the browser, she sometimes pastes errors verbatim — read the stack trace carefully (line/column numbers really do mean something).

---

## Recent decisions to remember

- **Bemidji-only proximity bias** for geocoding (Mapbox `proximity=-94.8826,47.4716`). Don't let this leak into sale data — addresses are still real US addresses, just biased toward Bemidji results when ambiguous.
- **Round-trip is the default** for Optimize Order because Mapbox v1 doesn't support open-end optimization. The "Return to start" checkbox lets users opt out (uses Directions API one-way path).
- **30 min per stop** is the timeline assumption. Hard-coded for now; could become user-configurable if asked.
- **"Let's go!" wording** for the save-to-wishlist button — Missa's preference, kept verbatim across cards, popovers, and the detail page.
- **`route_date` lives on the route, not on stops.** A route is for a single day; stops inherit that day implicitly.
- **Sale photos cleanup is best-effort.** When a sale is deleted, the client tries to remove its photos from storage but doesn't block on failure.
- **Status `closed` hides from browse but not from `/my-sales`.** Owner can revert it to `open` at any time. Past sales (date-based) and closed sales (status-based) are both excluded from the public map.
- **Realtime channels** are owned by the page/layout that subscribes; teardown happens in `onBeforeUnmount` via `supabase.removeChannel(channel)`. Don't forget this when adding new subscribers — leaked channels burn Supabase realtime quota.
