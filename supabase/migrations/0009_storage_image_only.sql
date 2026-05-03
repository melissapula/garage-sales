-- Lock down the sale-photos bucket: only allow image MIME types, 10 MB max.
-- Server-side enforcement so a renamed-to-jpg executable can't slip through
-- a client-side type check.

update storage.buckets
set
    file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = array[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/heic',
        'image/heif'
    ]
where id = 'sale-photos';
