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

- On 2026-10-16 the target stopped serving content to direct HTTP: every path (`/`, `/funding-agencies`, `/robots.txt`, `/sitemap.xml`) now returns HTTP 403 with a Cloudflare **managed** challenge (`Cf-Mitigated: challenge`, `Server: cloudflare`, `cType: 'managed'`). The challenge is cleared only by a real browser or by Apify's Unblocker proxy.
- **Primary client: Patchright real Chrome (stealth).** The Actor keeps one persistent browser session for the whole run (`channel: 'chrome'`, `headless: false`, `noViewport: true`). This clears the Cloudflare managed challenge and, because the context retains every cookie, keeps the Laravel session and CSRF token consistent across the multi-request filter flow.
- **Why the browser is primary:** running the filter flow (bootstrap `GET` → `getStatesInSelectFilter` `POST` → `agency_filter_redirect` `POST`) through direct HTTP failed with **HTTP 419** (Laravel CSRF/session mismatch). Apify Unblocker has no sticky session, so each request exits a different IP; direct requests could not keep the session and CSRF token bound together. A single browser context does.
- **Proxy:** the Actor runs through Apify's **UNBLOCKER** proxy by default. Unblocker clears the Cloudflare managed challenge at the proxy level, relaxes TLS verification only for that MITM route (`ignoreTlsErrors` / `ignoreHTTPSErrors`), and is given a longer request budget (120s) because challenge solving is slow. `RESIDENTIAL`, custom proxy groups, and a direct session are supported and used as fallbacks when Unblocker is unavailable.
- **Verified constraint (2026-10-16):** a Cloudflare-solving proxy is *required* for this target. Direct HTTP, the Patchright stealth browser, and the account's datacenter proxy groups all received the managed challenge and were never issued `cf_clearance` (`navigator.webdriver` was already `false`, so the block is IP/edge-level, not a browser-fingerprint leak). Only Apify Unblocker returned HTTP 200 with agency rows.
- **Proxy default:** `input_schema.json` sets `apifyProxyGroups: ["UNBLOCKER"]` as the `proxyConfiguration` default. An account must have Unblocker allocation for runs to start; without it, Apify rejects the input at validation (`You currently do not have access to proxy groups: UNBLOCKER`). Residential and custom proxy groups are supported as user overrides and the Actor still escalates to Unblocker at runtime when the selected proxy cannot clear the challenge.
- **Fallback client: `impit` direct HTTP.** If the browser cannot start (for example a display-less local run), the Actor falls back to `impit` with a bounded ladder. `impit` profiles are valid for impit 0.14.x (`chrome`, `chrome131`, `chrome136`, `firefox`, `firefox133`, `firefox144`, `chrome142`, `ios18`, plus `okhttp*` and older `chrome1xx` variants).
- Recovery is bounded and evidence-based. In browser mode it restarts the Patchright session on a fresh proxy route. In the direct-request fallback it rotates the proxy route, then the `impit` profile, then escalates to the browser.
- Cookies collected by `impit` are transferred into the browser context, and browser cookies are handed back to subsequent requests.
- Filter resolution keeps the CSRF token, referer, and browser session together.
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
