// Instagram connector using Meta Graph API
import { applyAttribution } from './attribution';

// S.A.E Method's Instagram professional account. Only used when INSTAGRAM_BUSINESS_ACCOUNT_ID
// is not set, so single-brand deployments keep working after the HOAWS split.
const SAE_ACCOUNT_ID = '17841400152764725';

export async function postToInstagram(
  content: string,
  mediaUrl?: string,
  brand?: string
): Promise<{ success: boolean; error?: string }> {
  // Brand routing is case/whitespace insensitive so 'HOAWS', 'hoaws' and 'Hoaws ' all resolve
  // to the HOAWS credentials instead of silently publishing to S.A.E Method.
  const normalizedBrand = (brand || '').trim().toLowerCase();
  const useHoawsCredentials = normalizedBrand === 'hoaws';
  const envPrefix = useHoawsCredentials ? 'HOAWS_INSTAGRAM_' : 'INSTAGRAM_';
  const brandLabel = brand?.trim() || 'S.A.E Method';
  const accessToken = (useHoawsCredentials
    ? process.env.HOAWS_INSTAGRAM_ACCESS_TOKEN
    : process.env.INSTAGRAM_ACCESS_TOKEN)?.trim();
  const businessAccountId = (useHoawsCredentials
    ? process.env.HOAWS_INSTAGRAM_BUSINESS_ACCOUNT_ID
    : process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || SAE_ACCOUNT_ID)?.trim();
  const graphUserId = (useHoawsCredentials
    ? process.env.HOAWS_INSTAGRAM_GRAPH_USER_ID
    : process.env.INSTAGRAM_GRAPH_USER_ID)?.trim();

  if (!mediaUrl) {
    return { success: false, error: 'Instagram requires an image or video URL for posts' };
  }

  if (!accessToken) {
    return { success: false, error: `${envPrefix}ACCESS_TOKEN is not set for brand "${brandLabel}"` };
  }

  if (!businessAccountId) {
    return {
      success: false,
      error: `${envPrefix}BUSINESS_ACCOUNT_ID is not set for brand "${brandLabel}". Add the numeric Instagram professional account ID to Vercel Production.`,
    };
  }

  const isVideo = /\.(mp4|mov|avi|webm)(\?|$)/i.test(mediaUrl);
  const finalContent = applyAttribution(content);
  const accountIds = [...new Set([businessAccountId, graphUserId].filter(Boolean) as string[])]
    .map((id) => id.trim());
  const invalidAccountIds = accountIds.filter((id) => !/^\d+$/.test(id));

  if (invalidAccountIds.length > 0) {
    return {
      success: false,
      error: `${envPrefix}BUSINESS_ACCOUNT_ID / ${envPrefix}GRAPH_USER_ID must be the numeric account ID only. Received: ${invalidAccountIds.join(', ')}`,
    };
  }

  // Instagram Login tokens (IGAA...) are only accepted by graph.instagram.com.
  // Facebook Login / Page tokens (EAA...) are only accepted by graph.facebook.com.
  // Querying the wrong host first returns a misleading "Cannot parse access token" (code 190).
  const instagramHost = 'https://graph.instagram.com/v25.0';
  const facebookHost = 'https://graph.facebook.com/v25.0';
  const isInstagramLoginToken = /^IG/i.test(accessToken);
  const hosts = isInstagramLoginToken
    ? [instagramHost, facebookHost]
    : [facebookHost, instagramHost];
  const attemptErrors: string[] = [];

  for (const host of hosts) {
    for (const accountId of accountIds) {
      const containerUrl = `${host}/${accountId}/media`;
      const containerBody: Record<string, string> = {
        caption: finalContent,
        access_token: accessToken,
      };

      if (isVideo) {
        containerBody.video_url = mediaUrl;
        containerBody.media_type = 'REELS';
      } else {
        containerBody.image_url = mediaUrl;
      }

      const containerResponse = await fetch(containerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(containerBody),
      });

      if (!containerResponse.ok) {
        const err = await containerResponse.text();
        attemptErrors.push(`[${host} / ${accountId}] container creation failed: ${err}`);
        continue;
      }

      const containerData = await containerResponse.json();
      const creationId = containerData.id;

      if (!creationId) {
        attemptErrors.push(
          `[${host} / ${accountId}] container creation returned no id: ${JSON.stringify(containerData)}`
        );
        continue;
      }

      // Image AND video containers must both reach status_code FINISHED before Meta accepts
      // /media_publish. Publishing an image straight after creating its container returns
      // 9007 / error_subcode 2207027 ("The media is not ready to be published") - the HOAWS
      // failure of 2026-09-27 - because only videos were being waited for.
      const statusDelayMs = isVideo ? 5000 : 3000;
      const maxStatusAttempts = isVideo ? 12 : 8; // videos ~60s, images ~24s
      let status = 'IN_PROGRESS';
      let statusPayload = '';
      for (let attempt = 0; attempt < maxStatusAttempts && status === 'IN_PROGRESS'; attempt++) {
        await new Promise((r) => setTimeout(r, statusDelayMs));
        const statusResponse = await fetch(
          `${host}/${creationId}?fields=status_code&access_token=${accessToken}`
        );
        statusPayload = await statusResponse.text();
        try {
          const statusData = JSON.parse(statusPayload);
          status = statusData.status_code || (statusData.error ? 'ERROR' : status);
        } catch {
          // Unparseable status response: keep polling until attempts run out, then report it.
        }
      }

      if (status !== 'FINISHED') {
        attemptErrors.push(
          `[${host} / ${accountId}] container never became publishable (status: ${status}): ${statusPayload}`
        );
        continue;
      }

      // Meta can still answer 9007 ("media is not ready") for a few seconds after FINISHED,
      // so retry the publish with backoff before giving up on this host/account.
      const publishUrl = `${host}/${accountId}/media_publish`;
      let published = false;
      let publishError = '';
      for (let attempt = 0; attempt < 3 && !published; attempt++) {
        if (attempt > 0) {
          await new Promise((r) => setTimeout(r, 5000 * attempt));
        }
        const publishResponse = await fetch(publishUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
        });
        publishError = await publishResponse.text();
        if (publishResponse.ok) {
          published = true;
          break;
        }
        // Only "not ready yet" is worth retrying; every other error is final for this attempt.
        if (!/9007|2207027|not ready/i.test(publishError)) {
          break;
        }
      }

      if (!published) {
        attemptErrors.push(`[${host} / ${accountId}] publish failed: ${publishError}`);
        continue;
      }

      return { success: true };
    }
  }

  return {
    success: false,
    error:
      `Instagram publish failed for brand "${brandLabel}" using ${envPrefix}ACCESS_TOKEN ` +
      `(account IDs: ${accountIds.join(', ')}; hosts tried: ${hosts.join(', ')}): ${attemptErrors.join(' | ')}` +
      wrongIdTypeHint(attemptErrors, envPrefix) + tokenFormatHint(attemptErrors, envPrefix, brandLabel),
  };
}

