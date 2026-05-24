<script setup lang="ts">
/**
 * Render a plain-text string with bare http(s) URLs converted to safe
 * anchor tags. We never use v-html: the parser splits the input into
 * plain-text and link segments, and Vue's normal interpolation /
 * attribute binding handles escaping.
 *
 * Trailing punctuation that's almost never part of a URL (period,
 * comma, !, ?, closing paren, closing bracket) is peeled off so the
 * sentence reads naturally — `… see https://example.com.` links to
 * `https://example.com` and leaves the period in the surrounding text.
 */
const props = withDefaults(
    defineProps<{
        text: string;
        /** Tailwind classes applied to the rendered <a>. Override on
         *  surfaces where the default sky-700 wouldn't read (e.g. white
         *  text on a brand-orange chat bubble). */
        linkClass?: string;
    }>(),
    { linkClass: 'break-words text-sky-700 hover:underline' },
);

const URL_RE = /\b(https?:\/\/[^\s<]+?)([.,!?)\]]*)(?=\s|$)/g;

interface Segment {
    kind: 'text' | 'link';
    value: string;
}

const segments = computed<Segment[]>(() => {
    const out: Segment[] = [];
    const text = props.text;
    let lastIdx = 0;
    URL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_RE.exec(text)) !== null) {
        let url = match[1]!;
        let trailing = match[2] ?? '';
        // Rebalance parens: many real URLs (Wikipedia, MSDN) contain
        // matched parens. The non-greedy regex hands the closing paren
        // to `trailing`, so we move closing parens back into the URL
        // while it still has more `(` than `)`.
        let openCount = (url.match(/\(/g) ?? []).length;
        let closeCount = (url.match(/\)/g) ?? []).length;
        while (openCount > closeCount && trailing.startsWith(')')) {
            url += ')';
            trailing = trailing.slice(1);
            closeCount++;
        }
        const start = match.index;
        if (start > lastIdx) out.push({ kind: 'text', value: text.slice(lastIdx, start) });
        out.push({ kind: 'link', value: url });
        if (trailing) out.push({ kind: 'text', value: trailing });
        lastIdx = start + match[0].length;
    }
    if (lastIdx < text.length) out.push({ kind: 'text', value: text.slice(lastIdx) });
    return out;
});
</script>

<template>
    <span
        ><template v-for="(seg, i) in segments" :key="i"
            ><a
                v-if="seg.kind === 'link'"
                :href="seg.value"
                target="_blank"
                rel="noopener noreferrer"
                :class="props.linkClass"
                >{{ seg.value }}</a
            ><template v-else>{{ seg.value }}</template></template
        ></span
    >
</template>
