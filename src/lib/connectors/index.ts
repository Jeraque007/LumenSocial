import { postToLinkedin } from './linkedin';
import { postToFacebook } from './facebook';
import { postToInstagram } from './instagram';
import { postToYoutube } from './youtube';

export { postToLinkedin, postToFacebook, postToInstagram, postToYoutube };

export type Platform = 'linkedin' | 'facebook' | 'instagram' | 'youtube';

export async function postToPlatform(
  platform: Platform,
  content: string,
  mediaUrl?: string,
  brand?: string
): Promise<{ success: boolean; error?: string }> {
  switch (platform) {
    case 'linkedin':
      return postToLinkedin(content, mediaUrl, brand);
    case 'facebook':
      return postToFacebook(content, mediaUrl, brand);
    case 'instagram':
      return postToInstagram(content, mediaUrl, brand);
    case 'youtube':
      // Brand routing picks which Google grant uploads: 'HOAWS' uses HOAWS_YOUTUBE_* (@HOAWS-963),
      // everything else uses YOUTUBE_* (@sylvana_sae).
      return postToYoutube(content, mediaUrl, brand);
    default:
      return { success: false, error: `Unsupported platform: ${platform}` };
  }
}
