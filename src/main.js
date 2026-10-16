import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Actor, Dataset, log } from 'apify';
import { load } from 'cheerio';
import { Impit } from 'impit';
import { chromium } from 'patchright';

const SOURCE = 'ngobase.org';
const BASE_URL = 'https://ngobase.org/funding-agencies';
const DEFAULT_RESULTS_WANTED = 20;
const DEFAULT_MAX_PAGES = 10;
const MAX_RETRIES = 3;
const MAX_RECOVERIES = 10;
const MAX_PROXY_SESSIONS = 5;
const REQUEST_TIMEOUT_MS = 30000;
const UNBLOCKER_TIMEOUT_MS = 120000;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 10000;
const CHALLENGE_TIMEOUT_MS = 60000;
const SORT_VALUES = new Set(['', 'name_a_to_z', 'type_name']);

// A bounded rotation subset of the impit 0.14.x `Browser` union (the full union
// also includes `chrome142`, `chrome151`, `firefox135`, `firefox144`, `okhttp*`,
// and older `chrome1xx` variants). The ladder starts with the newest desktop
// Chrome profile and reaches the real-browser fallback before the budget ends.
const IMPIT_PROFILES = ['chrome', 'chrome131', 'firefox', 'firefox133'];

let browserSession;

function text(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

function absoluteUrl(value, baseUrl) {
    if (!value) return undefined;
    try {
        return new URL(value, baseUrl).href;
    } catch {
        return undefined;
    }
}

function addIfPresent(record, key, value) {
    const cleaned = typeof value === 'string' ? text(value) : value;
    if (
        cleaned !== undefined &&
        cleaned !== null &&
        cleaned !== '' &&
        (!Array.isArray(cleaned) || cleaned.length > 0)
    ) {
        Object.assign(record, { [key]: cleaned });
    }
}

function readSocialLinks(card, baseUrl) {
    const links = {};
    card('a[title], a[itemprop="url"]').each((_, element) => {
        const title = text(card(element).attr('title')).toLowerCase();
        const url = absoluteUrl(card(element).attr('href'), baseUrl);
        if (!url) return;

        if (title.includes('facebook') && !links.facebook) links.facebook = url;
        else if (title.includes('linkedin') && !links.linkedin) links.linkedin = url;
        else if (title.includes('website') && !links.website) links.website = url;
    });
    return links;
}

export function parseAgencyListings(html, pageUrl, scrapedAt = new Date().toISOString()) {
    const $ = load(html);
    const recordsByKey = new Map();

    $('.row.border.p-3.mb-2.align-items-center.bg-white, .card.mb-3').each((_, element) => {
        const card = (selectorOrElement) =>
            typeof selectorOrElement === 'string' ? $(element).find(selectorOrElement) : $(selectorOrElement);
        const profileUrl = absoluteUrl(card('a[href*="/agency/"]').first().attr('href'), pageUrl);
        const name = text(card('a[title*="Funding agency"], a.link-dark[href*="/agency/"]').first().text());
        if (!name && !profileUrl) return;

        const record = {};
        const idMatch = profileUrl?.match(/\/agency\/([^/?#]+)/i);
        const country = text(card('a.listing_locations').first().text());
        const agencyType = text(card('a[href*="/agencies/t/"]').first().text());
        const socialLinks = readSocialLinks(card, pageUrl);
        const logoUrl = absoluteUrl(card('.listing_logo_img').first().attr('src'), pageUrl);

        addIfPresent(record, 'id', idMatch?.[1]);
        addIfPresent(record, 'name', name);
        addIfPresent(record, 'url', profileUrl);
        addIfPresent(record, 'logo', logoUrl);
        addIfPresent(record, 'website', socialLinks.website);
        addIfPresent(record, 'facebook', socialLinks.facebook);
        addIfPresent(record, 'linkedin', socialLinks.linkedin);
        addIfPresent(record, 'country', country);
        addIfPresent(record, 'agency_type', agencyType);
        addIfPresent(record, 'source_url', pageUrl);
        addIfPresent(record, 'source', SOURCE);
        addIfPresent(record, 'scraped_at', scrapedAt);

        if (record.name || record.url) {
            const key = record.url || `${record.name}-${record.country || ''}`;
            recordsByKey.set(key, { ...recordsByKey.get(key), ...record });
        }
    });

    return [...recordsByKey.values()];
}

export function extractNextPage(html, pageUrl) {
    const $ = load(html);
    const candidates = [
        $('a[rel="next"]').first().attr('href'),
        $('a')
            .filter((_, element) => /^(?:next|›|»|>)$/i.test(text($(element).text())))
            .first()
            .attr('href'),
    ];

    for (const candidate of candidates) {
        const nextUrl = absoluteUrl(candidate, pageUrl);
        if (nextUrl) return nextUrl;
    }

    return undefined;
}

export function readSelectOptions(html, selector) {
    const $ = load(html);
    return $(selector)
        .find('option')
        .map((_, element) => ({
            value: text($(element).attr('value')),
            label: text($(element).text()),
        }))
        .get()
        .filter((option) => option.value && option.label);
}

export function resolveOption(options, requested, label) {
    const needle = text(requested).toLowerCase();
    if (!needle) return undefined;

    const exactValue = options.find((option) => option.value.toLowerCase() === needle);
    if (exactValue) return exactValue;

    const exactLabel = options.find((option) => option.label.toLowerCase() === needle);
    if (exactLabel) return exactLabel;

    const partialLabel = options.find((option) => option.label.toLowerCase().includes(needle));
    if (partialLabel) return partialLabel;

    throw new Error(`Could not resolve ${label} "${requested}" from NGOBase funding agency filter options.`);
}

export function extractSortBase(html) {
    const $ = load(html);
    const onchange = $('#sortSelect').attr('onchange') || '';
    const action = onchange.match(/action\s*=\s*['"]([^'"]+)['"]/i)?.[1];
    return action?.replace(/\/$/, '');
}

export function normalizeText(value) {
    return text(value);
}

function sleep(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

export function parseNumber(value, fallback, minimum = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback;
}

function cleanQueryValue(value) {
    return normalizeText(value);
}

export function normalizeInput(input) {
    const normalized = { ...input };
    for (const field of ['keyword', 'country', 'state', 'agencyType', 'sorting']) {
        if (typeof normalized[field] === 'string') normalized[field] = cleanQueryValue(normalized[field]);
    }
    return normalized;
}

function buildKeywordUrl(keyword) {
    const url = new URL(BASE_URL);
    url.searchParams.set('search', cleanQueryValue(keyword));
    return url.href;
}

function getCookieHeader(cookieJar) {
    return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

export function seedCookieJar(cookieJar, cookies) {
    for (const cookie of cookies || []) {
        const name = text(cookie?.name);
        const value = cookie?.value;
        if (name && value !== undefined && value !== null) cookieJar.set(name, String(value));
    }
    return cookieJar;
}

function updateCookies(cookieJar, headers) {
    const setCookies =
        typeof headers.getSetCookie === 'function'
            ? headers.getSetCookie()
            : [headers.get('set-cookie')].filter(Boolean);

    for (const cookie of setCookies) {
        const [pair] = cookie.split(';');
        const separator = pair.indexOf('=');
        if (separator > 0) cookieJar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
}

function isRetryableError(error) {
    const message = String(error?.message || error).toLowerCase();
    return /abort|connect|econn|network|reset|temporar|timeout|timed out|fetch failed|stream/i.test(message);
}

function retryAfterMilliseconds(response, attempt) {
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.min(RETRY_MAX_DELAY_MS, seconds * 1000);
        }

        const retryAt = Date.parse(retryAfter);
        if (Number.isFinite(retryAt)) {
            return Math.min(RETRY_MAX_DELAY_MS, Math.max(0, retryAt - Date.now()));
        }
    }

    const exponentialDelay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    return exponentialDelay + Math.floor(Math.random() * 250);
}

async function fetchWithRetry(client, url, options, cookieJar, label) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const headers = new Headers(options.headers || {});
            const cookie = getCookieHeader(cookieJar);
            if (cookie) headers.set('cookie', cookie);

            const response = await client.fetch(url, {
                ...options,
                headers,
                timeout: options.timeout ?? client.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
            });
            if (!response || !Number.isInteger(response.status)) {
                throw new Error(`${label}: invalid HTTP response`);
            }

            updateCookies(cookieJar, response.headers);
            if (typeof client.getCookies === 'function') {
                seedCookieJar(cookieJar, await client.getCookies());
            }

            if (response.status === 429 || response.status >= 500) {
                if (attempt === MAX_RETRIES) return response;
                const wait = retryAfterMilliseconds(response, attempt);
                log.warning(`${label}: HTTP ${response.status}; retrying in ${wait}ms (${attempt}/${MAX_RETRIES})`);
                await sleep(wait);
                continue;
            }

            return response;
        } catch (error) {
            if (!isRetryableError(error) || attempt === MAX_RETRIES) throw error;
            const wait = Math.min(
                RETRY_MAX_DELAY_MS,
                RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * 250),
            );
            log.warning(`${label}: temporary request error; retrying in ${wait}ms (${attempt}/${MAX_RETRIES})`);
            await sleep(wait);
        }
    }

    throw new Error(`Request failed after ${MAX_RETRIES} attempts: ${url}`);
}

async function readHtmlResponse(response, url, label) {
    if (!response || typeof response.text !== 'function') throw new Error(`${label}: invalid response body for ${url}`);
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status} for ${url}`);

    const contentType = response.headers?.get('content-type')?.toLowerCase() || '';
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        throw new Error(`${label}: unexpected content type for ${url}`);
    }

    let html;
    try {
        html = await response.text();
    } catch (error) {
        throw new Error(`${label}: could not read response body for ${url}: ${error.message}`);
    }
    if (!html.trim()) throw new Error(`${label}: empty HTML response for ${url}`);
    return html;
}

async function fetchHtml(client, url, cookieJar, referer, label) {
    const response = await fetchWithRetry(
        client,
        url,
        {
            method: 'GET',
            headers: {
                accept: 'text/html,application/xhtml+xml',
                ...(referer && { referer }),
            },
        },
        cookieJar,
        label,
    );
    const html = await readHtmlResponse(response, url, label);

    if (isChallengeHtml(html)) {
        throw new Error(`${label}: NGOBase access challenge for ${url}`);
    }

    return {
        html,
        url: response.url || url,
    };
}

async function postForm(client, url, values, cookieJar, referer, label) {
    const body = new URLSearchParams(values).toString();
    const response = await fetchWithRetry(
        client,
        url,
        {
            method: 'POST',
            headers: {
                accept: 'text/html,application/xhtml+xml',
                'content-type': 'application/x-www-form-urlencoded',
                ...(referer && { referer }),
            },
            body,
        },
        cookieJar,
        label,
    );

    const html = await readHtmlResponse(response, url, label);
    if (isChallengeHtml(html)) {
        throw new Error(`${label}: NGOBase access challenge for ${url}`);
    }

    return {
        html,
        url: response.url || url,
    };
}

export function normalizeSort(value) {
    const sort = cleanQueryValue(value).toLowerCase();
    if (sort === 'default' || sort === 'popularity') return '';
    if (!SORT_VALUES.has(sort)) throw new Error(`Unsupported sorting value "${value}".`);
    return sort;
}

export function applySort(url, sort, sortBase) {
    if (!sort) return url;
    if (!sortBase && new URL(url).pathname.startsWith('/agencies/')) return url;
    const base = sortBase || url;
    const sortedUrl = new URL(base);
    sortedUrl.pathname = `${sortedUrl.pathname.replace(/\/$/, '')}/${sort}`;
    return sortedUrl.href;
}

function isAccessChallengeError(error) {
    return /HTTP 403|access denied|cloudflare|challenge|just a moment/i.test(String(error?.message || error));
}

function toPlaywrightProxy(proxyUrl) {
    if (!proxyUrl) return undefined;
    const parsed = new URL(proxyUrl);
    const proxy = {
        server: `${parsed.protocol}//${parsed.host}`,
    };
    if (parsed.username) proxy.username = decodeURIComponent(parsed.username);
    if (parsed.password) proxy.password = decodeURIComponent(parsed.password);
    return proxy;
}

