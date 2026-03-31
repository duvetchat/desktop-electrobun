const FALLBACK_SVG = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#555"/><text x="12" y="17" text-anchor="middle" font-size="14" fill="#999" font-family="sans-serif">?</text></svg>`)}`;

export function resolveActivityIcon(value: string | undefined): string {
	if (!value) return FALLBACK_SVG;
	// Already a URL or data URI — use as-is
	if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) return value;
	// Unknown string — fallback
	return FALLBACK_SVG;
}
