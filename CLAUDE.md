# Bemidji Garage Sales — Project Context for Claude

> Read this file at the start of every session to get fully up to speed.
> Last updated: 2026-05-08 (after report-a-sale flow, disclaimer, INP fixes, audit High + Medium hardening)

---

## What is this app?

A community garage sale platform — originally built for Bemidji, MN and the surrounding area, but as of 2026-05-04 Missa is opening it up to anyone, anywhere. The Bemidji branding stays for now (the repo, app name, and proximity-biased geocoding default), but listings outside the Bemidji area are welcome and the product is being framed for a wider audience. Locals post their sales, anyone browses them on a map, and signed-in users build daily driving routes through the ones they want to hit.

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
| `garage_sales`    | The core listing.                                                       | `photos text[]`, `contact_enabled boolean`, `status text` (open/running_late/winding_down/closed), `deleted_at timestamptz` (soft-delete tombstone), lat/lng. The `start_date`/`end_date`/`start_time`/`end_time` columns are a denormalized envelope (min/max) over `sale_dates`, maintained by a trigger — never edit them directly. RLS: public read. |
| `sale_dates`      | One row per day on a sale's schedule.                                   | PK `(sale_id, sale_date)`, nullable `start_time`/`end_time`. Allows non-contiguous dates and per-day hours. RLS: public read; mutations gated by parent ownership. AFTER trigger keeps `garage_sales`'s envelope columns in sync. |
| `saved_sales`     | Per-user wishlist (the "Let's go!" list).                               | PK `(user_id, garage_sale_id)`. RLS: owner-only.                                          |
| `routes`          | A planned outing on a specific day.                                     | `route_date date not null`. RLS: owner-only.                                              |
| `route_stops`     | Ordered sales within a route.                                           | PK `(route_id, garage_sale_id)`, `position int`. RLS: via parent route.                   |
| `profiles`        | One row per auth user with a `display_name`.                            | Auto-created via trigger on `auth.users` insert. RLS: public read, owner-only write.       |
| `message_threads` | A conversation between two users, optionally about a sale.              | `participant_one_id`, `participant_two_id`, `garage_sale_id`, `hidden_for_one`, `hidden_for_two`. SELECT RLS filters out threads hidden for the caller. INSERT requires `garage_sale_id is not null`, the linked sale's `contact_enabled = true`, and the sale owner is one of the two participants. No user-facing UPDATE or DELETE policy — those flow through `find_or_create_thread()` and `hide_thread()` RPCs. |
| `messages`        | Individual messages.                                                    | `read_at` for unread counts. UPDATE is column-restricted to `read_at` only (column-level grant on top of RLS). Trigger maintains parent thread's `last_message_at` / preview AND un-hides for the recipient on a new message. |
| `message_notifications` | Idempotency claim for per-message email sends.                    | `(message_id pk, notified_at)`. Prevents the `/api/notifications/message` endpoint from being replayed to spam emails. RLS on with no user-facing policies; only the service role writes. |

### Lifecycle / cron

- A pg_cron job runs nightly at 03:00 UTC and deletes `garage_sales` rows where `end_date < current_date - interval '30 days'` **OR** `deleted_at < now() - interval '30 days'`. Hard-delete then cascades to `saved_sales` / `route_stops`.
- Owner "Delete" is a soft-delete: sets `deleted_at = now()` so saved-sales and route-stops referencing the sale render a "removed" tombstone for ~30 days before the cron purges.
- Sale-photo storage cleanup happens client-side when the owner deletes the sale (best-effort). For *edits*, photo removals are staged via `PhotoUploader.commitPendingDeletes()` and only fire on submit success — so a user who removes a photo and then closes the page without saving doesn't end up with a broken-image reference.

### Migrations (in order)

