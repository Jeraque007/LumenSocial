const DEFAULT_ATTRIBUTION = 'Posted by LumenSocial';

function isAttributionEnabled(): boolean {
  const raw = process.env.POST_ATTRIBUTION_ENABLED;
  if (!raw) return true;
  return raw.toLowerCase() !== 'false';
}

function getAttributionText(): string {
  return (process.env.POST_ATTRIBUTION_TEXT || DEFAULT_ATTRIBUTION).trim();
}

export function applyAttribution(content: string): string {
  if (!isAttributionEnabled()) return content;

  const attribution = getAttributionText();
  if (!attribution) return content;

  if (content.toLowerCase().includes(attribution.toLowerCase())) {
    return content;
  }

  if (!content.trim()) return attribution;
  return `${content}\n\n${attribution}`;
}
