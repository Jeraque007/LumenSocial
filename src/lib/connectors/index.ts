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
      // No brand argument: postToYoutube uploads to the channel authorized by the Google grant.
      return postToYoutube(content, mediaUrl);
    default:
      return { success: false, error: `Unsupported platform: ${platform}` };
  }
}
