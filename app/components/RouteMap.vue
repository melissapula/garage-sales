<script setup lang="ts">
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { GarageSale } from '~/composables/useGarageSales'

const props = defineProps<{
    /** Sales the user has added to this route, in (potentially manual) order. */
    stops: { sale: GarageSale }[]
    /** Optimized visit order — array of indices into stops. Null = use stops as-is. */
    order: number[] | null
    /** Optimized route polyline. */
    routeGeometry: GeoJSON.LineString | null
    /** Driver's start location. */
    start: { lng: number; lat: number; label?: string } | null
    /**
     * Saved sales available on this route's date that aren't yet in the route.
     * Rendered as small status-colored pins with hover/click sync.
     */
    available?: GarageSale[]
    /** Currently click-selected available sale (persistent popover, pans map). */
    selectedAvailableId?: string | null
    /** Currently hovered available sale (transient popover). */
    hoveredAvailableId?: string | null
}>()

const emit = defineEmits<{
    (e: 'select-available', saleId: string): void
    (e: 'hover-available', saleId: string | null): void
    (e: 'clear-available'): void
}>()

const config = useRuntimeConfig()
const mapEl = ref<HTMLDivElement | null>(null)
let map: mapboxgl.Map | null = null
let resizeObserver: ResizeObserver | null = null
const markers: mapboxgl.Marker[] = []

const BEMIDJI: [number, number] = [-94.8826, 47.4716]
const ROUTE_SOURCE_ID = 'route'
const ROUTE_LAYER_ID = 'route-line'

// Available-pin popover state (matches BrowseMap's pattern).
let activePopup: mapboxgl.Popup | null = null
let activePopupSaleId: string | null = null
let activePopupPersistent = false
let hoverCloseTimer: ReturnType<typeof setTimeout> | null = null

function clearMarkers() {
    while (markers.length) markers.pop()?.remove()
}

function clearHoverTimer() {
    if (hoverCloseTimer) {
        clearTimeout(hoverCloseTimer)
        hoverCloseTimer = null
    }
}

function buildNumberedMarker(n: number): HTMLDivElement {
    const el = document.createElement('div')
    el.style.cssText = `
        background: #F97316;
        color: white;
        font-family: 'DM Sans', sans-serif;
        font-weight: 700;
        font-size: 14px;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        cursor: pointer;
    `
    el.textContent = String(n)
    return el
}

function buildAvailableMarker(color: string): HTMLDivElement {
    const el = document.createElement('div')
    el.style.cssText = `
        background: ${color};
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid white;
        box-shadow: 0 1px 4px rgba(0,0,0,0.25);
        cursor: pointer;
    `
    return el
}

