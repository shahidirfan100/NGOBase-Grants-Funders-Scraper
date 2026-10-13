import { describe, expect, it } from 'vitest';

import { applySort, normalizeInput, normalizeSort, parseNumber, prepareTargets } from '../src/main.js';

const bootstrapHtml = `
    <input type="hidden" name="_token" value="test-token">
    <select id="agency_country"><option value="CA">Canada</option></select>
    <select id="agency_type"><option value="ga">Government Agency</option></select>
`;
const filterHtml = '<title>Funding Agencies & Grantmakers in Canada</title>';

function htmlResponse(html, url) {
    return {
        ok: true,
        status: 200,
        url,
        headers: new Headers({ 'content-type': 'text/html; charset=UTF-8' }),
        text: async () => html,
    };
}

class MockClient {
    requests = [];

    async fetch(url, options = {}) {
        this.requests.push({ url, options });
        const path = new URL(url).pathname;

        if (path === '/funding-agencies') return htmlResponse(bootstrapHtml, url);
        if (path === '/getStatesInSelectFilter') {
            return htmlResponse('<body><option value="ON">Ontario</option></body>', url);
        }
        if (path === '/agency_filter_redirect') {
            return htmlResponse(filterHtml, 'https://ngobase.org/agencies/c/CA');
        }

        throw new Error(`Unexpected mock URL: ${url}`);
    }
}

describe('NGOBase funding agency input modes', () => {
    it('builds a trimmed agency keyword target without unrelated filters', async () => {
        const client = new MockClient();
        const input = normalizeInput({ keyword: ' UNICEF ', country: '' });
        const [target] = await prepareTargets(client, input, new Map());

        expect(target.url).toBe('https://ngobase.org/funding-agencies?search=UNICEF');
        expect(client.requests).toHaveLength(0);
    });

    it('uses the explicit filter when a defaulted keyword is also resolved', async () => {
        const client = new MockClient();
        const input = normalizeInput({ keyword: 'UNICEF', country: 'Canada' });
        const [target] = await prepareTargets(client, input, new Map());
        const filterRequest = client.requests.find(({ url }) => new URL(url).pathname === '/agency_filter_redirect');

        expect(target.url).toBe('https://ngobase.org/agencies/c/CA');
        expect(filterRequest.options.body).toContain('agency_country=CA');
    });

    it('resolves country and agency-type filters and applies sorting', async () => {
        const client = new MockClient();
        const input = normalizeInput({ country: 'Canada', agencyType: 'Government Agency' });
        const [target] = await prepareTargets(client, input, new Map());
        const sortedUrl = applySort(target.url, normalizeSort('name_a_to_z'), target.sortBase);

        expect(target.url).toBe('https://ngobase.org/agencies/c/CA');
        expect(sortedUrl).toBe(target.url);
        expect(client.requests.map(({ url }) => new URL(url).pathname)).toEqual([
            '/funding-agencies',
            '/agency_filter_redirect',
        ]);
    });

    it('resolves country and state combinations', async () => {
        const client = new MockClient();
        const input = normalizeInput({ country: 'Canada', state: 'Ontario', agencyType: 'Government Agency' });
        const [target] = await prepareTargets(client, input, new Map());
        const filterRequest = client.requests.find(({ url }) => new URL(url).pathname === '/agency_filter_redirect');

        expect(target.url).toBe('https://ngobase.org/agencies/c/CA');
        expect(filterRequest.options.body).toContain('agency_country=CA');
        expect(filterRequest.options.body).toContain('agency_state=ON');
        expect(filterRequest.options.body).toContain('agency_type=ga');
    });

    it('preserves user limits and normalizes invalid numeric values safely', () => {
        expect(parseNumber('35', 20)).toBe(35);
        expect(parseNumber('0', 20)).toBe(1);
        expect(parseNumber('invalid', 20)).toBe(20);
        expect(normalizeSort('default')).toBe('');
        expect(normalizeSort('type_name')).toBe('type_name');
    });
});
