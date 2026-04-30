import { env } from "cloudflare:workers";
import type { APIContext } from "astro";

export const prerender = false;

type WaitlistEnv = {
	WAITLIST_DB: D1Database;
};

type WaitlistRequest = {
	email?: unknown;
	locale?: unknown;
	website?: unknown;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST({ request }: APIContext): Promise<Response> {
	const body = await readJson(request);
	const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
	const locale = typeof body.locale === "string" ? body.locale.slice(0, 8) : "";
	const website = typeof body.website === "string" ? body.website.trim() : "";

	if (website) {
		return json({ status: "created" });
	}

	if (!emailPattern.test(email)) {
		return json({ error: "invalid_email" }, 400);
	}

	const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? "";
	const ipHash = await hashIp(request.headers.get("cf-connecting-ip") ?? "");

	const result = await (env as unknown as WaitlistEnv).WAITLIST_DB.prepare(
		`insert or ignore into waitlist_entries (email, locale, source, user_agent, ip_hash, created_at)
		 values (?, ?, ?, ?, ?, datetime('now'))`,
	)
		.bind(email, locale, "www", userAgent, ipHash)
		.run();

	const created = (result.meta.changes ?? 0) > 0;
	return json({ status: created ? "created" : "existing" }, created ? 201 : 200);
}

async function readJson(request: Request): Promise<WaitlistRequest> {
	try {
		return (await request.json()) as WaitlistRequest;
	} catch {
		return {};
	}
}

async function hashIp(ip: string): Promise<string> {
	if (!ip) {
		return "";
	}

	const data = new TextEncoder().encode(ip);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

function json(body: unknown, status = 200): Response {
	return Response.json(body, {
		status,
		headers: {
			"cache-control": "no-store",
		},
	});
}
