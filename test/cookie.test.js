import { describe, expect, it } from 'vitest';

import { seedCookieJar } from '../src/main.js';

describe('Patchright cookie handoff', () => {
    it('seeds valid browser cookies without adding empty values', () => {
        const jar = new Map([['existing', 'keep']]);

        seedCookieJar(jar, [
            { name: 'cf_clearance', value: 'clearance-token' },
            { name: 'ngobase_session', value: 'session-token' },
            { name: '', value: 'ignored' },
            { name: 'empty', value: '' },
            { name: 'missing' },
        ]);

        expect(jar).toEqual(
            new Map([
                ['existing', 'keep'],
                ['cf_clearance', 'clearance-token'],
                ['ngobase_session', 'session-token'],
                ['empty', ''],
            ]),
        );
    });
});
