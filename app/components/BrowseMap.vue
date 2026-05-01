<script setup lang="ts">
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { GarageSale } from '~/composables/useGarageSales'

const props = defineProps<{
    sales: GarageSale[]
    selectedId: string | null
    hoveredId: string | null
}>()

const emit = defineEmits<{
    (e: 'select', saleId: string): void
    (e: 'hover', saleId: string | null): void
    (e: 'clear'): void
    (e: 'lets-go', saleId: string): void
}>()

const config = useRuntimeConfig()
const user = useSupabaseUser()
const { isSaved } = useSavedSales()

const mapEl = ref<HTMLDivElement | null>(null)
let map: mapboxgl.Map | null = null
const markers = new Map<string, mapboxgl.Marker>()

const BEMIDJI: [number, number] = [-94.8826, 47.4716]

let activePopup: mapboxgl.Popup | null = null
let activePopupSaleId: string | null = null
/**
 * `persistent` means the popup was opened by a click and stays until the user
 * clicks the close-X or clicks outside. Hovering pin/popup will not close it.
 */
let activePopupPersistent = false
let hoverCloseTimer: ReturnType<typeof setTimeout> | null = null

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function actionHtml(sale: GarageSale): string {
    if (!user.value) {
        return `<a href="/login" data-internal-link style="display:inline-flex;align-items:center;gap:4px;color:#0369A1;font-size:13px;font-weight:600;text-decoration:none;">Sign in to save</a>`
    }
    if (isSaved(sale.id)) {
        return `<span style="display:inline-flex;align-items:center;gap:4px;color:#15803d;font-size:13px;font-weight:600;">✓ On your list</span>`
    }
    return `<button type="button" data-lets-go="${sale.id}" style="display:inline-flex;align-items:center;justify-content:center;gap:4px;background:#F97316;color:white;border:0;border-radius:8px;padding:10px 14px;min-height:40px;font-size:14px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">Let's go!</button>`
}

function buildPopupHtml(sale: GarageSale, withCloseButton: boolean): string {
    const dates = formatDateRange(sale.start_date, sale.end_date)
    const times = formatTimeRange(sale.start_time, sale.end_time)
    const status = saleStatus(sale)
    const dateBadge =
        status === 'active'
            ? '<span style="background:#DCFCE7;color:#166534;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">Today</span>'
            : '<span style="background:#FEF9C3;color:#854D0E;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;">Upcoming</span>'
    const ownerOpt = statusOption(sale.status)
    const ownerToneStyles: Record<string, string> = {
        warn: 'background:#FEF3C7;color:#92400E;',
        caution: 'background:#FFEDD5;color:#9A3412;',
    }
    const ownerBadge =
        sale.status === 'open'
            ? ''
            : `<span style="${ownerToneStyles[ownerOpt.tone] || ''}padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:3px;">${ownerOpt.icon} ${ownerOpt.short}</span>`
    const badge = `${dateBadge}${ownerBadge ? ' ' + ownerBadge : ''}`
    const closeBtn = withCloseButton
        ? `<button type="button" data-popup-close style="position:absolute;top:6px;right:6px;width:24px;height:24px;border:0;background:transparent;cursor:pointer;color:#9ca3af;font-size:20px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;" aria-label="Close">×</button>`
        : ''
    return `
        <div style="font-family:'DM Sans',system-ui,sans-serif;max-width:240px;position:relative;padding-right:${withCloseButton ? '20px' : '0'};">
            ${closeBtn}
            <div style="margin-bottom:6px;">${badge}</div>
            <div style="font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:#111827;line-height:1.2;">
                ${escapeHtml(sale.title)}
            </div>
            <div style="margin-top:4px;font-size:13px;color:#374151;">${escapeHtml(sale.address)}</div>
            <div style="margin-top:6px;font-size:13px;color:#1f2937;font-weight:500;">${dates}${
                times ? ` · ${times}` : ''
            }</div>
            <div style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                ${actionHtml(sale)}
            </div>
        </div>
    `
}

function clearHoverTimer() {
    if (hoverCloseTimer) {
        clearTimeout(hoverCloseTimer)
        hoverCloseTimer = null
    }
}

