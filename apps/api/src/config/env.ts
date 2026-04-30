export function requireUrlEnv(name: string): string {
	const value = normalizeOptionalUrlValue(name, process.env[name]);
	if (!value) {
		throw new Error(`${name} is required`);
	}

	return value;
}

export function requireOriginEnv(name: string): string {
	return new URL(requireUrlEnv(name)).origin;
}

export function resolveUrlBinding(
	name: string,
	value: string | undefined,
	fallbackUrl: string,
): string {
	return normalizeOptionalUrlValue(name, value) ?? normalizeRequiredUrlValue(name, fallbackUrl);
}

export function resolveOriginBinding(
	name: string,
	value: string | undefined,
	fallbackUrl: string,
): string {
	return new URL(resolveUrlBinding(name, value, fallbackUrl)).origin;
}

function normalizeOptionalUrlValue(name: string, value: string | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) {
		return null;
	}

	return normalizeRequiredUrlValue(name, trimmed);
}

function normalizeRequiredUrlValue(name: string, value: string): string {
	try {
		new URL(value);
		return value;
	} catch {
		throw new Error(`${name} must be a valid URL`);
	}
}
