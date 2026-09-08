import { describe, expect, it } from 'vitest';

import { extractNextPage, extractSortBase, parseAgencyListings } from '../src/main.js';

const listingUrl = 'https://ngobase.org/funding-agencies';
const html = `
    <select id="sortSelect" onchange="document.getElementById('sortForm').action = 'https://ngobase.org/funding-agencies/' + this.value">
        <option value="name_a_to_z">Name</option>
    </select>
    <div class="row border p-3 mb-2 align-items-center bg-white">
        <div class="col-md-1 fw-bold">1</div>
        <div class="col-md-1 px-0">
            <a href="/agency/2535" title="Example Agency Profile">
                <img src="/images/agency_logos/US/example.png" class="listing_logo_img" alt="Example Agency Logo">
            </a>
        </div>
        <div class="col-md-3">
            <a class="link-dark" href="/agency/2535" title="Example Agency Funding agency">Example Agency</a>
        </div>
        <div class="col-md-2">
            <a class="link-dark listing_locations" href="/agencies/c/US">United States</a>
        </div>
        <div class="col-md-2">
            <a href="https://example.org/" title="Example Agency agency website" itemprop="url">Website</a>
            <a href="https://facebook.com/example" title="Example Agency agency facebook page" itemprop="url">Facebook</a>
            <a href="https://linkedin.com/company/example" title="Example Agency agency linkedin page" itemprop="url">LinkedIn</a>
        </div>
        <div class="col-md-2">
            <a href="/agencies/t/ga" title="Government Agency">Government Agency</a>
            <a href="/agency/2535">Details</a>
        </div>
    </div>
    <a rel="next" href="?page=2">Next</a>
`;

describe('NGOBase funding agency parser', () => {
    it('extracts funding agency records without null or empty values', () => {
        const [record] = parseAgencyListings(html, listingUrl, '2026-09-07T00:00:00.000Z');

        expect(record).toMatchObject({
            id: '2535',
            name: 'Example Agency',
            url: 'https://ngobase.org/agency/2535',
            logo: 'https://ngobase.org/images/agency_logos/US/example.png',
            website: 'https://example.org/',
            facebook: 'https://facebook.com/example',
            linkedin: 'https://linkedin.com/company/example',
            country: 'United States',
            agency_type: 'Government Agency',
        });
        expect(Object.values(record).every((value) => value !== null && value !== '')).toBe(true);
    });

    it('extracts the sort base from funding-agency inline JavaScript', () => {
        expect(extractSortBase(html)).toBe(listingUrl);
    });

    it('extracts the next page URL', () => {
        expect(extractNextPage(html, listingUrl)).toBe(`${listingUrl}?page=2`);
    });
});
