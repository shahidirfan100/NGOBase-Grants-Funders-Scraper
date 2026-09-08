## What does NGOBase Grants & Funders Scraper do?

NGOBase Grants & Funders Scraper collects public funding agency and grantmaker data from [NGOBase](https://ngobase.org/funding-agencies). Search by agency name, browse the worldwide directory, or narrow results by country, state, and agency type. The result is a structured dataset for grant prospecting, nonprofit research, funding landscape analysis, and partnership discovery.

Each item can include the agency name, NGOBase profile URL, logo, country, agency type, public website, Facebook page, LinkedIn page, source URL, and collection timestamp. Fields that are not published for an agency are omitted rather than filled with empty values.

## Why use NGOBase Grants & Funders Scraper?

- **Find funding sources** - Build a searchable list of foundations, government agencies, UN agencies, diplomatic missions, aid agencies, and other grantmakers.
- **Search by agency name** - Locate known funders and grantmaking organizations with a simple keyword.
- **Filter the directory** - Focus collection on a country, state or province, and funding agency type.
- **Collect clean records** - Receive structured data that is ready for research, enrichment, reporting, and grant prospecting.
- **Avoid duplicate results** - Duplicate profiles are removed when pagination or repeated source listings contain the same agency.
- **Control run size** - Set a result limit and page limit for quick checks, scheduled refreshes, or larger collections.
- **Automate your workflow** - Use Apify datasets, API access, schedules, webhooks, and integrations to move data into other systems.

## What data can you extract from NGOBase funding agencies?

| Field         | Description                                      |
| ------------- | ------------------------------------------------ |
| `id`          | NGOBase funding agency identifier when available |
| `name`        | Funding agency or grantmaker name                |
| `url`         | NGOBase agency profile URL                       |
| `logo`        | Public agency logo URL when available            |
| `website`     | Agency website when published                    |
| `facebook`    | Agency Facebook page when published              |
| `linkedin`    | Agency LinkedIn page when published              |
| `country`     | Agency country                                   |
| `agency_type` | Funding agency classification when published     |
| `source_url`  | Listing page used to collect the record          |
| `source`      | Source website name                              |
| `scraped_at`  | UTC timestamp for the collection run             |

## How to use NGOBase Grants & Funders Scraper

1. Open the Actor on Apify.
2. Enter an agency name keyword, or leave it empty to browse the main directory.
3. Optionally add a country, state or province, or agency type. State filtering requires a country.
4. Choose the result order and collection limits.
5. Run the Actor.
6. Review the dataset, then download it or connect it to your workflow.

Keyword searches are treated as a separate search mode. When a keyword is supplied, it is used as the agency search and unrelated location filters are not added automatically. When no keyword is supplied, the Actor uses the selected directory filters or the worldwide funding agency directory.

## Input Parameters

| Parameter            | Type    | Required | Default         | Description                                                               |
| -------------------- | ------- | -------- | --------------- | ------------------------------------------------------------------------- |
| `keyword`            | String  | No       | `UNICEF` for QA | Agency name or public listing text to search                              |
| `country`            | String  | No       | -               | Country name or NGOBase country code                                      |
| `state`              | String  | No       | -               | State or province name or code; requires `country`                        |
| `agencyType`         | String  | No       | -               | Agency type code such as `ga` for Government Agency or `un` for UN Agency |
| `sorting`            | String  | No       | `default`       | `default`, `name_a_to_z`, or `type_name`                                  |
| `resultsWanted`      | Integer | No       | `20`            | Maximum number of unique records to save                                  |
| `maxPages`           | Integer | No       | `10`            | Maximum listing pages to request                                          |
| `proxyConfiguration` | Object  | No       | Apify Proxy     | Optional proxy settings for larger or protected runs                      |

Agency type values are available in the Apify input form. The supported codes are `cf` for Corporate Foundation / CSR, `em` for Embassy / Diplomatic Mission, `ff` for Family Foundation, `ga` for Government Agency, `ii` for Impact Investment Firm, `ias` for Industry Association, `ida` for International Development Aid Agency, `ot` for Other, `pbf` for Private / Public Foundation, and `un` for UN Agency.

Sorting applies to the main directory and agency-name search routes. NGOBase serves country, state, and agency-type filters through canonical `/agencies/...` routes that do not support sort suffixes, so those filtered runs keep the source order.

## Output Data

| Field         | Type   | Description                          |
| ------------- | ------ | ------------------------------------ |
| `id`          | String | NGOBase agency identifier            |
| `name`        | String | Agency or grantmaker name            |
| `url`         | String | NGOBase profile link                 |
| `logo`        | String | Logo link when available             |
| `website`     | String | Public website link when available   |
| `facebook`    | String | Facebook link when available         |
| `linkedin`    | String | LinkedIn link when available         |
| `country`     | String | Country listed by NGOBase            |
| `agency_type` | String | Agency classification when available |
| `source_url`  | String | Listing URL used for collection      |
| `source`      | String | `ngobase.org`                        |
| `scraped_at`  | String | ISO 8601 collection timestamp        |

## Usage Examples

### Basic agency search

Search for funding agencies associated with UNICEF:

```json
{
    "keyword": "UNICEF",
    "resultsWanted": 20,
    "maxPages": 3
}
```

### Country and agency type filter

Collect government funding agencies listed in Canada:

```json
{
    "country": "Canada",
    "agencyType": "ga",
    "sorting": "name_a_to_z",
    "resultsWanted": 100,
    "maxPages": 10
}
```

### State-specific collection

Collect funding agencies listed for Ontario, Canada:

```json
{
    "country": "Canada",
    "state": "Ontario",
    "resultsWanted": 50,
    "maxPages": 5
}
```

## Sample Output

```json
{
    "id": "2535",
    "name": "(SF) - Shell Foundation",
    "url": "https://ngobase.org/agency/2535",
    "logo": "https://ngobase.org/images/agency_logos/GB/(SF)---Shell-Foundation.png",
    "website": "https://shellfoundation.org/",
    "country": "United Kingdom",
    "agency_type": "Private / Public Foundation",
    "source_url": "https://ngobase.org/funding-agencies",
    "source": "ngobase.org",
    "scraped_at": "2026-09-08T00:00:00.000Z"
}
```

## Tips for Best Results

- Start with `resultsWanted: 20` to check a keyword or filter before a larger run.
- Use the exact country or agency type shown in the input form when possible.
- Provide a country before using a state or province filter.
- Use `maxPages` as a safety limit for broad directory searches.
- Enable Apify Proxy for larger, repeated, or scheduled runs if the source presents an access challenge.
- Review the dataset preview and check missing fields against the source listing. Missing values usually mean NGOBase did not publish that field.
- Public directory pages can change. Report changed markup, missing records, or incorrect fields through the Actor Issues tab.

## Integrations

- **Apify API** - Read dataset items programmatically after a run.
- **Google Sheets** - Export agency records for grant research and collaboration.
- **Webhooks** - Trigger notifications or downstream processing when a run finishes.
- **Make or Zapier** - Send new funder records to CRM, alerts, research, or reporting workflows.
- **CSV, Excel, JSON, and XML** - Download the dataset in common formats for analysis.

## Frequently Asked Questions

### Can I search for one funding agency?

Yes. Set `keyword` to the agency name, abbreviation, or another public search phrase. The Actor uses the agency search mode and does not add unrelated QA or location values.

### Can I collect agencies from a specific country?

Yes. Set `country` to a country name such as `Canada` or to the corresponding NGOBase country code. You can also add a state or province when the country supports that filter.

### What agency types are supported?

The directory supports Corporate Foundation / CSR, Embassy / Diplomatic Mission, Family Foundation, Government Agency, Impact Investment Firm, Industry Association, International Development Aid Agency, Other, Private / Public Foundation, and UN Agency.

### Can I collect all available agencies?

You can increase `resultsWanted` and `maxPages` for a broad collection. Begin with a smaller run to confirm the selected search or filter and then scale up.

### Why are some output fields missing?

The Actor omits values that NGOBase does not publish for a particular agency. This avoids misleading empty columns and preserves the source's actual coverage.

### Can I export the results to CSV or Excel?

Yes. Apify datasets can be downloaded as CSV, Excel, JSON, XML, and other supported formats.

### Can I schedule recurring collections?

Yes. Create an Apify schedule with a saved input to refresh the funding agency dataset hourly, daily, weekly, or on a custom interval.

### Is it legal to collect NGOBase data?

Public data collection may be subject to applicable laws, privacy rules, and NGOBase terms. You are responsible for using the data lawfully, respecting access controls, and following the source website's published rules.

## Related Actors

- [GoFundMe Fundraiser Scraper](https://apify.com/shahidirfan/gofundme-fundraiser-scraper) - Collect fundraiser and funding campaign data for nonprofit and fundraising research.
- [Kickstarter Scraper](https://apify.com/shahidirfan/kickstarter-scraper) - Collect crowdfunding project data for funding landscape and campaign analysis.

## Support

For issues, feature requests, or custom Actor work, use the Issues tab on the Actor page or contact the developer through Apify.

## Legal Notice

This Actor is intended for legitimate collection of publicly available funding agency directory data. Users are responsible for complying with NGOBase terms, applicable laws, privacy requirements, and any restrictions attached to the collected data.
