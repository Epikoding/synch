export function normalizeDeviceAuthorizationRequest(request: Request): Request {
	if (!isDeviceAuthorizationClientRequest(request)) {
		return request;
	}

	const url = new URL(request.url);
	const headers = new Headers(request.headers);
	// Native Obsidian mobile can send "null" or app-scheme origins for device flow requests.
	headers.set("origin", url.origin);
	headers.set("referer", `${url.origin}/device`);

	return new Request(request, {
		headers,
	});
}

export function getDeviceVerificationUri(baseURL: string): string {
	const url = new URL("/device", baseURL);
	return url.toString();
}

function isDeviceAuthorizationClientRequest(request: Request): boolean {
	if (request.method !== "POST") {
		return false;
	}

	const pathname = new URL(request.url).pathname;
	return pathname === "/api/auth/device/code" || pathname === "/api/auth/device/token";
}
