import { postToLinkedin } from './linkedin';
import { postToFacebook } from './facebook';
import { postToInstagram } from './instagram';

export { postToLinkedin, postToFacebook, postToInstagram };

export type Platform = 'linkedin' | 'facebook' | 'instagram';

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
    default:
      return { success: false, error: `Unsupported platform: ${platform}` };
  }
}
