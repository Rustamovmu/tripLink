import { normalizeUsername, safeAuthReturn, validateNewPassword } from './account-policy';
import { AuthRecordsService } from './auth-records.service';
import { AuthConfig } from './auth.config';
describe('Account policy and temporary credential protection', () => {
	it('normalizes new names and rejects reserved/unsupported names', () => {
		expect(normalizeUsername(' Traveler.123 ')).toBe('traveler.123');
		for (const nick of ['admin', 'ADMIN', 'ab', 'a'.repeat(31), 'john doe', 'john@doe'])
			expect(() => normalizeUsername(nick)).toThrow();
	});
	it('accepts long spaced passphrases and rejects short/known weak passwords', () => {
		expect(() => validateNewPassword('a long passphrase '.repeat(30))).not.toThrow();
		for (const password of ['short', '123456789012', 'x'.repeat(1025)])
			expect(() => validateNewPassword(password)).toThrow();
	});
	it('rejects encoded protocol-relative paths, backslashes, controls and callback loops', () => {
		for (const path of [
			'//evil.invalid',
			'/%2fevil.invalid',
			'/\\evil.invalid',
			'/%5cevil.invalid',
			'/%0aevil',
			'/account/complete',
			'https://evil.invalid',
		])
			expect(safeAuthReturn(path)).toBe('/');
		expect(safeAuthReturn('/tour/detail?id=abc&booking=1')).toBe('/tour/detail?id=abc&booking=1');
	});
	it('authenticates encrypted temporary data and rejects tampering', () => {
		const service = new AuthRecordsService(undefined!, undefined!, undefined!, undefined!, {
			refreshSecret: 'test-only-key',
		} as AuthConfig);
		const sealed = service.seal({ verifier: 'temporary-secret', memberId: 'fixture' });
		expect(sealed).not.toContain('temporary-secret');
		expect(service.open(sealed)).toEqual({ verifier: 'temporary-secret', memberId: 'fixture' });
		const parts = sealed.split('.');
		const corrupted = Buffer.from(parts[2], 'base64url');
		corrupted[0] ^= 1;
		parts[2] = corrupted.toString('base64url');
		expect(() => service.open(parts.join('.'))).toThrow();
	});
});
