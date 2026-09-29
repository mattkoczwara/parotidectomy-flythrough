import base from './playwright.config.ts';

// Performance measurement only (npm run perf): see tests/perf.spec.ts.
export default { ...base, testMatch: /perf\.spec\.ts$/, testIgnore: [] };