function buildStartMarker(label = 'You'): HTMLDivElement {
    const el = document.createElement('div')
    el.style.cssText = `
        background: #0EA5E9;
        color: white;
        font-family: 'DM Sans', sans-serif;
        font-weight: 700;
        font-size: 11px;
        min-width: 36px;
        height: 36px;
        padding: 0 8px;
        border-radius: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    `
    el.textContent = label
    return el
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function buildAvailablePopupHtml(sale: GarageSale, withCloseButton: boolean): string {
    const closeBtn = withCloseButton
        ? `<button type="button" data-popup-close style="position:absolute;top:4px;right:4px;width:22px;height:22px;border:0;background:transparent;cursor:pointer;color:#9ca3af;font-size:18px;line-height:1;padding:0;" aria-label="Close">×</button>`
        : ''
    return `
        <div style="font-family:'DM Sans',sans-serif;max-width:220px;position:relative;padding-right:${withCloseButton ? '20px' : '0'};">
            ${closeBtn}
            <div style="font-family:'Playfair Display',serif;font-weight:700;font-size:14px;line-height:1.2;">
                ${escapeHtml(sale.title)}
            </div>
            <div style="margin-top:3px;font-size:12px;color:#374151;">${escapeHtml(sale.address)}</div>
            <div style="margin-top:5px;font-size:11px;color:#6B7280;font-style:italic;">Saved — not yet in your route</div>
        </div>
    `
}

function showAvailablePopup(saleId: string, persistent: boolean) {
    if (!map) return
    const sale = (props.available ?? []).find((s) => s.id === saleId)
    if (!sale) return

    clearHoverTimer()

    if (activePopupSaleId === saleId && activePopupPersistent === persistent) return
    if (activePopup) {
        activePopup.remove()
        activePopup = null
    }

    activePopup = new mapboxgl.Popup({
        offset: 14,
        closeButton: false,
        closeOnClick: false,
        focusAfterOpen: false,
    })
        .setLngLat([sale.lng, sale.lat])
        .setHTML(buildAvailablePopupHtml(sale, persistent))
        .addTo(map)
    activePopupSaleId = saleId
    activePopupPersistent = persistent

    const popupEl = activePopup.getElement()
    if (!persistent) {
        popupEl.addEventListener('mouseenter', clearHoverTimer)
        popupEl.addEventListener('mouseleave', scheduleHoverClose)
    } else {
        // Pan/zoom in to make the pin visible.
        map.flyTo({
            center: [sale.lng, sale.lat],
            zoom: Math.max(map.getZoom(), 13),
            duration: 600,
            essential: true,
        })
    }
}

function closeActivePopup() {
    activePopup?.remove()
    activePopup = null
    activePopupSaleId = null
    activePopupPersistent = false
}

function scheduleHoverClose() {
    clearHoverTimer()
    hoverCloseTimer = setTimeout(() => {
        if (!activePopupPersistent) {
            closeActivePopup()
            emit('hover-available', null)
        }
    }, 250)
}

function render() {
    if (!map) return
    clearMarkers()

    const order = props.order ?? props.stops.map((_, i) => i)

    order.forEach((stopIdx, visitIdx) => {
        const stop = props.stops[stopIdx]
        if (!stop) return
        const marker = new mapboxgl.Marker({ element: buildNumberedMarker(visitIdx + 1) })
            .setLngLat([stop.sale.lng, stop.sale.lat])
            .setPopup(
                new mapboxgl.Popup({ offset: 24 }).setHTML(
                    `<div style="font-family:'DM Sans',sans-serif;max-width:220px;">
                        <div style="font-family:'Playfair Display',serif;font-weight:700;font-size:15px;">${escapeHtml(stop.sale.title)}</div>
                        <div style="margin-top:4px;font-size:12px;color:#374151;">${escapeHtml(stop.sale.address)}</div>
                    </div>`,
                ),
            )
            .addTo(map!)
        markers.push(marker)
    })

    if (props.start) {
        const startMarker = new mapboxgl.Marker({ element: buildStartMarker(props.start.label) })
            .setLngLat([props.start.lng, props.start.lat])
            .addTo(map)
        markers.push(startMarker)
    }

    // Available (saved-but-not-added) sales as small status-colored pins
    // with hover + click sync back to the parent.
    for (const sale of props.available ?? []) {
        const color = pinColor(saleStatus(sale))
        const marker = new mapboxgl.Marker({ element: buildAvailableMarker(color) })
            .setLngLat([sale.lng, sale.lat])
            .addTo(map!)
        const el = marker.getElement()
        el.addEventListener('mouseenter', () => {
            if (activePopupPersistent) return
            emit('hover-available', sale.id)
        })
        el.addEventListener('mouseleave', () => {
            if (activePopupPersistent) return
            scheduleHoverClose()
        })
        el.addEventListener('click', (e) => {
            e.stopPropagation()
            emit('select-available', sale.id)
        })
        markers.push(marker)
    }

    // Route polyline.
    const existing = map.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined
    if (props.routeGeometry) {
        const geo: GeoJSON.Feature<GeoJSON.LineString> = {
            type: 'Feature',
            properties: {},
            geometry: props.routeGeometry,
        }
        if (existing) {
            existing.setData(geo)
        } else {
            map.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data: geo })
            map.addLayer({
                id: ROUTE_LAYER_ID,
                type: 'line',
                source: ROUTE_SOURCE_ID,
                paint: {
                    'line-color': '#0EA5E9',
                    'line-width': 5,
                    'line-opacity': 0.85,
                },
                layout: { 'line-cap': 'round', 'line-join': 'round' },
            })
        }
    } else if (existing) {
        existing.setData({ type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection)
    }

    // Fit to all known points.
    const allCoords: [number, number][] = props.stops.map((s) => [s.sale.lng, s.sale.lat])
    if (props.start) allCoords.push([props.start.lng, props.start.lat])
    for (const sale of props.available ?? []) {
        allCoords.push([sale.lng, sale.lat])
    }
    if (allCoords.length > 0) {
        const bounds = allCoords.reduce(
            (b, c) => b.extend(c),
            new mapboxgl.LngLatBounds(allCoords[0], allCoords[0]),
        )
        map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 })
    }
}