1. `0001_init.sql` — `garage_sales`, `itineraries`, `itinerary_stops` (later dropped), pg_cron job.
2. `0002_saved_sales_and_routes.sql` — drops `itineraries`/`itinerary_stops`, adds `saved_sales`, `routes`, `route_stops`.
3. `0003_storage_sale_photos.sql` — public `sale-photos` storage bucket + RLS based on first path segment.
4. `0004_profiles.sql` — `profiles` table, signup trigger, backfill of existing users.
5. `0005_messaging.sql` — adds `garage_sales.contact_enabled`, `message_threads`, `messages`, and the last-message-update trigger.
6. `0006_sale_status.sql` — adds `garage_sales.status` column with check constraint.
7. `0007_realtime_messaging.sql` — adds `messages` and `message_threads` to the `supabase_realtime` publication.
8. `0008_delete_account.sql` — `delete_my_account()` RPC for user-initiated account deletion (cascades through everything tied to the user).
9. `0009_storage_image_only.sql` — restricts `sale-photos` bucket to image MIME types.
10. `0010_public_routes.sql` — adds public-share columns to `routes`.
11. `0011_extend_cleanup_window.sql` — extends the pg_cron sale-cleanup grace period from 7 to 30 days past `end_date`.
12. `0012_messaging_rls_hardening.sql` — column-level grant restricts `messages` UPDATE to `read_at` only; new threads INSERT policy requires non-null `garage_sale_id`, `contact_enabled = true`, and sale owner is a participant; user-facing UPDATE policy on threads dropped (the on-message trigger is `security definer` and unaffected).
13. `0013_unread_counts_rpc.sql` — adds `unread_counts_by_thread()` RPC (security invoker) returning one row per thread with unread messages from the other side, replacing the inbox's N+1 fan-out.
14. `0014_thread_hide_per_user.sql` — adds `hidden_for_one` / `hidden_for_two` columns; updates SELECT RLS so a hidden thread disappears for the hider only; updates `update_thread_on_message` trigger to un-hide for the recipient on each new message; adds `hide_thread(uuid)` and `find_or_create_thread(uuid, uuid)` security-definer RPCs; drops the user-facing DELETE policy on threads.
15. `0015_message_notifications.sql` — adds the `message_notifications` claim table for idempotent email sends in `/api/notifications/message`. Sidesteps the `messages` realtime publication so the layout's unread-delta handler can't misinterpret the claim INSERT.
16. `0016_thread_create_buyer_only.sql` — replaces `find_or_create_thread` with a buyer-only version. Caller must NOT be the sale owner; `p_other_user_id` MUST be the sale owner. Closes a path where an owner could spawn empty threads against arbitrary user ids.
17. `0017_soft_delete_garage_sales.sql` — adds `garage_sales.deleted_at` (with a partial index) and re-schedules the cleanup cron to also purge tombstones older than 30 days. Owner "Delete" now sets `deleted_at` instead of physically deleting, so saved-sales / route-stops referencing the sale stay rendered as a tombstone until the cron purges.
18. `0018_sale_dates.sql` — new `sale_dates` child table (one row per day, optional per-day `start_time`/`end_time`). Backfills existing sales by expanding their range into per-day rows. Adds an `update_garage_sale_envelope()` security-definer trigger that keeps `garage_sales.start_date`/`end_date`/`start_time`/`end_time` synced as min/max over `sale_dates`. The check constraint allows `end_time >= start_time` (legacy multi-day sales were allowed equal times); the new post form still requires `>`.
19. `0019_storage_cap_and_route_stops_check.sql` — sets `file_size_limit = 5 MB` on the `sale-photos` storage bucket (server-side enforcement that survives a client bypass), and re-creates the `route_stops` UPDATE policy with both `USING` and `WITH CHECK` clauses so a user can't UPDATE a stop's `route_id` to point at a different route.
20. `0020_thread_state_check_and_unread_index.sql` — `find_or_create_thread` now also rejects soft-deleted (`deleted_at`) and closed (`status = 'closed'`) sales, matching what the UI already hides. Adds a partial index `messages_unread_idx` on `(thread_id, sender_id) where read_at is null` for `unread_counts_by_thread()` selectivity at scale.

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

`BrowseFilters`, `BrowseSaleCard`, `BrowseSaleDetail`, `BrowseMap`, `RouteMap`, `PhotoUploader` (parallel uploads with concurrency 3, stages `commitPendingDeletes` for already-saved photos), `PhotoLightbox`, `ConfirmModal`, `ReportSaleModal` (logged-in non-owners flag a sale for admin review — reason dropdown + optional notes), `ToastContainer`, `AutoLinkText` (renders bare http(s) URLs in user text as safe anchor tags via segment-based parsing — no `v-html`; rebalances trailing `)` so Wikipedia-style URLs stay intact).

There's also a project-level `app/error.vue` — Nuxt's global error boundary, brand-styled. Renders for both 4xx (e.g., the `createError({ statusCode: 404 })` thrown by sale/route loaders for missing rows) and 5xx.

### Composables

