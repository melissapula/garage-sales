<script setup lang="ts">
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { GarageSale } from '~/composables/useGarageSales';

const props = defineProps<{
    sales: GarageSale[];
    selectedId: string | null;
    hoveredId: string | null;
    initialCenter?: [number, number] | null;
}>();

const emit = defineEmits<{
    (e: 'select', saleId: string): void;
    (e: 'hover', saleId: string | null): void;
    (e: 'clear'): void;
    (e: 'lets-go', saleId: string): void;
}>();

const config = useRuntimeConfig();
const user = useSupabaseUser();
const { isSaved } = useSavedSales();

const mapEl = ref<HTMLDivElement | null>(null);
let map: mapboxgl.Map | null = null;
let resizeObserver: ResizeObserver | null = null;
const markers = new Map<string, mapboxgl.Marker>();

const BEMIDJI: [number, number] = [-94.8826, 47.4716];

let activePopup: mapboxgl.Popup | null = null;
let activePopupSaleId: string | null = null;
/**
 * `persistent` means the popup was opened by a click and stays until the user
 * clicks the close-X or clicks outside. Hovering pin/popup will not close it.
 */
let activePopupPersistent = false;
let hoverCloseTimer: ReturnType<typeof setTimeout> | null = null;

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function actionHtml(sale: GarageSale): string {
    if (!user.value) {
        return `<a href="/login" data-internal-link style="display:inline-flex;align-items:center;gap:4px;color:#0369A1;font-size:13px;font-weight:600;text-decoration:none;">Sign in to save</a>`;
    }
    if (isSaved(sale.id)) {
        return `<span style="display:inline-flex;align-items:center;gap:4px;color:#15803d;font-size:13px;font-weight:600;">✓ On your list</span>`;
    }
    // Sale IDs are gen_random_uuid() and safe today, but HTML-escape
    // for defense-in-depth so a future change that lets user-supplied
    // strings flow into a popup attribute can't re-introduce injection.
    return `<button type="button" data-lets-go="${escapeHtml(sale.id)}" style="display:inline-flex;align-items:center;justify-content:center;gap:4px;background:#F97316;color:white;border:0;border-radius:8px;padding:10px 14px;min-height:40px;font-size:14px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">Let's go!</button>`;
}

function buildPopupHtml(sale: GarageSale, withCloseButton: boolean): string {
    const compact = summarizeSchedule(sale).compact;
    const status = saleStatus(sale);
    const dateBadge =
        status === 'active'
            ? '<span style="background:#DCFCE7;color:#166534;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">Today</span>'
            : '<span style="background:#FEF9C3;color:#854D0E;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">Upcoming</span>';
    const ownerOpt = statusOption(sale.status);
    const ownerToneStyles: Record<string, string> = {
        warn: 'background:#FEF3C7;color:#92400E;',
        caution: 'background:#FFEDD5;color:#9A3412;',
    };
    const ownerBadge =
        sale.status === 'open'
            ? ''
            : `<span title="${escapeHtml(ownerOpt.description)}" style="${ownerToneStyles[ownerOpt.tone] || ''}padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:3px;cursor:help;">${ownerOpt.icon} ${ownerOpt.short}</span>`;
    const badge = `${dateBadge}${ownerBadge ? ' ' + ownerBadge : ''}`;
    const closeBtn = withCloseButton
        ? `<button type="button" data-popup-close style="position:absolute;top:6px;right:6px;width:24px;height:24px;border:0;background:transparent;cursor:pointer;color:#9ca3af;font-size:20px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;" aria-label="Close">×</button>`
        : '';
    return `
        <div style="font-family:'DM Sans',system-ui,sans-serif;max-width:240px;position:relative;padding-right:${withCloseButton ? '20px' : '0'};">
            ${closeBtn}
            <div style="margin-bottom:6px;">${badge}</div>
            <div style="font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:#111827;line-height:1.2;">
                ${escapeHtml(sale.title)}
            </div>
            <div style="margin-top:4px;font-size:13px;color:#374151;">${escapeHtml(sale.address)}</div>
            <div style="margin-top:6px;font-size:13px;color:#1f2937;font-weight:500;">${escapeHtml(compact)}</div>
            <div style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                ${actionHtml(sale)}
            </div>
        </div>
    `;
}