function syncFromProps() {
    if (props.selectedAvailableId) {
        showAvailablePopup(props.selectedAvailableId, true)
    } else if (props.hoveredAvailableId) {
        showAvailablePopup(props.hoveredAvailableId, false)
    } else {
        closeActivePopup()
    }
}

onMounted(() => {
    if (!mapEl.value) return
    mapboxgl.accessToken = config.public.mapboxToken as string
    map = new mapboxgl.Map({
        container: mapEl.value,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: BEMIDJI,
        zoom: 11,
    })
    map.addControl(new mapboxgl.NavigationControl(), 'top-right')

    // Click handler for popup close button + click-outside.
    mapEl.value.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement | null
        if (!target) return
        const closeBtn = target.closest('[data-popup-close]')
        if (closeBtn) {
            ev.stopPropagation()
            emit('clear-available')
            return
        }
        const onMarker = target.closest('.mapboxgl-marker')
        const onPopup = target.closest('.mapboxgl-popup')
        if (!onMarker && !onPopup && activePopupPersistent) {
            emit('clear-available')
        }
    })

    map.on('click', () => {
        if (activePopupPersistent) emit('clear-available')
    })

    map.on('load', () => {
        render()
        syncFromProps()
    })

    // Mapbox's built-in trackResize only fires on *window* resizes, so
    // the canvas would freeze at its initial container width whenever
    // surrounding layout shifts grew the column (longer stops list,
    // expanded "available saved sales" panel, etc.). Watch the
    // container itself and resize on every change. Same fix we applied
    // to BrowseMap for the same reason.
    resizeObserver = new ResizeObserver(() => {
        map?.resize()
    })
    resizeObserver.observe(mapEl.value)
})

onBeforeUnmount(() => {
    clearHoverTimer()
    closeActivePopup()
    clearMarkers()
    resizeObserver?.disconnect()
    resizeObserver = null
    map?.remove()
    map = null
})

// Stable signature watch instead of deep on the prop arrays — same
// pattern BrowseMap uses (id:lat:lng per pin). A non-spatial property
// change on an available sale (e.g. owner flipped status to closed via
// realtime) would otherwise tear down and re-create every marker, which
// drops the user's hover state mid-interaction. Popup HTML reads
// `props.available.find(...)` on each open so non-marker fields stay
// live without a rebuild.
const renderSignature = computed(() => {
    const stopSig = props.stops.map((s) => `${s.sale.id}:${s.sale.lat}:${s.sale.lng}`).join('|')
    const orderSig = props.order ? props.order.join(',') : 'natural'
    const startSig = props.start
        ? `${props.start.lng}:${props.start.lat}:${props.start.label ?? ''}`
        : 'none'
    const availSig = (props.available ?? []).map((s) => `${s.id}:${s.lat}:${s.lng}`).join('|')
    return `${stopSig}#${orderSig}#${startSig}#${availSig}`
})
watch(renderSignature, () => {
    if (map?.loaded()) {
        render()
        syncFromProps()
    }
})
// Geometry is a complex GeoJSON object; reference equality is the right
// granularity here (a new optimize call always produces a new ref).
watch(() => props.routeGeometry, () => {
    if (map?.loaded()) {
        render()
        syncFromProps()
    }
})
watch(() => props.selectedAvailableId, syncFromProps)
watch(() => props.hoveredAvailableId, () => {
    if (props.selectedAvailableId) return
    syncFromProps()
})
</script>

<template>
    <div ref="mapEl" class="h-[60vh] min-h-[400px] w-full rounded-xl shadow-sm" />
</template>
