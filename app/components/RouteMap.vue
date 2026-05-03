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
     * Rendered as small status-colored pins (green = today, yellow = upcoming)
     * so the user can see where their options are while picking which to add.
     */
    available?: GarageSale[]
}>()

const config = useRuntimeConfig()
const mapEl = ref<HTMLDivElement | null>(null)
let map: mapboxgl.Map | null = null
const markers: mapboxgl.Marker[] = []

const BEMIDJI: [number, number] = [-94.8826, 47.4716]
const ROUTE_SOURCE_ID = 'route'
const ROUTE_LAYER_ID = 'route-line'

function clearMarkers() {
    while (markers.length) markers.pop()?.remove()
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
        width: 16px;
        height: 16px;
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

    // Available (saved-but-not-added) sales as small status-colored pins.
    for (const sale of props.available ?? []) {
        const color = pinColor(saleStatus(sale))
        const marker = new mapboxgl.Marker({ element: buildAvailableMarker(color) })
            .setLngLat([sale.lng, sale.lat])
            .setPopup(
                new mapboxgl.Popup({ offset: 14 }).setHTML(
                    `<div style="font-family:'DM Sans',sans-serif;max-width:220px;">
                        <div style="font-family:'Playfair Display',serif;font-weight:700;font-size:14px;">${escapeHtml(sale.title)}</div>
                        <div style="margin-top:3px;font-size:12px;color:#374151;">${escapeHtml(sale.address)}</div>
                        <div style="margin-top:4px;font-size:11px;color:#6B7280;font-style:italic;">Saved — not yet in your route</div>
                    </div>`,
                ),
            )
            .addTo(map!)
        markers.push(marker)
    }

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
    map.on('load', render)
})

onBeforeUnmount(() => {
    clearMarkers()
    map?.remove()
    map = null
})

watch(
    () => [props.stops, props.order, props.routeGeometry, props.start, props.available],
    () => {
        if (map?.loaded()) render()
    },
    { deep: true },
)
</script>

<template>
    <div ref="mapEl" class="h-[60vh] min-h-[400px] w-full rounded-xl shadow-sm" />
</template>
