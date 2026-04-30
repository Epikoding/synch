import type { Auth } from "./factory";

export async function getSession(auth: Auth, request: Request) {
	const headers = normalizeBearerSessionHeaders(request.headers);
	if (!isBearerSessionHeaders(headers)) {
		return await auth.api.getSession({ headers });
	}

	const url = new URL("/api/auth/get-session", request.url);
	const response = await auth.handler(
		new Request(url.toString(), {
			method: "GET",
			headers,
		}),
	);
	if (!response.ok) {
		return null;
	}

	return await response.json<Awaited<ReturnType<Auth["api"]["getSession"]>>>();
}

export function normalizeBearerSessionRequest(request: Request): Request {
	const headers = normalizeBearerSessionHeaders(request.headers);
	if (headers === request.headers) {
		return request;
	}

	return new Request(request, {
		headers,
	});
}

function normalizeBearerSessionHeaders(headers: Headers): Headers {
	if (!isBearerSessionHeaders(headers)) {
		return headers;
	}

	const normalizedHeaders = new Headers(headers);
	normalizedHeaders.delete("cookie");
	return normalizedHeaders;
}

function isBearerSessionHeaders(headers: Headers): boolean {
	return headers.get("authorization")?.trim().toLowerCase().startsWith("bearer ") ?? false;
}
