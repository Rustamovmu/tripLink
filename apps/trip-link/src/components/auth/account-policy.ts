import { BadRequestException } from '@nestjs/common';
export const usernameCollation = { locale: 'en', strength: 2 };
const reserved = new Set([
	'admin',
	'administrator',
	'triplink',
	'support',
	'security',
	'system',
	'root',
	'auth',
	'api',
]);
export function normalizeUsername(value: string): string {
	const normalized = value.trim().toLowerCase();
	if (!/^[a-z0-9_.-]{3,30}$/.test(normalized) || reserved.has(normalized))
		throw new BadRequestException('Choose a username with 3–30 letters, numbers, underscores, periods or hyphens.');
	return normalized;
}
export function validateNewPassword(value: string): void {
	if (
		typeof value !== 'string' ||
		value.length < 12 ||
		value.length > 1024 ||
		new Set(['passwordpassword', '123456789012', 'qwertyuiop123', 'triplink12345']).has(value.toLowerCase())
	)
		throw new BadRequestException(
			'Use a stronger password with 12–1024 characters. Spaces and passphrases are welcome.',
		);
}
const invalidPath = (value: string) =>
	value.includes('\\') || Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
export function safeAuthReturn(value: unknown): string {
	if (
		typeof value !== 'string' ||
		value.length > 2000 ||
		!value.startsWith('/') ||
		value.startsWith('//') ||
		invalidPath(value)
	)
		return '/';
	try {
		const decoded = decodeURIComponent(value);
		if (decoded.startsWith('//') || invalidPath(decoded) || /^\/(?:account|auth|api)(?:\/|\?|$)/i.test(decoded))
			return '/';
		const url = new URL(value, 'https://triplink.invalid');
		return url.origin === 'https://triplink.invalid' ? value : '/';
	} catch {
		return '/';
	}
}
