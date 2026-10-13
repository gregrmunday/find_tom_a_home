# Find Tom a Home

A small London property radar at **https://gregrmunday.github.io/find_tom_a_home/**.

Plain HTML, CSS and JavaScript; Leaflet for the map; a Python standard-library collector; GitHub Actions for checks and GitHub Pages for hosting. No build system, application server, database, paid API or package installation. The website never makes requests to Rightmove itself.

## Current state

The draft is ready for search requirements. Collection is disabled in `config/searches.json`, with no assumptions about budget, buying versus renting, bedrooms or areas. The page includes an explicitly labelled, optional fictional example view. The scheduled workflow runs at minute 17 each hour and publishes a status feed; enabling saved searches activates real collection.

## Set up your search

1. Enter the desired requirements on Rightmove and copy each results page URL. You can use a separate saved search for every combination of area, price and other preferences.
2. Add entries to `config/searches.json`, each with a unique `id`, a `name`, a `url` and optional per-search `filters`.
3. Set `enabled` to `true`, update the readable `summary`, and commit. The workflow runs immediately and then approximately hourly.

For example (illustrative criteria, not the user's preferences):

```json
{
  "id": "north-london",
  "name": "North London",
  "url": "https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=REGION%5E87490&minBedrooms=3&maxPrice=800000&propertyTypes=terraced&includeSSTC=false",
  "filters": {"excludeAuction": true, "excludeSharedOwnership": true}
}
```

Search combinations are combined with **OR** and deduplicated by Rightmove property ID. Global filters apply to each search, with per-search values overriding global values. Numeric bounds, house types, keyword inclusion/exclusion, auction/shared ownership exclusions and optional map bounds are supported. Bounds use `[south, west, north, east]`. Keywords check the address, search summary, key features and tenure; text omitted from the search page cannot be checked. Commutes, exact floor area, garden size and other detailed criteria need a later enrichment step; the current collector does not infer them.

The first complete run of a new or changed search establishes its baseline. Existing listings are labelled **Initial match** and appear under **All homes**, rather than falsely appearing as new in the past 24 hours. Later additions are ordered by the time this tracker first found them. `publishedAt` is kept separately: first discovery does not mean a listing was just published. A price change to an existing property does not create a duplicate or a new-home alert. Removed matches disappear only after their search completes successfully; this means that narrowing a search or a listing dropping out of its source result window can also remove it from this tracker.

## Reliability and source access

Rightmove does not document an open consumer search API. This collector reads embedded JSON from public search HTML using a named user agent, 35-second timeouts and a two-second pause between pages. It stops on access failures, with no proxies, login automation or anti-bot bypass. [Rightmove's terms](https://www.rightmove.co.uk/c/terms-of-use/) restrict scraping and automated access; this integration may be blocked, and authorised data access or a separate feed may be needed for long-term operation. Images are not downloaded or embedded. Rightmove's official [instant alerts](https://faq.rightmove.co.uk/support/solutions/articles/7000048758-how-to-register-for-property-alerts) are an alternative source for immediate notifications, but ingesting them would require an inbox integration that has not been configured.

If a search fails, previously collected listings stay visible with a warning. A page limit also reports incomplete coverage and retains old results; it never silently reports a complete search. Default limit: eight pages per search; narrow the criteria if this is insufficient. Public results and inactive deduplication records are retained for 90 days. Search details and listing metadata are public in this repository and site; credentials should never be placed in the configuration.

[GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) may run late or be dropped during high load. Hourly polling typically adds up to about an hour's detection delay, plus scheduling and publishing delays; it cannot guarantee being first. The page displays check timestamps and an overdue warning after 2.5 hours without a complete successful check. The website reloads its small JSON feed every five minutes while visible. Refresh reloads that feed; it does not trigger a Rightmove request.

There are no outbound notifications yet: this stage provides the webpage and collection infrastructure. A later email or push notification integration can use the same newly discovered IDs. The shortlist is saved only in the current browser. A home dropping out of the active source results is no longer shown in the shortlist, though its saved ID remains locally.

## Run locally

```sh
python3 scripts/collect.py
python3 -m http.server 8000 --directory public
```

Then visit http://localhost:8000. No dependency installation is required.

## Deployment

The repository's GitHub Pages source is **GitHub Actions**. `.github/workflows/update-and-deploy.yml` collects, commits only the feed and discovery history, and uploads only `public/`. Updates share a concurrency group so overlapping workflow runs do not race. `[skip ci]` on feed commits avoids recursion. Failed collection still publishes preserved results and warnings, then marks the workflow failed so GitHub can notify the repository owner. State survives runner restarts in `state/seen.json`; new or changed search criteria establish a baseline independently. The hourly status commit also keeps scheduled workflows from becoming inactive after 60 days without repository activity.

Maps use [Leaflet](https://leafletjs.com/) 1.9.4 and [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles with visible attribution and ordinary browser caching. Maps load only the visible viewport and do not prefetch tiles. Fonts and Leaflet use external services; system fonts and property results still work if those services are unavailable.
