// Upload media to Supabase Storage and save to media library
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: Request) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const brand = formData.get('brand') as string || '';

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      return new Response(JSON.stringify({ error: 'File must be an image or video' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Generate unique filename
    const ext = file.name.split('.').pop() || (isImage ? 'jpg' : 'mp4');
    const filename = (isImage ? 'img' : 'vid') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const path = (isImage ? 'images/' : 'videos/') + filename;

    // Upload to Supabase Storage
    const buffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(path, buffer, { contentType: file.type, upsert: false });

    if (uploadError) {
      return new Response(JSON.stringify({ error: 'Upload failed: ' + uploadError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
    const publicUrl = urlData.publicUrl;

    // Save to media library
    const { error: dbError } = await supabase.from('media_library').insert({
      type: isImage ? 'image' : 'video',
      url: publicUrl,
      prompt: 'Uploaded: ' + file.name,
      brand,
      model: 'upload',
    });

    if (dbError) {
      return new Response(JSON.stringify({ error: 'DB save failed: ' + dbError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: true, url: publicUrl, type: isImage ? 'image' : 'video' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Server error: ' + (err?.message || err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

export const config = { runtime: 'edge' };