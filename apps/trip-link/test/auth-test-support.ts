// These public test-only values are not deployment credentials.
if (process.env.NODE_ENV === 'production') throw new Error('Authentication fixtures cannot run in production');
process.env.JWT_ACCESS_SECRET = 'disposable-tests-access-secret-32-characters';
process.env.JWT_REFRESH_SECRET = 'disposable-tests-refresh-secret-32-characters';
process.env.FRONTEND_ORIGINS = 'http://localhost:3000';
process.env.AUTH_FRONTEND_URL = 'http://localhost:3000';
process.env.AUTH_COOKIE_SECURE = 'false';
process.env.AUTH_COOKIE_SAME_SITE = 'lax';
