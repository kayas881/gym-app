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
export async function uploadImageAsset(
  supabase: SupabaseClient,
  bucket: 'profile-photos' | 'gym-logos',
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
  // cache under the old URL.
  const path = `${clerkId}/${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, decode(asset.base64), {
      contentType: mimeType,
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
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