function clearHoverTimer() {
    if (hoverCloseTimer) {
        clearTimeout(hoverCloseTimer);
        hoverCloseTimer = null;
    }
}

function showPopup(saleId: string, persistent: boolean) {
    if (!map) return;
    const sale = props.sales.find((s) => s.id === saleId);
    if (!sale) return;

    clearHoverTimer();

    if (activePopupSaleId === saleId && activePopupPersistent === persistent) return;
    if (activePopup) {
        activePopup.remove();
        activePopup = null;
    }

    activePopup = new mapboxgl.Popup({
        offset: 24,
        closeButton: false,
        closeOnClick: false,
        focusAfterOpen: false,
    })
        .setLngLat([sale.lng, sale.lat])
        .setHTML(buildPopupHtml(sale, persistent))
        .addTo(map);
    activePopupSaleId = saleId;
    activePopupPersistent = persistent;

    const popupEl = activePopup.getElement();
    if (!persistent) {
        popupEl.addEventListener('mouseenter', clearHoverTimer);
        popupEl.addEventListener('mouseleave', scheduleHoverClose);
    } else {
        // For a click-selected pin, ease the map over so the pin is visible.
        // Don't pan on hover — that's jarring as the cursor moves through the list.
        map.flyTo({
            center: [sale.lng, sale.lat],
            zoom: Math.max(map.getZoom(), 13),
            duration: 700,
            essential: true,
        });
    }
}

function closePopup() {
    activePopup?.remove();
    activePopup = null;
    activePopupSaleId = null;
    activePopupPersistent = false;
}

function scheduleHoverClose() {
    clearHoverTimer();
    hoverCloseTimer = setTimeout(() => {
        // Only auto-close if the popup is transient.
        if (!activePopupPersistent) {
            closePopup();
            emit('hover', null);
        }
    }, 400);
}

function clearMarkers() {
    for (const m of markers.values()) m.remove();
    markers.clear();
}

function renderMarkers() {
    if (!map) return;
    clearMarkers();
    for (const sale of props.sales) {
        const color = pinColor(saleStatus(sale));
        const marker = new mapboxgl.Marker({ color }).setLngLat([sale.lng, sale.lat]).addTo(map);
        const el = marker.getElement();
        el.style.cursor = 'pointer';
        el.addEventListener('mouseenter', () => {
            // Don't override a persistent (clicked) popup.
            if (activePopupPersistent) return;
            // Clear any pending hover-close BEFORE emitting. If the popup
            // for this sale is already open (cursor moved popup → pin),
            // the parent's hoveredId ref is already this sale.id, so the
            // ref assignment is a no-op and the watcher doesn't fire —
            // meaning showPopup's clearHoverTimer never runs and the
            // popup would auto-close mid-hover. Clearing here covers it.
            clearHoverTimer();
            emit('hover', sale.id);
        });
        el.addEventListener('mouseleave', () => {
            if (activePopupPersistent) return;
            scheduleHoverClose();
        });
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            emit('select', sale.id);
        });
        markers.set(sale.id, marker);
    }
}

function refreshActivePopupHtml() {
    if (!activePopup || !activePopupSaleId) return;
    const sale = props.sales.find((s) => s.id === activePopupSaleId);
    if (sale) activePopup.setHTML(buildPopupHtml(sale, activePopupPersistent));
}