// Meta answers "object does not exist" (code 100 / error_subcode 33) when an app-scoped user ID
// (the `id` field of GET graph.instagram.com/v25.0/me) is used in place of the Instagram professional
// account ID (`user_id`). That distinction is invisible in the raw Meta payload, so name it here.
function wrongIdTypeHint(attemptErrors: string[], envPrefix: string): string {
  const looksLikeWrongIdType = attemptErrors.some(
    (entry) =>
      /"code"\s*:\s*100/.test(entry) ||
      /"error_subcode"\s*:\s*33/.test(entry) ||
      /object does not exist/i.test(entry)
  );

  return looksLikeWrongIdType
    ? ` Hint: Meta could not find an Instagram account with those IDs. ${envPrefix}BUSINESS_ACCOUNT_ID and ` +
      `${envPrefix}GRAPH_USER_ID must both be the Instagram professional account ID - the "user_id" field of ` +
      `GET https://graph.instagram.com/v25.0/me?fields=id,user_id,username (also the number shown next to the ` +
      `account in App Dashboard > Instagram > API setup with Instagram login). The app-scoped "id" field of /me ` +
      `is not publishable and produces exactly this error.`
    : '';
}

// When EVERY host answers "Cannot parse access token", the token string itself is unusable
// (truncated, quoted or padded) rather than merely being sent to the wrong host: an IGAA token
// on graph.facebook.com produces that same noise on that one host, which is why this hint only
// fires when no host could parse it.
function tokenFormatHint(attemptErrors: string[], envPrefix: string, brand: string): string {
  const allUnparseable =
    attemptErrors.length > 0 &&
    attemptErrors.every((entry) => /Cannot parse access token/i.test(entry));

  return allUnparseable
    ? ` Hint: ${envPrefix}ACCESS_TOKEN could not be parsed by any host, so the token itself looks malformed ` +
      `for brand "${brand}". Re-issue it at /api/auth/instagram-token?brand=${encodeURIComponent(brand)} and set ` +
      `the new IGAA long-lived token in Vercel Production, checking for truncation, quotes or stray whitespace.`
    : '';
}
