const STORAGE_KEY = "triplus_url_params";

const TRACKING_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "src",
  "sck",
] as const;

function safeParseStored(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function parseQueryString(search: string): Record<string, string> {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const out: Record<string, string> = {};
  new URLSearchParams(q).forEach((value, key) => {
    if (value.trim()) out[key] = value.trim();
  });
  return out;
}

/** Lê query da URL e mantém em sessionStorage no funil landing → checkout → PIX. */
export function mergeUrlParamsFromLocation(): Record<string, string> {
  const fromSearch = parseQueryString(window.location.search);
  let fromHash: Record<string, string> = {};
  const hash = window.location.hash;
  const qi = hash.indexOf("?");
  if (qi >= 0) fromHash = parseQueryString(hash.slice(qi));

  const fromUrl = { ...fromHash, ...fromSearch };
  const prev = safeParseStored();

  if (Object.keys(fromUrl).length === 0) return prev;

  const merged = { ...prev, ...fromUrl };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

/** Payload no formato da Utmify (trackingParameters). */
export function toUtmifyTrackingParameters(
  params: Record<string, string>
): Record<string, string | null> {
  const out: Record<string, string | null> = {
    src: null,
    sck: null,
    utm_source: null,
    utm_campaign: null,
    utm_medium: null,
    utm_content: null,
    utm_term: null,
  };

  const aliases: Record<string, string> = {
    utmSource: "utm_source",
    utmMedium: "utm_medium",
    utmCampaign: "utm_campaign",
    utmContent: "utm_content",
    utmTerm: "utm_term",
  };

  const normalized = { ...params };
  for (const [from, to] of Object.entries(aliases)) {
    if (params[from] && !normalized[to]) normalized[to] = params[from];
  }

  for (const key of TRACKING_KEYS) {
    const v = normalized[key];
    out[key] = v && v.trim() ? v.trim() : null;
  }

  return out;
}
