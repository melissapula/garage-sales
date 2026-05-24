/**
 * Photo upload helpers for the `sale-photos` Supabase Storage bucket.
 *
 * Files are stored at `{user_id}/{uuid}.jpg` so the bucket's RLS policy can
 * check ownership via the first path segment.
 */
const BUCKET = 'sale-photos';

const MAX_DIM = 1920;
const QUALITY = 0.85;

/** Downscale to MAX_DIM and re-encode as JPEG to keep uploads lean. */
async function compressImage(file: File): Promise<Blob> {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = url;
        });

        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
            const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas not supported');
        ctx.drawImage(img, 0, 0, width, height);

        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Failed to encode image'));
                },
                'image/jpeg',
                QUALITY,
            );
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function useSalePhotos() {
    const supabase = useSupabaseClient();
    const user = useSupabaseUser();

    async function uploadPhoto(file: File): Promise<string> {
        if (!user.value) throw new Error('Sign in to upload photos.');

        const compressed = await compressImage(file);
        const id = crypto.randomUUID();
        const path = `${user.value.id}/${id}.jpg`;

        const { error } = await supabase.storage
            .from(BUCKET)
            .upload(path, compressed, { contentType: 'image/jpeg', upsert: false });
        if (error) throw error;

        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
        return data.publicUrl;
    }

    async function deletePhotos(urls: string[]): Promise<void> {
        const paths = urls
            .map((u) => {
                const match = u.match(new RegExp(`/${BUCKET}/(.+?)(\\?|$)`));
                return match ? match[1] : null;
            })
            .filter((p): p is string => p !== null);
        if (paths.length === 0) return;
        await supabase.storage.from(BUCKET).remove(paths);
    }

    return { uploadPhoto, deletePhotos };
}