`useGarageSales` (with `findOverlappingSale` + `findOverlappingSaleWithRetry` + `isRemovedSale` + `findSaleDateOn` + `GARAGE_SALE_SELECT` constant for the `*, sale_dates(...)` nested select), `useSavedSales`, `useRoutes`, `useRouteOptimizer` (with `optimizeRoute`, `buildRouteFromOrder`, `buildTimeline`, `getCurrentPosition`, `GOOGLE_MAX_WAYPOINTS`), `useGeocode` (forward + reverse), `useMessaging` (`findOrCreateThread`, `sendMessage`, `markThreadRead`, `hideThread`, `fetchInbox`, `fetchThreadWithMessages`, `useUnreadCount` with `incrementUnread` / `decrementUnread`), `useSalePhotos`, `useToast` (monotonic IDs via `useState` so SSR requests don't share state), `useConfirm`, `useFocusTrap` (modal focus management — captures previously focused element, traps Tab inside container, restores focus on close), `useIdleSignout` (signs the current user out after 60 min of mouse/keyboard/touch/scroll/wheel inactivity; called once from the default layout).

### Utils

`saleStatus` (active/upcoming/past + pin colors + date/time formatters + `isExpiredSale` + `summarizeSchedule(sale)` returning `{ compact, days, hasVariation }` for cards + per-day detail), `filters` (day + time-bucket filtering — both iterate `sale_dates` rows so non-contiguous days don't false-match gap days), `ownerStatus` (status options + badge/banner Tailwind class helpers), `date` (`todayLocalISO()` + `toLocalISO(d)` — local-timezone date strings; the previous `new Date().toISOString().slice(0, 10)` pattern shifted to UTC and broke "today" cutoffs in the evening), `schedule` (`emptyDay`, `validateSchedule`, `scheduleEnvelope`, `scheduleDates` — helpers for the per-day post/edit form rows).

### Key behaviors

- **Pin colors:** green = today between start/end date; yellow = start_date in future; past sales filtered out of `/browse`.
- **Time buckets:** morning < noon, afternoon noon–5pm, evening 5pm onward. Sales with no time set match all buckets.
- **Per-day schedule editor (post + edit form).** `/post` and `/post/[id]` use a list of day-rows: each row is `{ date, start_time, end_time }`, with an "+ Add day" button below. Adding a day defaults its date to one day after the last filled date and inherits the previous row's times. Removing the only row clears it instead of deleting (the sale must have at least one day). On save, the parent inserts/updates `garage_sales` (with envelope values that match what the trigger would produce) then bulk-inserts (post) or diff-then-upserts (edit) into `sale_dates`. Validation requires every row to have date + both times, no duplicate dates, end_time > start_time per row; new posts reject past dates entirely; edits allow already-past days but require at least one day still in the future (mirrors the legacy "end_date can't be in the past" rule).
- **Validation on post:** title, geocoded address, at least one day row with date + both times. Each row independently enforces end_time > start_time. Submit disabled until valid.
- **Browser-side photo compression:** canvas-based, max 1920px, JPEG ~0.85.
- **Routing — Mapbox v1 limitation:** the Optimization API doesn't support `destination=any` with `roundtrip=false` (returns `NotImplemented`). We default to round-trip; the "Return to start" checkbox toggles between `roundtrip=true` and a Directions-API one-way path.
- **Timeline:** `buildTimeline` consumes `stopLegs` (excludes the return-home leg). Default 30 min per stop. Departure defaults to 08:00 on the route's date. The return-home entry shows arrival-home time computed from the last stop's depart time + return-leg drive seconds.
- **Maps export:** Google Maps URL `dir/?api=1&...` and Apple Maps `?saddr&daddr=A+to:B`. Round-trip toggle is honored. Google caps at 9 waypoints; the UI warns when stops are dropped.
- **Facebook share:** standard share dialog (`facebook.com/sharer/sharer.php?u=...`). We can't auto-target a specific group — Meta deprecated `publish_to_groups` for general apps. The OG meta tags on `/sale/[id]` give the dialog a rich preview once the site is deployed.
- **Messaging:** thread is keyed by (pair of participants, sale_id). Find-or-create runs server-side via the `find_or_create_thread()` security-definer RPC, which validates `contact_enabled` + sale ownership and auto-unhides the thread for the caller (so a hidden thread doesn't get duplicated when a user re-messages the owner). Unread count = my unread messages across all threads (RLS-filtered). Shown as a navbar badge.
- **Per-user thread hide.** "Remove from inbox" on `/inbox/[id]` calls the `hide_thread()` RPC, which flips `hidden_for_one` or `hidden_for_two` based on which participant the caller is. The other side keeps the conversation + every message. A new reply from the other side resurfaces the thread for the hider via the `update_thread_on_message` trigger. Physical thread DELETE is gone.
- **Realtime:** `/inbox/[id]` subscribes to message INSERTs filtered to its `thread_id` and appends them live. `/inbox` subscribes to all message INSERTs (RLS-filtered) and refreshes the threads list. The default layout subscribes to message INSERT/UPDATE events and updates the navbar unread badge via deltas (increment on INSERT from the other side, decrement on mark-read UPDATE) — no per-event `count(*)` refetch. Channels are removed on unmount.
- **Inbox unread counts.** The per-thread unread badges in `/inbox` come from a single `unread_counts_by_thread()` RPC call inside `fetchInbox`, instead of one count query per thread.
- **Owner status:** `garage_sales.status` is one of `open` (default), `running_late`, `winding_down`, `closed`. Closed sales are filtered out of `/browse` (`fetchActiveSales` adds `.neq('status', 'closed')`) but still visible to the owner on `/my-sales`. The owner sets status from quick-tap pills on `/sale/[id]`. Banner shows on detail and inline status badge shows on cards/popovers.
- **Photo lightbox:** `PhotoLightbox.vue` is a teleport-to-body modal with arrow-key + swipe + Esc + click-outside close. Fixed body overflow while open.
- **Browse map auto-centers on user location.** On first visit to `/browse`, the page prompts for `navigator.geolocation` and, if granted, centers the map on the user's coordinates. The result (granted+coords or denied) is cached in `localStorage` under the key `gst:user-location` so we never re-prompt; users can opt in later via the on-map "📍" `GeolocateControl` button. If the user moves cities, they need to either tap that button or clear browser data — there's no TTL on the cache yet.
- **Mobile browse tabs are mutually exclusive.** On `/browse` mobile, tapping list/map/filters clears any selected sale (via `clearSelection`), so the list tab shows the full filtered list and the map tab shows all the filtered pins. Selecting a sale (from list or pin) shows the detail card stacked above the map by default.
- **Mapbox container resize.** `BrowseMap.vue` runs a `ResizeObserver` on its container and calls `map.resize()` on every change. Mapbox's built-in `trackResize` only listens to *window* resizes, so without this the canvas would freeze at its initial size whenever internal layout shifts (mobile stacked detail+map, tab swaps) grew the container — pins past the original size would float over empty cream.
- **BrowseMap marker rebuild watch.** Watches a stable `id:lat:lng` signature instead of `props.sales` deeply, so a sale-status update (or any non-spatial property change) doesn't tear down + re-create every marker mid-hover. Popup HTML reads `props.sales.find(...)` on each open, so non-marker fields stay live without a rebuild.
- **Modal focus traps.** `ConfirmModal` and `PhotoLightbox` use `useFocusTrap` to focus the first focusable element on open, trap Tab, and restore focus to the trigger on close. ConfirmModal also dropped the global Enter-anywhere-confirms handler — Cancel is the first focusable, so a stray Enter on first paint cancels rather than firing destructive actions.
- **Soft-deleted sales (tombstones).** Owner "Delete" sets `garage_sales.deleted_at` instead of cascading. Saved-sales / route-stops referencing the tombstone render in **red** with a "⚠ Removed by the owner" notice; the link is dead (the sale page 404s for tombstones). Tombstones are excluded from route optimize/build/maps-export. The cron purges tombstones >30 days old, at which point the FK cascade finally drops the saved/stop rows.
- **Expired sales.** Sales whose `end_date` is past render in **yellow** with "⏳ This sale has ended" in saved-sales / route-stops. They stay clickable (the underlying row still exists) and stay in route calculations (coords valid for past-route review). Use `isExpiredSale(sale)` from `utils/saleStatus`.
- **Real 404s + brand-styled error page.** `sale/[id]`, `itineraries/[id]`, `share/[id]`, and `post/[id]` loaders throw `createError({ statusCode: 404 })` when the row is missing or soft-deleted. `app/error.vue` renders a styled 404 / 5xx with "Browse sales" / "Back home" buttons.
- **Local-timezone "today".** Use `todayLocalISO()` / `toLocalISO(d)` from `app/utils/date.ts`. Don't reach for `new Date().toISOString().slice(0, 10)` — it returns the UTC date and silently shifts to "tomorrow" between roughly 6pm and midnight in any Western Hemisphere timezone, which broke pin colors, the `:min` on the post form, the day chips on `/browse`, and the `fetchActiveSales` cutoff.
- **Email idempotency.** `/api/notifications/message` claims a row in `message_notifications` (`INSERT … ON CONFLICT DO NOTHING`) before sending. Replays return `{ skipped: 'already notified' }`. Kept in a separate table from `messages` so the layout's unread-delta handler can't misinterpret the claim as a mark-read UPDATE.
- **Geolocation cache TTL.** `gst:user-location` in localStorage now expires — 7 days for granted, 24 hours for denied. After expiry the page re-prompts (so users who move cities or change their mind aren't stuck forever).
- **Post dup-check is same-user only.** `findOverlappingSale` filters `.eq('user_id', userId)` so condo neighbors, multi-family sales on a shared cul-de-sac, and multi-vendor flea markets aren't hard-blocked. The check still catches "I posted twice" within a single account. Both call sites use `findOverlappingSaleWithRetry`, which retries once and surfaces a soft `toast.info` if the check itself can't complete.
- **Photo edit safety.** `PhotoUploader` snapshots the `modelValue` it loads with as `initialUrls`. Removing one of those staged URLs only stages the storage delete (`pendingDeletes`); session-uploaded URLs delete immediately. The parent calls `commitPendingDeletes()` after a successful save. Result: a user removing an existing photo and closing the page without saving doesn't end up with a row referencing a missing storage object.
- **togglePublic refetches.** `/itineraries/[id]`'s "Make public" button calls `useAsyncData`'s `refresh()` after the DB update instead of mutating `data.value.route.is_public` directly — the direct mutation could be silently clobbered by a concurrent refresh.
- **Autolinking user text.** Sale descriptions (in `BrowseSaleDetail` + `sale/[id]`) and message bodies (in `inbox/[id]`) render through `<AutoLinkText :text>`. URL detection is segment-based (no `v-html`); trailing punctuation common at sentence-end (`.,!?]) `) is peeled off so prose reads naturally; sender bubbles in the inbox pass a custom `link-class` so links read as white-underlined against the orange bubble.
- **Mobile Enter-to-send.** `/inbox/[id]`'s textarea only auto-submits on `Enter` for devices matching `(hover: hover) and (pointer: fine)` — i.e. real keyboards. On phones / touch devices, Enter inserts a newline as the on-screen keyboard expects, and Send is the on-screen button.
- **Photo uploads.** `PhotoUploader` runs uploads in parallel with a concurrency cap of 3, using `Promise.allSettled` so one bad file doesn't kill the batch. Non-image files are filtered up front and reported as a single inline notice.
- **Post form dup-check.** `findOverlappingSaleWithRetry` retries once after 300ms before giving up. Both `/post` and `/post/[id]` track a `dupCheckFailed` flag; if both attempts fail the sale still posts and the user sees a `toast.info` urging them to double-check the map.
- **Reset-password defensive UI.** `/reset-password` checks `getSession()` on mount; without a recovery session it shows an amber "expired link" notice with a back-link to `/forgot-password`. The form has a confirm-password field with inline mismatch validation.
- **`/inbox` skeleton.** Three pulsing rows render when `pending && !threads?.length`, so a user-state-change refetch (sign-in, account switch) no longer flashes the empty state.
- **Schedule display chooses compact vs expanded.** `summarizeSchedule(sale)` returns a one-line `compact` label ("May 7–9 · 8:00 AM – 5:00 PM" when contiguous + same hours, "May 7–9 · varied hours" when contiguous but heterogeneous, "3 days · May 7–15" when non-contiguous) and a `days[]` array. Cards / map popovers / inbox previews use `compact`; the detail page (`/sale/[id]`) and `BrowseSaleDetail` show the per-day list when `hasVariation` is true, otherwise the compact line.
- **Per-day overlap check on post.** `findOverlappingSale(userId, lat, lng, dates[], excludeId?)` queries `garage_sales` joined with `sale_dates!inner` filtered by `.in('sale_dates.sale_date', dates)`, so a same-user same-coords conflict only fires when an actual day collides — non-contiguous "second weekend" posts aren't falsely blocked by an envelope overlap on a gap day. The form passes the user's day list directly.
- **Per-day route-stop hours.** `/itineraries/[id]` and `/share/[id]` look up the stop sale's `sale_dates` row matching the route's `route_date` and show those hours specifically — `findSaleDateOn(sale, day)`. Falls back to the envelope when no row matches (legacy stops or schedule-shift edge case). The "Saved sales available on this date" filter also uses `findSaleDateOn` instead of envelope-range matching.
- **JSON-LD per day.** `/sale/[id]` emits one `schema.org/Event` entry per `sale_dates` row (single-day sales emit one object; multi-day emit an array). A non-contiguous schedule shows up as separate Google search-result rows for the right dates instead of one continuous misleading window.
- **Auto-signout after 1 hour of inactivity.** `useIdleSignout()` (called from `app/layouts/default.vue`) tracks `mousemove`/`keydown`/`pointerdown`/`touchstart`/`scroll`/`wheel` events on the window. After 60 min with no activity, signs out via `supabase.auth.signOut()` and redirects to `/login?idle=1` (which shows an amber "you've been signed out for inactivity" notice). A 1-min `setInterval` checks elapsed time, and a `visibilitychange` handler re-checks when the tab regains focus — covers backgrounded mobile tabs where `setInterval` is throttled. No-op when no user is signed in.
- **BrowseMap hover stability.** Two fixes ride together: the marker `mouseenter` handler calls `clearHoverTimer()` directly before emitting (because if the cursor moves popup → pin and `hoveredId` was already this sale, Vue's ref assignment is a no-op and the watcher doesn't fire — meaning `showPopup`'s `clearHoverTimer` never runs and the popup auto-closes mid-hover); the close delay was bumped from 250ms to 400ms for more grace traversing the pin↔popup gap.
- **Filter match count.** `BrowseFilters` shows a live "· N matches" next to the "Filters" header. The parent passes `filteredSales.length` as the `filteredCount` prop so there's a single source of truth; the child doesn't re-run `applyFilters`.
- **9 AM – 5 PM defaults on the post form.** `emptyDay()` (in `app/utils/schedule.ts`) returns `{ date: '', start_time: '09:00', end_time: '17:00' }` so a typical seller can post after just picking a date. `+ Add day` inherits the previous row's times, so changing the first row propagates naturally to subsequent days.
- **PWA Phase 1.** `@vite-pwa/nuxt` module configured in `nuxt.config.ts`. Generates `manifest.webmanifest` (name/short_name/id=`/`/start_url=`/browse?source=pwa`/standalone/portrait/orange theme/cream background) and a Workbox-driven `sw.js`. Runtime caching for Mapbox tiles (CacheFirst, 30d), Google Fonts (StaleWhileRevalidate), and Supabase storage sale-photos (CacheFirst, 14d) — so a saved sale's images render offline. Install banner is suppressed (`installPrompt: false`) — browsers still surface "Install" via address bar / menu. iOS meta tags (`apple-mobile-web-app-capable`, `status-bar-style`, `title`) added for iOS Safari Add-to-Home-Screen UX. SW is enabled in dev (`devOptions.enabled: true`); if HMR gets weird, toggle off and use a production build to test PWA mechanics.
- **Report-a-sale flow.** `/sale/[id]` shows a 🚩 Report link to logged-in non-owners. Opens `ReportSaleModal` with reason dropdown (False info / Spam / Inappropriate / Duplicate / Other) + optional notes, POSTs to `/api/sale-reports`. The endpoint requires auth, fetches the sale (404s on tombstones), and emails the configured `adminEmail` via Resend with full context (sale title/address, owner email, reporter email, reason, notes) and `replyTo` set to the reporter so the admin can follow up directly. No `sale_reports` table — Phase 1 is email-only; we add persistence + a queue if volume justifies it. Anonymous users don't see the button (would redirect to login mid-flow and lose context); the disclaimer line covers the "be careful" message for them.
- **Community-content disclaimer.** Site-wide footer line ("Sales are posted by community members. We don't verify listings…") plus an inline italic line under the address on `/sale/[id]` ("Posted by a community member — confirm details before driving over"). Phrasing leans "we don't verify" rather than "not responsible" — less defensive, contextually accurate.
- **Saved-sales errors are user-facing.** `useSavedSales.save()` and `unsave()` toast on failure and log via `console.error`; `refresh()` only logs (passive call, doesn't toast every transient blip). Earlier the helpers silently swallowed errors with `if (error) return` so a failed save looked like a no-op heart click.
- **Modal accessibility.** `ConfirmModal` (id=`confirm-modal-title` + `aria-labelledby`) and `PhotoLightbox` (`aria-label="Photo viewer"`) name their dialogs for screen readers. `ReportSaleModal` already did this with `aria-labelledby="report-sale-title"`.
- **`find_or_create_thread` state checks.** The RPC rejects soft-deleted (`deleted_at`) and closed (`status = 'closed'`) sales in addition to the existing `contact_enabled` + buyer-only-initiation checks. UI already hides the "Message owner" button on these states; the RPC is the server-side authority.
- **Inbox realtime uses immutable updates.** `/inbox/[id]`'s realtime INSERT handler replaces the wrapper (`data.value = { ...data.value, messages: [...messages, msg] }`) instead of `.push`-ing to the array on a `useAsyncData` non-shallow ref. Matches the `togglePublic` refactor pattern; avoids a race with concurrent `refresh()`.
- **Storage bucket file-size cap.** `sale-photos` bucket enforces 5 MB per file at the bucket level (migration 0019). Client-side compression (max 1920px JPEG ~0.85) keeps real-world uploads well under this; the bucket cap is the only enforcement that survives a `curl` bypass.
- **`route_stops` UPDATE has `WITH CHECK`.** The original migration 0002 had `USING` only — sufficient to block reading foreign rows but not the UPDATE itself, which would let a user move a stop's `route_id` to any value. Migration 0019 re-creates the policy with both clauses.
- **`/post/[id]` ownership check inside the loader.** Ownership mismatches throw 404 (not 403) from inside `useAsyncData` so we don't leak the existence of a foreign sale via response code, and we don't leave a stale full-payload sitting in `data.value` for a page that won't render.
- **`RouteMap` watches a stable signature.** Same `id:lat:lng` signature pattern as `BrowseMap`, so a non-spatial property change on an available sale (e.g. owner flipped status to closed via realtime) doesn't tear down + re-create every marker mid-interaction. Geometry is watched separately by reference (a new optimize call always produces a new ref).
- **Radius slider debounced + password-confirm blur-gated (INP fixes).** Cloudflare web analytics flagged both as Poor INP. The radius slider uses a local visual ref so the thumb follows the cursor instantly during drag, with a 120ms debounced emit so the parent's filteredSales / map / cards don't re-render on every pixel of drag (guarded against a stale queued value racing past a "Clear all" reset). The "passwords don't match" message on `/reset-password` only renders after the confirm field blurs — eliminates per-keystroke conditional rendering.
- **Inbox list updates in place on new messages.** `/inbox`'s realtime INSERT handler updates the matching thread row's preview/timestamp/unread count and re-sorts to the top, instead of refetching `fetchInbox()` (which re-runs the profiles join + unread-counts RPC). Falls back to `refresh()` only on a brand-new thread the user doesn't have on screen.
- **Modals support `data-autofocus`.** `useFocusTrap` looks for `[data-autofocus]` first when a modal opens, before falling back to the first focusable element. Lets a modal jump focus to its first *meaningful* control (e.g. the reason `<select>` in `ReportSaleModal`) instead of the close-X.
- **Saved-sale row tone is centralized.** `saleRowToneClasses(sale)` in `utils/saleStatus.ts` returns the right `bg-*`/`ring-*` for tombstone (red) / expired (yellow) / normal (white). Used by both `/itineraries/index.vue` saved-sales list and `/itineraries/[id].vue` route stops so the tone stays in sync as styling evolves.
- **Geolocation cache key is user-scoped.** `gst:user-location:<user-id-or-anon>` instead of a single global key. Prevents user A's coords from leaking into user B's first browse on a shared device after sign-out.

### Environment variables (in `.env`, gitignored)

- `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `MAPBOX_TOKEN`
- `PUBLIC_SITE_URL` (defaults to `http://localhost:3000`)

The repo is at https://github.com/melissapula/garage-sales (origin already configured).

### Scripts

- `scripts/seed-sales.mjs` — reads `scripts/seed-data.json`, geocodes each address via Mapbox, inserts via Supabase service role (bypasses RLS).

---

## Known gaps / what's left

- **Auth emails through Resend.** Currently we use Supabase's default mailer (rate-limited, generic sender). The Resend SDK + idempotent `/api/notifications/message` endpoint are wired in, but the auth side (signup confirmation, password reset) still goes through Supabase's mailer. Frula already has a verified Resend domain we could borrow.
- **`public/og-image.png` is missing.** Both `/sale/[id]` and `/share/[id]` reference `${siteUrl}/og-image.png` as the OG fallback when no sale photos exist. Need a 1200×630 PNG (brand wordmark + tagline).
- **Mapbox token URL allowlist.** Set in the Mapbox dashboard before deploy — without it, anyone can lift the public token and run up the bill. The allowlist applies to *every* Mapbox call (forward + reverse geocode in `useGeocode`, Optimization v1 in `useRouteOptimizer`, Directions v5 in `buildRouteFromOrder`, AND the GL JS tile fetches), not just the rendered map. One allowlist setting covers them all because they share the same public token.
- **Viewport-aware `/browse` fetch.** `fetchActiveSales` returns every active sale unbounded. Fine today; once a few thousand sales are live nationwide we'd want bbox + radius filters with a hard `limit(500)`.
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

- **App scope is now nationwide.** As of 2026-05-04 Missa decided to open the app to anyone, not just Bemidji. The marketing copy and CLAUDE.md tagline still mention Bemidji, but don't reject or warn about listings far from there. See `~/.claude/projects/C--Users-missa-garage-sales/memory/project_app_scope_anyone.md`.
- **Bemidji-only proximity bias** for geocoding (Mapbox `proximity=-94.8826,47.4716`). Don't let this leak into sale data — addresses are still real US addresses, just biased toward Bemidji results when ambiguous. Now that the app is open nationwide, this may produce off-target geocodes for users elsewhere; revisit if Missa flags it.
- **Round-trip is the default** for Optimize Order because Mapbox v1 doesn't support open-end optimization. The "Return to start" checkbox lets users opt out (uses Directions API one-way path).
- **30 min per stop** is the timeline assumption. Hard-coded for now; could become user-configurable if asked.
- **"Let's go!" wording** for the save-to-wishlist button — Missa's preference, kept verbatim across cards, popovers, and the detail page.
- **`route_date` lives on the route, not on stops.** A route is for a single day; stops inherit that day implicitly.
- **Sale photos cleanup is best-effort.** When a sale is deleted, the client tries to remove its photos from storage but doesn't block on failure.
- **Status `closed` hides from browse but not from `/my-sales`.** Owner can revert it to `open` at any time. Past sales (date-based) and closed sales (status-based) are both excluded from the public map.
- **Realtime channels** are owned by the page/layout that subscribes; teardown happens in `onBeforeUnmount` via `supabase.removeChannel(channel)`. Don't forget this when adding new subscribers — leaked channels burn Supabase realtime quota.
- **No physical thread DELETE.** As of migration 0014 the user-facing DELETE policy on `message_threads` is gone — "Remove from inbox" only flips a per-user hide flag. If a future feature genuinely needs to wipe a thread (admin tooling, legal removal, etc.) it'll need a service-role escape hatch, not a user-visible button.
- **Inbox unread is delta-driven, not refetch-driven.** The layout's realtime channel increments / decrements `unread.count` from `payload.new.sender_id` instead of refetching `count(*)`. This requires that the only legal `messages` UPDATE is `read_at` (enforced by 0012's column-level grant) — if that constraint loosens, the delta math has to change too.
- **No physical sale DELETE from the UI.** As of migration 0017 the owner "Delete" button does a soft-delete (`deleted_at = now()`). Saved-sales / route-stops referencing the row stay rendered as red tombstones until the cron purges 30 days later. If a future flow genuinely needs an immediate hard-delete (legal takedown, etc.) it'll need a service-role path.
- **Removed vs Expired routing semantics.** Tombstones (red) are excluded from route optimize/build/maps export — the listing is gone, no point routing to it. Expired sales (yellow, end_date past) are KEPT in route calculations because their coords are still valid and the user might be reflecting on a past route. Different rule, on purpose.
- **Buyer-only thread initiation.** Migration 0016's `find_or_create_thread` rejects calls where the caller is the sale owner OR the other party is not the sale owner. Only buyers can start threads; owners can only reply. If a future feature lets sellers proactively reach out to interested buyers it'll need its own RPC.
- **`sale_dates` is the source of truth for a sale's schedule.** `garage_sales.start_date`/`end_date`/`start_time`/`end_time` are a denormalized envelope, kept in sync by an AFTER trigger on `sale_dates` inserts/updates/deletes. Always write to `sale_dates`; reading the envelope is fine for date-range cuts (cron, `fetchActiveSales`'s `gte('end_date', today)`, sitemap) but every UI affordance — display, filters, route hours, JSON-LD, overlap detection — should iterate `sale_dates`. The envelope can over-claim hours when a sale has heterogeneous days (a Thu/Fri 8–5 + Sat 8–2 sale shows envelope 8–5).
- **Idle signout is layout-scoped.** `useIdleSignout()` is called once from `app/layouts/default.vue` so it covers every page that uses the default layout. Auth pages (`/login`, `/signup`, etc.) use the same layout but the composable is a no-op when there's no user — so a freshly arriving user idling on `/login` doesn't get bounced. If we ever add a no-chrome auth-only layout, we'd need to re-call the composable there too (or move it to a plugin).
- **Owner status updates are eventually-consistent across tabs.** When the owner flips a sale's status (open / running_late / winding_down / closed) on `/sale/[id]`, the local tab updates instantly via the page's `setStatus` mutation. Other tabs (an open `/browse` in another window) only pick up the change on their next refresh — `garage_sales` isn't in the realtime publication. If cross-tab live sync becomes important, add the table to `supabase_realtime` and subscribe to UPDATE events on `/browse` (filter by `id` or refresh by signature).
- **Mobile rollout is staged.** Phase 1 is the PWA (shipped 2026-05-07): installable, offline-capable, distributed via the web — no app stores. Phase 2 (when there's audience demand) is wrapping the existing Nuxt build in Capacitor for App Store / Play Store presence + push notifications. We are NOT planning a React Native / Flutter rewrite — the workload (browsing, lists, forms, map) is well-served by a WebView and a rewrite would burn weeks for marginal gain. See `~/.claude/projects/C--Users-missa-garage-sales/memory/project_mobile_strategy.md` for the full plan.
