// Server side of Project Resources (typed links - see client/src/resources.js
// for the kinds and layout; scripts/tests/resources.test.js checks the two
// kind lists agree).

export const RESOURCE_KIND_IDS = ['folder', 'model', 'teaser', 'om', 'deck', 'other'];

// One Project Folder and one Working Model per project.
export const SINGLE_RESOURCE_KINDS = ['folder', 'model'];

// null if OK, else an error message. http(s) only: a resource is rendered
// as a clickable link, so a javascript:/data: URL would run in whoever
// clicks it.
export function validateResourceUrl(url) {
  if (!url || !String(url).trim()) return 'URL is required';
  let parsed;
  try {
    parsed = new URL(String(url).trim());
  } catch (e) {
    return 'Enter a valid URL (https://...)';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'Links must start with http:// or https://';
  }
  return null;
}
