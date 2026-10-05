import base from './playwright.config.ts';

// Transition-hitch detector only (diagnostic, not a check): see tests/hitch.spec.ts.
export default { ...base, testMatch: /hitch\.spec\.ts$/, testIgnore: [] };