onMounted(async () => {
    if (!mapEl.value) return;
    mapboxgl.accessToken = config.public.mapboxToken as string;
    map = new mapboxgl.Map({
        container: mapEl.value,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: props.initialCenter ?? BEMIDJI,
        zoom: 11,
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(
        new mapboxgl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: false,
            showUserHeading: true,
        }),
        'top-right',
    );

    // Click handler: "Let's go!" button + close-X + click-outside.
    mapEl.value.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement | null;
        if (!target) return;

        const closeBtn = target.closest('[data-popup-close]');
        if (closeBtn) {
            ev.stopPropagation();
            emit('clear');
            return;
        }

        const letsGoBtn = target.closest('[data-lets-go]') as HTMLElement | null;
        if (letsGoBtn) {
            ev.stopPropagation();
            const saleId = letsGoBtn.dataset.letsGo;
            if (saleId) emit('lets-go', saleId);
            return;
        }

        // Click anywhere else on the map (not on a marker, popup or button)
        // clears any persistent selection.
        const onMarker = target.closest('.mapboxgl-marker');
        const onPopup = target.closest('.mapboxgl-popup');
        if (!onMarker && !onPopup && activePopupPersistent) {
            emit('clear');
        }
    });

    map.on('load', () => {
        renderMarkers();
        // Apply initial selection state once markers are placed.
        syncFromProps();
        // Frame all visible sales on first paint (after the user
        // grants geolocation, fitToSales overrides the initial center
        // if there are pins to show).
        fitToSales();
    });

    // Mapbox's built-in trackResize only listens for *window* resizes, so
    // when the container grows due to internal layout changes (e.g., the
    // mobile stacked detail+map view, or tabs swapping panes) the canvas
    // is left at its original size and tiles stop rendering past that
    // boundary. Watch the container itself and resize on every change.
    resizeObserver = new ResizeObserver(() => {
        map?.resize();
    });
    resizeObserver.observe(mapEl.value);

    // Mapbox's own canvas click — fires reliably on touch devices when the
    // synthesized DOM click gets eaten by Mapbox's gesture system. It does
    // NOT fire when a marker is tapped because marker clicks stopPropagation.
    map.on('click', () => {
        if (activePopupPersistent) emit('clear');
    });

    await useSavedSales().refresh();
});

onBeforeUnmount(() => {
    clearHoverTimer();
    closePopup();
    clearMarkers();
    resizeObserver?.disconnect();
    resizeObserver = null;
    map?.remove();
    map = null;
});

function syncFromProps() {
    if (props.selectedId) {
        showPopup(props.selectedId, true);
    } else if (props.hoveredId) {
        showPopup(props.hoveredId, false);
    } else {
        closePopup();
    }
}

watch(() => props.selectedId, syncFromProps);
watch(
    () => props.hoveredId,
    () => {
        // Hover changes ignored when a selection is active.
        if (props.selectedId) return;
        syncFromProps();
    },
);
// Rebuild markers only when the *set* of pinned sales actually changes
// (add/remove/move). Watching `props.sales` with `deep: true` would tear
// down and re-create every Mapbox marker — and kill the user's hover
// state mid-interaction — on any property of any sale changing (e.g. a
// realtime status update). The popup HTML reads `props.sales.find(...)`
// each time it opens, so non-marker fields stay live without a rebuild.
watch(
    () => props.sales.map((s) => `${s.id}:${s.lat}:${s.lng}`).join('|'),
    () => {
        if (map?.loaded()) {
            renderMarkers();
            syncFromProps();
            fitToSales();
        }
    },
);

/**
 * Frame the map so every visible sale is on screen. Triggered on
 * filtered-set changes — flipping a filter or hitting Refresh
 * recomputes the bounds. We don't snap on hover/select changes
 * because those don't change the set, so a user who's manually panned
 * won't get yanked around mid-interaction.
 *
 * `maxZoom: 13` keeps a single-pin result from zooming to street
 * level; padding keeps pins off the legend / nav-control overlays.
 */
function fitToSales() {
    if (!map || props.sales.length === 0) return;
    const bounds = new mapboxgl.LngLatBounds();
    for (const s of props.sales) bounds.extend([s.lng, s.lat]);
    map.fitBounds(bounds, {
        padding: { top: 80, right: 60, bottom: 60, left: 60 },
        maxZoom: 13,
        duration: 600,
    });
}

// If the initial center resolves after mount (e.g., the user grants the
// browser geolocation prompt asynchronously), fly the map there. We don't
// fly when the prop is cleared back to null — that only happens on a
// browser without a cached location, where the map already shows Bemidji.
watch(
    () => props.initialCenter,
    (next) => {
        if (!next || !map) return;
        map.flyTo({ center: next, zoom: Math.max(map.getZoom(), 11), essential: true });
    },
);

watch(user, () => {
    useSavedSales().refresh();
    refreshActivePopupHtml();
});

// When the saved-set changes (after Let's-go!), refresh popup HTML.
const { savedSet } = useSavedSales();
watch(savedSet, refreshActivePopupHtml);
</script>

<template>
    <div ref="mapEl" class="h-full min-h-[420px] w-full rounded-xl shadow-sm" />
</template>
