// Generates public/og-image.png — the 1200×630 social-share card used by
// /, /sale/[id], and /share/[id] as the OG fallback when a sale has no
// photos (or when the page isn't a sale page at all).
//
// Re-run any time the brand / wordmark / tagline changes:
//   node scripts/generate-og-image.mjs
//   (or: npm run og:generate)
//
// Renders via Satori (CSS → SVG) + resvg (SVG → PNG). Loads Playfair
// Display and DM Sans from Google Fonts at run-time so the rendered
// text matches the in-app brand exactly.

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Brand tokens — kept in sync with tailwind.config + CLAUDE.md.
const BRAND_ORANGE = '#F97316'; // brand-500
const BRAND_ORANGE_DARK = '#9A3412'; // orange-800 — wordmark
const BRAND_CREAM = '#FFFBEB'; // background
const TEXT_DARK = '#1F2937'; // gray-800
const TEXT_MUTED = '#4B5563'; // gray-600
const PIN_GREEN = '#22C55E'; // active sales
const PIN_YELLOW = '#EAB308'; // upcoming sales

/**
 * Fetch a Google Font's TTF binary at a specific weight. Returns an
 * ArrayBuffer suitable for handing to Satori's `fonts` option.
 *
 * Satori's bundled opentype parser doesn't handle woff2, so we send an
 * old User-Agent that doesn't advertise woff2 support; Google Fonts
 * falls back to TTF in that case. Then we parse the @font-face block
 * for the actual file URL and fetch the binary.
 */
async function fetchGoogleFont(family, weight) {
    const familyParam = family.replace(/ /g, '+');
    const cssUrl = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${weight}&display=swap`;
    const cssRes = await fetch(cssUrl, {
        headers: {
            // IE9 UA → Google Fonts serves TTF instead of woff2.
            'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; Trident/5.0; rv:9.0) like Gecko',
        },
    });
    if (!cssRes.ok) {
        throw new Error(`Google Fonts CSS fetch failed (${cssRes.status}) for ${family} ${weight}`);
    }
    const css = await cssRes.text();
    const match = css.match(/url\((https:\/\/[^)]+\.(?:ttf|otf|woff))\)/);
    if (!match) {
        throw new Error(`No TTF/OTF/WOFF URL found in CSS for ${family} ${weight} — got:\n${css}`);
    }
    const fontRes = await fetch(match[1]);
    if (!fontRes.ok) {
        throw new Error(`Font binary fetch failed (${fontRes.status}) for ${family} ${weight}`);
    }
    return await fontRes.arrayBuffer();
}

console.log('Loading fonts from Google Fonts…');
const [playfair700, dmsans500, dmsans700] = await Promise.all([
    fetchGoogleFont('Playfair Display', 700),
    fetchGoogleFont('DM Sans', 500),
    fetchGoogleFont('DM Sans', 700),
]);

/**
 * Build a single map-pin teardrop using CSS borderRadius + transform.
 * Satori doesn't support arbitrary SVG paths so we draw the shape with
 * three sharp corners rounded and the fourth left at 0, then rotate
 * -45deg so the sharp corner points to bottom-left.
 */
function pin({ color, size, top, right, shadow = true }) {
    return {
        type: 'div',
        props: {
            style: {
                position: 'absolute',
                top,
                right,
                width: size,
                height: size,
                backgroundColor: color,
                borderRadius: '50% 50% 50% 0',
                transform: 'rotate(-45deg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: shadow ? '0 8px 20px rgba(15, 23, 42, 0.18)' : 'none',
            },
            children: [
                // Inner white dot so the pin reads as a pin and not a balloon
                {
                    type: 'div',
                    props: {
                        style: {
                            width: Math.round(size * 0.34),
                            height: Math.round(size * 0.34),
                            backgroundColor: '#FFFFFF',
                            borderRadius: '50%',
                            display: 'flex',
                        },
                    },
                },
            ],
        },
    };
}

const tree = {
    type: 'div',
    props: {
        style: {
            width: 1200,
            height: 630,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            backgroundColor: BRAND_CREAM,
            padding: '80px 96px',
            position: 'relative',
            fontFamily: 'DM Sans',
        },
        children: [
            // Decorative pins clustered upper-right
            pin({ color: PIN_GREEN, size: 132, top: 70, right: 140 }),
            pin({ color: PIN_YELLOW, size: 96, top: 180, right: 260 }),
            pin({ color: BRAND_ORANGE, size: 86, top: 245, right: 60 }),

            // Wordmark + accent bar
            {
                type: 'div',
                props: {
                    style: {
                        display: 'flex',
                        flexDirection: 'column',
                    },
                    children: [
                        {
                            type: 'div',
                            props: {
                                style: {
                                    fontFamily: 'Playfair Display',
                                    fontWeight: 700,
                                    fontSize: 96,
                                    color: BRAND_ORANGE_DARK,
                                    lineHeight: 1,
                                    letterSpacing: '-0.02em',
                                    display: 'flex',
                                },
                                children: 'Garage Sale Tracker',
                            },
                        },
                        {
                            type: 'div',
                            props: {
                                style: {
                                    width: 160,
                                    height: 10,
                                    backgroundColor: BRAND_ORANGE,
                                    marginTop: 24,
                                    borderRadius: 6,
                                    display: 'flex',
                                },
                            },
                        },
                    ],
                },
            },

            // Tagline (two lines, second muted)
            {
                type: 'div',
                props: {
                    style: {
                        display: 'flex',
                        flexDirection: 'column',
                        marginTop: 56,
                        fontFamily: 'DM Sans',
                    },
                    children: [
                        {
                            type: 'div',
                            props: {
                                style: {
                                    fontSize: 42,
                                    fontWeight: 500,
                                    color: TEXT_DARK,
                                    lineHeight: 1.25,
                                    display: 'flex',
                                },
                                children: 'Find every yard, garage, and estate sale near you.',
                            },
                        },
                        {
                            type: 'div',
                            props: {
                                style: {
                                    fontSize: 42,
                                    fontWeight: 500,
                                    color: TEXT_MUTED,
                                    lineHeight: 1.25,
                                    marginTop: 8,
                                    display: 'flex',
                                },
                                children: 'Plan your route in one go.',
                            },
                        },
                    ],
                },
            },
        ],
    },
};

console.log('Rendering SVG via Satori…');
const svg = await satori(tree, {
    width: 1200,
    height: 630,
    fonts: [
        { name: 'Playfair Display', data: playfair700, weight: 700, style: 'normal' },
        { name: 'DM Sans', data: dmsans500, weight: 500, style: 'normal' },
        { name: 'DM Sans', data: dmsans700, weight: 700, style: 'normal' },
    ],
});

console.log('Rasterizing SVG → PNG via resvg…');
const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    background: BRAND_CREAM,
})
    .render()
    .asPng();

const outPath = resolve(projectRoot, 'public/og-image.png');
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, png);

console.log(`Wrote ${outPath} (${png.length.toLocaleString()} bytes, 1200×630)`);
