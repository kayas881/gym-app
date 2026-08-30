import { decode } from 'base64-arraybuffer';
import { SupabaseClient } from '@supabase/supabase-js';
import type { ImagePickerAsset } from 'expo-image-picker';

/**
 * Uploads an image picked with expo-image-picker to Supabase Storage and
 * returns its public URL.
 *
 * Why base64 rather than the file URI:
 * `fetch(uri).blob()` is unreliable under React Native, and expo-file-system is
 * a native module that would require rebuilding the dev client. ImagePicker can
 * hand back base64 directly (pass `base64: true`), which decodes to an
 * ArrayBuffer in pure JS — no native dependency, no rebuild.
 *
 * Files are stored as `<clerkId>/<name>` because the storage policies in
 * migration 004 authorise writes by comparing the first path segment against
 * public.get_clerk_id().
 *
 * @returns the public URL to persist in the database
 */
export type StorageBucket = 'profile-photos' | 'gym-logos' | 'complaint-photos';

/**
 * Uploads the asset and returns its STORAGE PATH (e.g. `user_abc/123.jpg`).
 *
 * Private buckets have no public URL, so the path is what must be persisted —
 * a signed URL is minted at display time and expires.
 */
export async function uploadImageAssetToPath(
  supabase: SupabaseClient,
  bucket: StorageBucket,
  clerkId: string,
  asset: Pick<ImagePickerAsset, 'base64' | 'uri' | 'mimeType'>
): Promise<string> {
  if (!asset.base64) {
    throw new Error(
      'Image is missing base64 data. Pass `base64: true` to the ImagePicker call.'
    );
  }

  const mimeType = asset.mimeType || 'image/jpeg';
  const extension = mimeType.includes('png')
    ? 'png'
    : mimeType.includes('webp')
      ? 'webp'
      : 'jpg';

  // Unique name per upload so a replaced photo can't be served from a CDN
  // cache under the old URL. The first path segment is the clerk id, which is
  // what the storage policies authorise writes against.
  const path = `${clerkId}/${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, decode(asset.base64), {
      contentType: mimeType,
      upsert: true,
    });

  if (error) throw error;
  return path;
}

export async function uploadImageAsset(
  supabase: SupabaseClient,
  bucket: StorageBucket,
  clerkId: string,
  asset: Pick<ImagePickerAsset, 'base64' | 'uri' | 'mimeType'>
): Promise<string> {
  const path = await uploadImageAssetToPath(supabase, bucket, clerkId, asset);
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Mints a temporary URL for an object in a PRIVATE bucket.
 *
 * Returns null rather than throwing so a missing or unauthorised attachment
 * degrades to "no image" instead of breaking the screen around it.
 */
export async function createSignedImageUrl(
  supabase: SupabaseClient,
  bucket: StorageBucket,
  path: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  // Tolerate rows written while the bucket was public, which stored a full URL.
  const objectPath = path.startsWith('http')
    ? path.split(`/${bucket}/`)[1] ?? null
    : path;
  if (!objectPath) return null;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error) {
    console.warn('[storage] Could not sign URL:', error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}

/**
 * True when a stored value is a local device path rather than a remote URL.
 *
 * Photos saved before storage uploads existed were written as
 * `file:///.../ImagePicker/...`, which no longer resolves. Treat those as
 * absent so the UI falls back to initials instead of showing a broken image.
 */
export function isLocalFileUri(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith('file://') || value.startsWith('content://');
}