function showPopup(saleId: string, persistent: boolean) {
    if (!map) return
    const sale = props.sales.find((s) => s.id === saleId)
    if (!sale) return

    clearHoverTimer()

    if (activePopupSaleId === saleId && activePopupPersistent === persistent) return
    if (activePopup) {
        activePopup.remove()
        activePopup = null
    }

    activePopup = new mapboxgl.Popup({
        offset: 24,
        closeButton: false,
        closeOnClick: false,
        focusAfterOpen: false,
    })
        .setLngLat([sale.lng, sale.lat])
        .setHTML(buildPopupHtml(sale, persistent))
        .addTo(map)
    activePopupSaleId = saleId
    activePopupPersistent = persistent

    const popupEl = activePopup.getElement()
    if (!persistent) {
        popupEl.addEventListener('mouseenter', clearHoverTimer)
        popupEl.addEventListener('mouseleave', scheduleHoverClose)
    }
}

function closePopup() {
    activePopup?.remove()
    activePopup = null
    activePopupSaleId = null
    activePopupPersistent = false
}

function scheduleHoverClose() {
    clearHoverTimer()
    hoverCloseTimer = setTimeout(() => {
        // Only auto-close if the popup is transient.
        if (!activePopupPersistent) {
            closePopup()
            emit('hover', null)
        }
    }, 250)
}

function clearMarkers() {
    for (const m of markers.values()) m.remove()
    markers.clear()
}

function renderMarkers() {
    if (!map) return
    clearMarkers()
    for (const sale of props.sales) {
        const color = pinColor(saleStatus(sale))
        const marker = new mapboxgl.Marker({ color }).setLngLat([sale.lng, sale.lat]).addTo(map)
        const el = marker.getElement()
        el.style.cursor = 'pointer'
        el.addEventListener('mouseenter', () => {
            // Don't override a persistent (clicked) popup.
            if (activePopupPersistent) return
            emit('hover', sale.id)
        })
        el.addEventListener('mouseleave', () => {
            if (activePopupPersistent) return
            scheduleHoverClose()
        })
        el.addEventListener('click', (e) => {
            e.stopPropagation()
            emit('select', sale.id)
        })
        markers.set(sale.id, marker)
    }
}

function refreshActivePopupHtml() {
    if (!activePopup || !activePopupSaleId) return
    const sale = props.sales.find((s) => s.id === activePopupSaleId)
    if (sale) activePopup.setHTML(buildPopupHtml(sale, activePopupPersistent))
}

onMounted(async () => {
    if (!mapEl.value) return
    mapboxgl.accessToken = config.public.mapboxToken as string
    map = new mapboxgl.Map({
        container: mapEl.value,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: BEMIDJI,
        zoom: 11,
    })
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')
    map.addControl(
        new mapboxgl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            trackUserLocation: false,
            showUserHeading: true,
        }),
        'top-right',
    )

    // Click handler: "Let's go!" button + close-X + click-outside.
    mapEl.value.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement | null
        if (!target) return

        const closeBtn = target.closest('[data-popup-close]')
        if (closeBtn) {
            ev.stopPropagation()
            emit('clear')
            return
        }

        const letsGoBtn = target.closest('[data-lets-go]') as HTMLElement | null
        if (letsGoBtn) {
            ev.stopPropagation()
            const saleId = letsGoBtn.dataset.letsGo
            if (saleId) emit('lets-go', saleId)
            return
        }

        // Click anywhere else on the map (not on a marker, popup or button)
        // clears any persistent selection.
        const onMarker = target.closest('.mapboxgl-marker')
        const onPopup = target.closest('.mapboxgl-popup')
        if (!onMarker && !onPopup && activePopupPersistent) {
            emit('clear')
        }
    })

    map.on('load', () => {
        renderMarkers()
        // Apply initial selection state once markers are placed.
        syncFromProps()
    })

    await useSavedSales().refresh()
})

onBeforeUnmount(() => {
    clearHoverTimer()
    closePopup()
    clearMarkers()
    map?.remove()
    map = null
})

function syncFromProps() {
    if (props.selectedId) {
        showPopup(props.selectedId, true)
    } else if (props.hoveredId) {
        showPopup(props.hoveredId, false)
    } else {
        closePopup()
    }
}

watch(() => props.selectedId, syncFromProps)
watch(() => props.hoveredId, () => {
    // Hover changes ignored when a selection is active.
    if (props.selectedId) return
    syncFromProps()
})
watch(() => props.sales, () => {
    if (map?.loaded()) {
        renderMarkers()
        syncFromProps()
    }
}, { deep: true })

watch(user, () => {
    useSavedSales().refresh()
    refreshActivePopupHtml()
})

// When the saved-set changes (after Let's-go!), refresh popup HTML.
const { savedSet } = useSavedSales()
watch(savedSet, refreshActivePopupHtml)
</script>

<template>
    <div ref="mapEl" class="h-full min-h-[420px] w-full rounded-xl shadow-sm" />
</template>
