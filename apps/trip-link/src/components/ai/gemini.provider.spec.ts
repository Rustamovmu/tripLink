import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, GenerateContentParameters } from '@google/genai';
import { GeminiProvider } from './gemini.provider';

jest.mock('@google/genai', () => ({ GoogleGenAI: jest.fn(), ThinkingLevel: { MINIMAL: 'MINIMAL' } }));
describe('Gemini provider bounds and safe failures', () => {
	const generateContent = jest.fn<Promise<{ text: string }>, [GenerateContentParameters]>();
	const values: Record<string, string> = {};
	const provider = new GeminiProvider({ get: (key: string) => values[key] } as unknown as ConfigService);
	beforeEach(() => {
		jest.clearAllMocks();
		values.GEMINI_API_KEY = 'test-only-key';
		delete values.GEMINI_MODEL;
		(GoogleGenAI as jest.Mock).mockImplementation(() => ({ models: { generateContent } }));
		generateContent.mockResolvedValue({ text: 'A short answer.' });
	});
	it('uses one non-retrying timed call, minimal thinking, 200 tokens and data outside the system prompt', async () => {
		await expect(provider.generate([{ role: 'user', text: '한국 여행' }], '{"tours":[]}', false)).resolves.toBe(
			'A short answer.',
		);
		expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-only-key' });
		expect(generateContent).toHaveBeenCalledTimes(1);
		const options = generateContent.mock.calls[0][0] as {
			model: string;
			config: { maxOutputTokens: number; httpOptions: unknown; thinkingConfig: unknown; systemInstruction: string };
			contents: unknown[];
		};
		expect(options.model).toBe('gemini-3.5-flash-lite');
		expect(options.config.maxOutputTokens).toBe(200);
		expect(options.config.httpOptions).toEqual({ timeout: 20000, retryOptions: { attempts: 1 } });
		expect(options.config.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
		expect(options.config.systemInstruction).not.toContain('{"tours":[]}');
		expect(options.config.systemInstruction).not.toContain('test-only-key');
		expect(options.contents.at(-1)).toEqual({ role: 'user', parts: [{ text: '한국 여행' }] });
	});
	it('permits a bounded explicit longer answer and configurable model', async () => {
		values.GEMINI_MODEL = 'gemini-3.1-flash-lite';
		await provider.generate([{ role: 'user', text: 'Explain in detail' }], '{}', true);
		expect(generateContent.mock.calls[0][0]).toMatchObject({
			model: 'gemini-3.1-flash-lite',
			config: { maxOutputTokens: 600 },
		});
	});
	it('fails safely without a key and makes no provider request', async () => {
		delete values.GEMINI_API_KEY;
		await expect(provider.generate([], '{}', false)).rejects.toMatchObject({ extensions: { code: 'AI_UNAVAILABLE' } });
		expect(generateContent).not.toHaveBeenCalled();
	});
	it.each([
		[{ status: 429, message: 'private provider quota' }, 'AI_RATE_LIMITED'],
		[new Error('private-key timeout'), 'AI_UNAVAILABLE'],
		[{ status: 401, message: 'private-key' }, 'AI_UNAVAILABLE'],
	])('maps provider rejection without exposing internals or retrying', async (failure, code) => {
		generateContent.mockRejectedValue(failure);
		await expect(provider.generate([], '{}', false)).rejects.toMatchObject({ extensions: { code } });
		expect(generateContent).toHaveBeenCalledTimes(1);
	});
	it('handles safety-blocked or empty responses without exposing provider content', async () => {
		generateContent.mockResolvedValue({ text: '' });
		await expect(provider.generate([], '{}', false)).rejects.toMatchObject({ extensions: { code: 'AI_UNAVAILABLE' } });
	});
});