function browserResponse(status, url, headers, body) {
    const safeHeaders = {};
    for (const [name, value] of Object.entries(headers || {})) {
        const cleanValue = String(value)
            .replace(/[\r\n]+/g, ' ')
            .trim();
        if (cleanValue) safeHeaders[name] = cleanValue;
    }

    return {
        status,
        ok: status >= 200 && status < 300,
        url,
        headers: new Headers(safeHeaders),
        text: async () => body,
    };
}

export function hasAgencyContent(html) {
    return (
        /<(?:a|form)\b[^>]+(?:href|action)=["'][^"']*\/agency\//i.test(html) ||
        /class=["'][^"']*\blisting_logo_img\b/i.test(html) ||
        /id=["'](?:agency_country|agency_type)["']/i.test(html) ||
        /name=["']_token["']/i.test(html)
    );
}

export function isChallengeHtml(html) {
    if (!html || hasAgencyContent(html)) return false;

    return (
        /<title[^>]*>\s*(?:just a moment|checking your browser|access denied|attention required)/i.test(html) ||
        /id=["'][^"']*challenge[^"']*|cf-chl-|challenge-platform|checking your browser before accessing|enable javascript and cookies|access denied/i.test(
            html,
        )
    );
}

async function createBrowserClient(proxyUrl, cookieJar) {
    const profileDir = join(tmpdir(), `ngobase-profile-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const context = await chromium.launchPersistentContext(profileDir, {
        channel: 'chrome',
        headless: false,
        noViewport: true,
        locale: 'en-US',
        // Unblocker MITMs HTTPS, so accept its certificate for that route only.
        ignoreHTTPSErrors: isUnblockerProxyUrl(proxyUrl),
        // Keep only container-safe flags: Patchright already patches the CDP
        // automation surface, and disabling Chromium features such as client
        // hints (Accept-CH) breaks Cloudflare's Critical-CH negotiation.
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
        ...(proxyUrl && { proxy: toPlaywrightProxy(proxyUrl) }),
    });

    const setCookies = async () => {
        if (!cookieJar?.size) return;
        try {
            await context.addCookies(
                [...cookieJar.entries()].map(([name, value]) => ({
                    name,
                    value,
                    domain: '.ngobase.org',
                    path: '/',
                })),
            );
        } catch (error) {
            log.debug(`Cookie handoff to the fallback browser was skipped: ${error.message}`);
        }
    };

    await setCookies();
    const page = await context.newPage();

    const hasClearance = async () => {
        const cookies = await context.cookies('https://ngobase.org').catch(() => []);
        return cookies.some((cookie) => cookie.name === 'cf_clearance' && cookie.value);
    };

    // Cloudflare managed challenge: wait for the browser to solve the challenge,
    // obtain the cf_clearance cookie, then reload to fetch the real page. The
    // wait is bounded so a permanently blocked session fails instead of hanging.
    const resolveChallenge = async () => {
        const deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
        let html = '';
        while (Date.now() < deadline) {
            await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
            html = await page.content().catch(() => '');
            if (hasAgencyContent(html)) return html;

            if (await hasClearance()) {
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                html = await page.content().catch(() => '');
                if (hasAgencyContent(html)) return html;
            }
            await page.waitForTimeout(2500);
        }
        return html || (await page.content().catch(() => ''));
    };

    const client = {
        requestTimeoutMs: isUnblockerProxyUrl(proxyUrl) ? UNBLOCKER_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
        async fetch(url, options = {}) {
            const method = options.method || 'GET';
            const timeout = options.timeout ?? client.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

            if (method === 'GET') {
                const referer = options.headers?.get?.('referer');
                let response;
                try {
                    response = await page.goto(url, {
                        waitUntil: 'domcontentloaded',
                        timeout,
                        ...(referer && { referer }),
                    });
                } catch (error) {
                    // Chromium aborts navigations that resolve to an error status
                    // (e.g. net::ERR_HTTP_RESPONSE_CODE_FAILURE). Inspect whatever
                    // rendered below and let the recovery ladder handle it.
                    log.debug(`Navigation to ${url} reported: ${error.message}`);
                }

                const html = await resolveChallenge();
                if (hasAgencyContent(html)) {
                    const responseHeaders = response?.headers() || { 'content-type': 'text/html; charset=UTF-8' };
                    return browserResponse(200, page.url(), responseHeaders, html);
                }

                const responseStatus = response?.status();
                throw new Error(
                    `NGOBase access challenge; navigation did not return agency content${responseStatus ? ` (HTTP ${responseStatus})` : ''}.`,
                );
            }

            const requestHeaders = Object.fromEntries(new Headers(options.headers || {}).entries());
            delete requestHeaders.cookie;
            const result = await page.evaluate(
                async ({ requestUrl, requestMethod, headers, body }) => {
                    const response = await fetch(requestUrl, {
                        method: requestMethod,
                        headers,
                        body,
                        credentials: 'include',
                        redirect: 'follow',
                    });
                    return {
                        status: response.status,
                        url: response.url,
                        headers: Object.fromEntries(response.headers.entries()),
                        body: await response.text(),
                    };
                },
                {
                    requestUrl: url,
                    requestMethod: method,
                    headers: requestHeaders,
                    body: options.body,
                },
            );

            if (isChallengeHtml(result.body)) {
                const solved = await resolveChallenge();
                if (hasAgencyContent(solved)) {
                    return browserResponse(200, page.url(), { 'content-type': 'text/html; charset=UTF-8' }, solved);
                }
            }

            return browserResponse(result.status, result.url || url, result.headers, result.body);
        },
        getCookies: async () => context.cookies('https://ngobase.org'),
        // The origin rejects an XHR-style POST to /agency_filter_redirect with
        // HTTP 419, so submit the site's own filter form as a real navigation.
        async submitFilter({ country, state, agencyType }) {
            if (country) await page.selectOption('#agency_country', country).catch(() => {});
            if (state) await page.selectOption('#agency_state', state).catch(() => {});
            if (agencyType) await page.selectOption('#agency_type', agencyType).catch(() => {});
            await Promise.all([
                page
                    .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: client.requestTimeoutMs })
                    .catch(() => {}),
                page.evaluate(() => {
                    const form = document.getElementById('filter_form');
                    if (form) form.submit();
                }),
            ]);
            const html = await resolveChallenge();
            return { html, url: page.url() };
        },
        warmUp: async (url) => {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: client.requestTimeoutMs }).catch(() => {});
            await resolveChallenge();
        },
    };

    return {
        client,
        getCookies: client.getCookies,
        warmUp: client.warmUp,
        setCookies,
        close: async () => {
            await page.close().catch(() => {});
            await context.close().catch(() => {});
        },
    };
}

export async function resolveFilterTarget(client, input, cookieJar, bootstrap) {
    const countryOptions = readSelectOptions(bootstrap.html, '#agency_country');
    const agencyTypeOptions = readSelectOptions(bootstrap.html, '#agency_type');
    const country = input.country ? resolveOption(countryOptions, input.country, 'country') : undefined;
    const agencyType = input.agencyType ? resolveOption(agencyTypeOptions, input.agencyType, 'agency type') : undefined;

    let state;
    if (input.state) {
        if (!country) throw new Error('The state filter requires a country filter.');

        const statesResponse = await postForm(
            client,
            'https://ngobase.org/getStatesInSelectFilter',
            {
                cid: country.value,
                _token: readToken(bootstrap.html),
            },
            cookieJar,
            BASE_URL,
            'Resolve states',
        );
        state = resolveOption(readSelectOptions(statesResponse.html, 'body'), input.state, 'state');
    }

    const hasFilter = country || state || agencyType;
    if (!hasFilter) return undefined;

    // Native form submission (browser client) is the only flow the origin
    // accepts for the filter redirect; direct POSTs return HTTP 419.
    if (typeof client.submitFilter === 'function') {
        return client.submitFilter({
            country: country?.value || '',
            state: state?.value || '',
            agencyType: agencyType?.value || '',
        });
    }

    const filterResponse = await postForm(
        client,
        'https://ngobase.org/agency_filter_redirect',
        {
            _token: readToken(bootstrap.html),
            agency_country: country?.value || '',
            agency_state: state?.value || '',
            agency_type: agencyType?.value || '',
        },
        cookieJar,
        BASE_URL,
        'Build NGOBase funding agency filter URL',
    );

    return { url: filterResponse.url };
}

function readToken(html) {
    const match = html.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/i);
    if (!match) throw new Error('NGOBase CSRF token was not found while resolving filters.');
    return match[1];
}

export async function prepareTargets(client, input, cookieJar) {
    if (input.country || input.state || input.agencyType) {
        const bootstrap = await fetchHtml(client, BASE_URL, cookieJar, undefined, 'Load NGOBase filter options');
        const target = await resolveFilterTarget(client, input, cookieJar, bootstrap);
        return [target];
    }

    if (input.keyword) {
        return [{ url: buildKeywordUrl(input.keyword), sortBase: undefined }];
    }

    return [{ url: BASE_URL, sortBase: undefined }];
}

function isUnblockerProxyUrl(proxyUrl) {
    if (!proxyUrl) return false;
    try {
        return /UNBLOCKER/i.test(new URL(proxyUrl).username);
    } catch {
        return false;
    }
}

function createImpitClient(profile, proxyUrl) {
    const unblocker = isUnblockerProxyUrl(proxyUrl);
    const client = new Impit({
        browser: profile,
        ...(proxyUrl && { proxyUrl }),
        // Apify Unblocker terminates TLS and presents its own certificate, so
        // certificate verification must be relaxed only for the Unblocker route.
        ignoreTlsErrors: unblocker,
    });
    // Cloudflare challenge solving inside Unblocker can exceed the normal
    // request budget, so give the Unblocker route a longer timeout.
    client.requestTimeoutMs = unblocker ? UNBLOCKER_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    return client;
}

function detectProxyGroups(proxyConfiguration) {
    const raw = proxyConfiguration?.apifyProxyGroups ?? proxyConfiguration?.groups ?? [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((group) => String(group || '').toUpperCase()).filter(Boolean);
}

function createProxyProvider(proxyConfiguration, proxyConfigurationObject) {
    const proxyUrls = Array.isArray(proxyConfiguration?.proxyUrls)
        ? proxyConfiguration.proxyUrls.filter((value) => typeof value === 'string' && value)
        : [];

    const configuredGroups = detectProxyGroups(proxyConfiguration);
    const usesUnblocker = configuredGroups.includes('UNBLOCKER');
    const usesResidential = configuredGroups.includes('RESIDENTIAL');
    const hasCustom = proxyUrls.length > 0;

    let primaryMode = 'none';
    if (usesUnblocker) primaryMode = 'unblocker';
    else if (usesResidential) primaryMode = 'residential';
    else if (hasCustom) primaryMode = 'custom';
    else if (proxyConfiguration?.useApifyProxy) primaryMode = 'user';

    let primaryAttempts = 0;
    let customIndex = 0;
    let unblockerAttempts = 0;
    let unblockerConfiguration;

    const sessionId = (prefix, n) => `ngobase_${prefix}_${process.pid}_${Date.now()}_${n}`;

    // UNBLOCKER has no sticky session: each request is routed through Apify's
    // managed anti-bot network and Cloudflare is solved at the proxy level.
    const nextUnblockerProxy = async () => {
        if (!Actor.isAtHome()) return undefined;
        if (unblockerAttempts >= MAX_PROXY_SESSIONS) return undefined;
        if (!unblockerConfiguration) {
            // Reuse the Unblocker configuration already built from the user's
            // proxy input when that input targets Unblocker.
            if (primaryMode === 'unblocker' && proxyConfigurationObject) {
                unblockerConfiguration = proxyConfigurationObject;
            } else {
                try {
                    unblockerConfiguration = await Actor.createProxyConfiguration({
                        groups: ['UNBLOCKER'],
                    });
                } catch (error) {
                    log.warning(
                        `Apify Unblocker proxy is unavailable for this account (${error.message}). `
                            + 'NGOBase is behind a Cloudflare managed challenge, so a Cloudflare-solving proxy '
                            + '(Apify Unblocker or residential proxies) is required; a browser-only session from a '
                            + 'datacenter IP will usually stay blocked.',
                    );
                    unblockerAttempts = MAX_PROXY_SESSIONS;
                    return undefined;
                }
            }
        }
        unblockerAttempts += 1;
        return unblockerConfiguration.newUrl();
    };

    const nextPrimary = async () => {
        if (primaryMode === 'unblocker') {
            return nextUnblockerProxy();
        }
        if ((primaryMode === 'residential' || primaryMode === 'user') && proxyConfigurationObject) {
            if (primaryAttempts >= MAX_PROXY_SESSIONS) return undefined;
            primaryAttempts += 1;
            return proxyConfigurationObject.newUrl(sessionId('primary', primaryAttempts));
        }
        if (primaryMode === 'custom') {
            if (customIndex >= proxyUrls.length) return undefined;
            const value = proxyUrls[customIndex];
            customIndex += 1;
            return value;
        }
        return undefined;
    };

    return {
        // Prefer the user's proxy, then fall back to Apify Unblocker, which is
        // the only route that has cleared this Cloudflare managed challenge.
        initial: async () => (await nextPrimary()) || (await nextUnblockerProxy()),
        recovery: async () => {
            const primary = await nextPrimary();
            if (primary) return primary;
            // Escalate to Unblocker when the configured proxy (or a custom one)
            // cannot clear the Cloudflare challenge.
            return nextUnblockerProxy();
        },
        // The browser fallback always prefers Unblocker so Cloudflare is solved
        // at the proxy before the page reaches the headless browser.
        browserProxy: async (fallback) => (await nextUnblockerProxy()) || fallback,
    };
}

async function closeBrowserSession() {
    if (!browserSession) return;
    const session = browserSession;
    browserSession = undefined;
    await session.close();
}

async function openBrowserSession(proxyUrl, cookieJar) {
    await closeBrowserSession();
    log.warning('Starting the Patchright Chrome stealth session to fetch NGOBase data.');
    const session = await createBrowserClient(proxyUrl, cookieJar);
    browserSession = session;
    // Unblocker solves the Cloudflare challenge at the proxy level for every
    // request, so an extra in-browser warm-up would only add a duplicate solve.
    if (!isUnblockerProxyUrl(proxyUrl)) {
        await session.warmUp(BASE_URL);
    }
    seedCookieJar(cookieJar, await session.getCookies());
    return session;
}

async function run() {
    const input = normalizeInput((await Actor.getInput()) || {});
    const resultsWanted = parseNumber(input.resultsWanted ?? input.results_wanted, DEFAULT_RESULTS_WANTED);
    const maxPages = parseNumber(input.maxPages ?? input.max_pages, DEFAULT_MAX_PAGES);
    const sort = normalizeSort(input.sorting ?? input.sort);
    const { proxyConfiguration } = input;

    let proxyConfigurationObject;
    if (proxyConfiguration && Actor.isAtHome()) {
        try {
            proxyConfigurationObject = await Actor.createProxyConfiguration(proxyConfiguration);
        } catch (error) {
            log.warning(`Ignoring the invalid proxy configuration: ${error.message}`);
        }
    }

    const proxyProvider = createProxyProvider(proxyConfiguration, proxyConfigurationObject);
    const initialProxyUrl = await proxyProvider.initial();
    const cookieJar = new Map();
    const state = {
        kind: 'browser',
        profileIndex: 0,
        proxyUrl: initialProxyUrl,
        proxyProvider,
        client: undefined,
    };

    // Patchright Chrome (stealth) is the primary client. It keeps one cookie
    // session across the listing and filter flow and clears the Cloudflare
    // managed challenge. Direct impit requests remain a fallback for
    // environments where the browser cannot start.
    try {
        const session = await openBrowserSession(initialProxyUrl, cookieJar);
        state.client = session.client;
    } catch (error) {
        log.warning(`Patchright session could not start (${error.message}); using direct requests.`);
        state.kind = 'impit';
        state.client = createImpitClient(IMPIT_PROFILES[0], initialProxyUrl);
    }

    const recoverSession = async (label) => {
        const proxyUrl = await state.proxyProvider.recovery();

        // Primary browser client: restart on a fresh proxy route so the cookie
        // session and Cloudflare clearance are rebuilt cleanly.
        if (state.kind === 'browser') {
            if (!proxyUrl) return false;
            state.proxyUrl = proxyUrl;
            try {
                const session = await openBrowserSession(proxyUrl, cookieJar);
                state.client = session.client;
                log.warning(`${label}: NGOBase access challenge; restarting the Patchright session on a fresh proxy route.`);
                return true;
            } catch (error) {
                log.warning(`${label}: Patchright restart failed: ${error.message}`);
                return false;
            }
        }

        // Direct-request fallback ladder.
        if (proxyUrl) {
            state.proxyUrl = proxyUrl;
            state.profileIndex = 0;
            state.client = createImpitClient(IMPIT_PROFILES[0], proxyUrl);
            log.warning(`${label}: NGOBase access challenge; retrying direct requests through a fresh proxy route.`);
            return true;
        }

        if (state.profileIndex + 1 < IMPIT_PROFILES.length) {
            state.profileIndex += 1;
            state.client = createImpitClient(IMPIT_PROFILES[state.profileIndex], state.proxyUrl);
            log.warning(
                `${label}: NGOBase access challenge; retrying with the ${IMPIT_PROFILES[state.profileIndex]} profile.`,
            );
            return true;
        }

        // Escalate to the browser when direct requests keep failing.
        try {
            const browserProxyUrl = await state.proxyProvider.browserProxy(state.proxyUrl);
            const session = await openBrowserSession(browserProxyUrl, cookieJar);
            state.client = session.client;
            state.kind = 'browser';
            return true;
        } catch (error) {
            log.warning(`${label}: Patchright fallback could not start: ${error.message}`);
            return false;
        }
    };

    const withRecovery = async (label, operation) => {
        for (let attempt = 0; attempt <= MAX_RECOVERIES; attempt++) {
            try {
                return await operation(state.client);
            } catch (error) {
                if (!isAccessChallengeError(error) || attempt === MAX_RECOVERIES) throw error;
                const recovered = await recoverSession(label);
                if (!recovered) throw error;
            }
        }

        throw new Error(`${label}: NGOBase access challenge could not be recovered after ${MAX_RECOVERIES} attempts.`);
    };

    const targets = await withRecovery('Prepare NGOBase target', (client) =>
        prepareTargets(client, input, cookieJar),
    );
    const scrapedAt = new Date().toISOString();
    const seen = new Set();
    let saved = 0;
    let pagesProcessed = 0;

    log.info(
        `Starting NGOBase funding agency run | targets=${targets.length} | results=${resultsWanted} | max_pages=${maxPages}`,
    );

    for (const target of targets) {
        if (saved >= resultsWanted) break;
        let pageUrl = applySort(target.url, sort, target.sortBase);
        let firstPageHtml = target.html;

        for (let pageIndex = 0; pageIndex < maxPages && saved < resultsWanted; pageIndex++) {
            const label = `Fetch page ${pageIndex + 1}`;
            const currentUrl = pageUrl;
            let response;
            if (firstPageHtml) {
                // Reuse the filter result the browser already navigated to.
                response = { html: firstPageHtml, url: target.url };
                firstPageHtml = undefined;
            } else {
                response = await withRecovery(label, (client) =>
                    fetchHtml(client, currentUrl, cookieJar, target.url, label),
                );
            }
            pagesProcessed++;

            const items = parseAgencyListings(response.html, response.url, scrapedAt)
                .filter((item) => {
                    const key = item.url || item.id || `${item.name}-${item.country || ''}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .slice(0, resultsWanted - saved);

            if (items.length > 0) {
                await Dataset.pushData(items);
                saved += items.length;
                log.info(`Saved ${items.length} items | total=${saved}/${resultsWanted} | page=${pageIndex + 1}`);
            }

            const nextPage = extractNextPage(response.html, response.url);
            if (!nextPage || items.length === 0) break;
            pageUrl = nextPage;
        }
    }

    if (saved === 0) throw new Error('NGOBase returned no funding agency records for the supplied input.');
    log.info(`Finished NGOBase funding agency run | saved=${saved} | pages=${pagesProcessed}`);
}

async function main() {
    await Actor.init();
    let failure;
    try {
        await run();
    } catch (error) {
        failure = error;
    } finally {
        await closeBrowserSession();
    }

    if (failure) {
        log.exception(failure, 'NGOBase funding agency run failed');
        await Actor.exit({ exitCode: 1 });
        return;
    }

    await Actor.exit();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
