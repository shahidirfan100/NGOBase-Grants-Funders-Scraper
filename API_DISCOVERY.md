# NGOBase Funding Agencies source discovery

## Selected source

- **Endpoint:** `https://ngobase.org/funding-agencies`
- **Method:** GET for listing pages, POST for the public filter form
- **Auth:** No account authentication. A fresh public-page CSRF token and session cookies are used for filter resolution.
- **Search:** `https://ngobase.org/funding-agencies?search={keyword}`
- **Pagination:** `?page=N`, with a `rel="next"` link on listing pages
- **Sorting:** `/funding-agencies/name_a_to_z` and `/funding-agencies/type_name`
- **Filters:** `/agency_filter_redirect` with `agency_country`, `agency_state`, and `agency_type`
- **Fields available:** agency ID, name, NGOBase profile URL, logo, country, agency type, website, Facebook, LinkedIn, source URL, source, and scrape timestamp
- **API status:** No stable JSON API was found. The verified production source is the server-rendered HTML listing.

## Discovery evidence

The live target page is titled **Funding Agencies and Grantmakers Worldwide** and reports a paginated directory. Its desktop listing uses rows with the following verified markers:

- `.row.border.p-3.mb-2.align-items-center.bg-white` for each agency row
- `a[href*="/agency/"]` for agency profile links
- `a[title*="Funding agency"]` for agency names
- `.listing_logo_img` for agency logos
- `.listing_locations` for countries
- `a[href*="/agencies/t/"]` for agency type links
- Links titled with `agency website`, `agency facebook page`, and `agency linkedin page` for public external profiles

The page also exposes Schema.org `FundingAgency` metadata, but the visible listing rows provide the fields used by this Actor and preserve the direct source URLs.

## Candidate matrix

| Candidate                | Profile or request                                       | Result                                                                                                      | Fields                                     | Pagination                 | Decision                       |
| ------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------- | ------------------------------ |
| JSON API candidates      | `/api/ngos`, `/api/agencies`, `/api/v1/*`, `/graphql`    | 404 or challenge HTML; no expected agency JSON                                                              | 0                                          | Unknown                    | Rejected                       |
| URLScan domain scans     | `https://urlscan.io/api/v1/search/?q=domain:ngobase.org` | Existing public scans cover NGOBase pages and agency detail pages; no verified funding-agency JSON response | HTML and page metadata                     | Not applicable             | Rejected for extraction        |
| Funding agency directory | `/funding-agencies`                                      | HTTP 200 server-rendered HTML with 20 agency rows                                                           | 9 agency/source fields plus metadata       | `?page=N` and `rel="next"` | Selected                       |
| Agency name search       | `/funding-agencies?search={keyword}`                     | Same directory markup filtered by agency name                                                               | Same listing fields                        | `?page=N`                  | Selected                       |
| Agency filter form       | `/agency_filter_redirect`                                | POST response redirects to canonical filtered HTML                                                          | Country, state, and agency type results    | Canonical URL pagination   | Selected                       |
| Agency detail pages      | `/agency/{id}`                                           | HTTP 200 HTML with limited profile content                                                                  | Limited extra fields, no verified JSON API | One request per agency     | Rejected for fast listing mode |

## Why weaker candidates were rejected

NGOBase did not expose a verified JSON endpoint for the funding-agency directory. Guessed `/api/*` and GraphQL paths did not return the expected agency collection. URLScan results confirmed the site's server-rendered HTML pattern but did not provide a reusable JSON collection endpoint. The direct listing source was therefore chosen because it is public, paginated, and contains the agency fields required by the dataset.

The Actor does not request agency detail pages. The detail HTML adds limited extra information compared with the directory while requiring one additional request per agency, so it was rejected in favor of the fast listing-only source.

## Request and session behavior

- On 2026-10-16 the target stopped serving content to direct HTTP: every path (`/`, `/funding-agencies`, `/robots.txt`, `/sitemap.xml`) returns HTTP 403 with a Cloudflare **managed** challenge (`Cf-Mitigated: challenge`, `Server: cloudflare`, `cType: 'managed'`).
- **Primary client: Patchright real Chrome (stealth).** The Actor keeps one persistent browser session for the whole run (`channel: 'chrome'`, `headless: false`, `viewport: null`, `ignoreDefaultArgs: ['--enable-automation']`). It clears the Cloudflare managed challenge and, because the context retains every cookie, keeps the Laravel session and CSRF token consistent across the multi-request filter flow.
- **Root cause of the earlier block:** Patchright 1.57+ regressed `launchPersistentContext` so Chrome's `--enable-automation` flag was no longer stripped, which is a hard automation signal. Passing `ignoreDefaultArgs: ['--enable-automation']` explicitly fixes it. Also keep custom launch flags to a minimum (do not disable Chromium features such as client hints — `Accept-CH`/`Critical-CH` is part of Cloudflare's flow) and only add `--webrtc-ip-handling-policy=disable_non_proxied_udp` so WebRTC cannot leak the real IP behind a proxy.
- **No proxy is required.** Verified on 2026-10-16: the corrected stealth browser cleared the challenge from a plain Apify datacenter connection and returned agency rows in ~2s (keyword mode 20/20) and via the account's USA proxy group (filter mode 10/10). `proxyConfiguration` therefore defaults to `{}`.
- **Optional proxies:** Apify Unblocker and residential proxies remain selectable and are used for recovery escalation when a run is challenged. Unblocker has no sticky session, so it is not required for the browser flow; TLS verification is relaxed only for the Unblocker MITM route (`ignoreTlsErrors` / `ignoreHTTPSErrors`).
- **Why the browser handles the filter flow:** the filter flow (bootstrap `GET` → `getStatesInSelectFilter` `POST` → `agency_filter_redirect` `POST`) returns **HTTP 419** (Laravel CSRF/session mismatch) when driven by an XHR-style `fetch`; the Actor submits the site's real `#filter_form` as a native navigation instead, which the origin accepts.
- **Fallback client: `impit` direct HTTP.** If the browser cannot start (for example a display-less local run), the Actor falls back to `impit` with a bounded ladder. `impit` profiles are valid for impit 0.14.x (`chrome`, `chrome131`, `chrome136`, `firefox`, `firefox133`, `firefox144`, `chrome142`, `ios18`, plus `okhttp*` and older `chrome1xx` variants).
- Recovery is bounded and evidence-based. In browser mode it restarts the Patchright session on a fresh proxy route. In the direct-request fallback it rotates the proxy route, then the `impit` profile, then escalates to the browser.
- A Chromium navigation that returns an error status (e.g. `net::ERR_HTTP_RESPONSE_CODE_FAILURE`) is caught, inspected, and routed into the recovery ladder instead of failing the run.
- Cookies collected by `impit` are transferred into the browser context, and browser cookies are handed back to subsequent requests.
- Apify proxy session IDs accept only `[A-Za-z0-9._~]` characters, so residential rotation uses `ngobase_<pid>_<timestamp>_<n>` (hyphens are rejected by `ProxyConfiguration.newUrl`).
- The Actor retries temporary network errors and HTTP 429 or 5xx responses with bounded delays.
- No authorization token, API key, or cookie value is hardcoded in the Actor.

## Acceptance checks

- Funding agency target: `https://ngobase.org/funding-agencies`
- Default QA input uses the agency keyword `UNICEF` and `resultsWanted: 20`
- Agency rows produce non-empty `name` or profile `url` values
- Duplicate profiles are removed across pages
- Each non-empty page is pushed to the dataset immediately
- Pagination stops at the requested result or page limit
- A zero-record run fails explicitly instead of succeeding with an empty dataset.
