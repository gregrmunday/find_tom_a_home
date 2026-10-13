# Find Tom a Home

A compact personal rental dashboard at **https://gregrmunday.github.io/find_tom_a_home/**.

Plain HTML, CSS and JavaScript, Leaflet for the map, Python standard library for collection, GitHub Actions for hourly checks and GitHub Pages for hosting. No build system, application server, database, paid API or package installation. The website reads only the published JSON feed. Collectors run on GitHub Actions.

## Configured criteria

- South of Peckham Road **and** within exactly 1 mile of Denmark Hill Station, London (Rightmove `STATION^2714`). Use Rightmove's unrounded station distance where present, otherwise great-circle distance from its station map point (51.46829, -0.0895). One mile is 1609.344 metres. This is straight-line distance, not walking distance.
- Exactly one bedroom up to £2,000 pcm, with £1,800 or less preferred; exactly two bedrooms up to £2,100 pcm.
- A floor plan must be present in the listing's floor-plan section.
- Exclude student accommodation, flat/house shares, shared kitchens/bathrooms and retirement housing using the property type and full description. A normal self-contained apartment saying students or sharers are welcome is not itself student accommodation or a room share.
- Station proximity: exclude homes at or within 0.1 miles of a station in Rightmove's nearest-stations information. This is an initial configurable interpretation of adjacency, not a user-specified distance.
- Railway proximity: exclude listing pins within 50 metres of mapped active tracks, and entire named streets with at least 50 metres running parallel beside tracks within 50 metres. The parallel test avoids excluding a road merely because it crosses a railway. These thresholds are configurable interpretations of adjacency, not a user-specified distance.
- Approximate pins, uncertain street names and failed detail checks go under **Needs checking**, outside the recommendations and match counts. This is a screening tool, not a guarantee about railway noise or exact property boundaries.

The northern boundary follows mapped Peckham Road, its western continuation along Camberwell Church Street and Camberwell New Road, and Peckham High Street to the east. Latitude is interpolated along the actual road geometry at each pin longitude; it is not a fixed-latitude cutoff. Pins within 15 metres of the road centreline are held for review. Geometry outside the known road coverage is also held for review.

`config/searches.json` holds the saved searches, prices, radius, road boundary, enrichment and railway settings. Results combine with OR and deduplicate by Rightmove ID. Each source uses newest-first search order, excludes let-agreed results and fetches all accessible pages subject to the configured limit. Price-per-week listings use the advertised PCM amount if present, or annualised weekly rent (weekly × 52 ÷ 12), so ceilings operate on monthly rent.

## Ranking and welcome summary

The default view and the three welcome recommendations use these tiers, in order:

1. First listed within the last 24 hours.
2. First listed within the last 72 hours.
3. Older listings, or an unknown listing date.

Within a tier, completed refurbishment/renovation wording receives a boost; fresh decoration or new fittings receives a smaller boost. Being within the £1,800 one-bedroom target and lower rent within the bedroom-specific ceiling also improves ranking. Publication time and distance break ties. An older refurbished listing cannot outrank a match in a fresher tier. Scores are internal weights, not percentages or guarantees of suitability. The interface displays short reasons instead of a numeric score.

Descriptions are read in full, including key features. Badges reflect the advertiser's claims, not an inspection of the property. Planned or required work is not treated as a completed refurbishment. The listing date is separate from the time the tracker discovered it: a first collection does not pretend all existing matches were newly listed, and a price reduction does not reset listing age. Initial matches can appear in the 24-hour summary if the source says they were actually published within 24 hours.

Views include Matches, 24h, 3d, Saved and Needs checking, with a source filter and sorting. Dense rows show rent, bedrooms, age, station distance, refurbishment and source links; descriptions expand on demand. The map uses CARTO Positron tiles, numbered pins matching result rows, separate one-/two-bedroom colours, selected-home highlighting and collision offsets with connectors to reported positions. Denmark Hill, the 1-mile circle and the northern road boundary remain visible. The shortlist stays in this browser, and saved IDs survive merged adverts. Marketing copy and fictional previews were removed.

## Collection and caching

`scripts/collect.py` reads public search-page JSON. `scripts/enrich.py` reads full descriptions, floor-plan counts, availability, pin precision and nearest-station distances from public property HTML. The current property-page format is a flattened JSON reference table; it is decoded as data, without executing page scripts.

Detail data is cached in `state/details.json` for 24 hours and refreshed sooner when the search's update timestamp changes. At most 80 detail requests are made per run, with a time budget and short pauses; unchecked homes remain under Needs checking. `state/seen.json` retains discovery history and search membership. Full descriptions and these caches are public in this repository, so credentials must never be placed in configuration or state.

`scripts/geography.py` screens against a compact local OpenStreetMap extract in `state/rail-map.json`. It indexes rail segments in memory and compares named streets with the mapped tracks. Geometry is reused and refreshed weekly, in four API requests small enough to meet OSM's extract limits. The resulting compact street/rail cache stays outside the published website, keeping page loads small. Map-refresh failure uses cached geometry with a warning; without geometry, properties are held for checking. Map coverage extends beyond the search radius. Map data and derived street information are © OpenStreetMap contributors, available under [ODbL 1.0](https://www.openstreetmap.org/copyright).

Collection failures preserve the last available results and publish warnings. Page limits and capped source results are reported as incomplete. Only a complete search removes old membership from its source. Inactive discovery records and detail caches expire after 90 days. An unavailable source or an approximate map pin is never silently reported as a fully checked match. Cached results can become stale; the site displays timestamps and an overdue warning after 2.5 hours without a complete successful check.

## Source access and timing

Rightmove has no documented open consumer search API. This collector uses ordinary public HTML requests with a named user agent, timeouts and pauses, without proxies, login automation or anti-bot bypass. [Rightmove's terms](https://www.rightmove.co.uk/c/terms-of-use/) restrict automated access, so collection may be blocked and authorised access or another feed may be needed for long-term operation. No Rightmove images are downloaded or embedded. Floor-plan badges link users to the listing rather than loading its assets.

Hourly checks run at minute 17. [GitHub's scheduler](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) may run late or miss runs, so detection can take about an hour plus scheduling and publication delays. This cannot guarantee being first. The browser reloads the JSON feed every five minutes while visible; its Refresh button reloads the feed rather than requesting another source check. Outbound email/push alerts have not been configured.

## Local use and publishing

```sh
python3 scripts/collect.py
python3 -m http.server 8000 --directory public
```

Open http://localhost:8000. There are no packages to install. A live collection needs network access.

The GitHub Pages source is GitHub Actions. `.github/workflows/update-and-deploy.yml` collects, commits the feed and state, and uploads only `public/`. A shared concurrency group serialises runs. Feed commits use `[skip ci]` to avoid recursion. An incomplete collector run still publishes preserved data and warnings, then marks the workflow failed so GitHub can notify the owner. Hourly status commits keep the repository active. Fonts and Leaflet load externally, with fallback fonts and property results available if those services fail.

## Additional sources and duplicate adverts

`scripts/sources.py` adds OpenRent, OnTheMarket and a Zoopla adapter slot. Rightmove, OpenRent and OnTheMarket public-page reads have been exercised successfully. Zoopla currently returns HTTP 403 / a browser-verification challenge for both its search and detail pages. No challenge bypass or disguised browser request is used. Zoopla is configured as an optional source: the website reports **blocked**, its last results would be retained, and other sources keep updating. A blocked optional source does not generate hourly failed-workflow emails. It is not reported as an empty or successful search. Zoopla's structured-page parser remains unverified against live accessible HTML and needs accessible authorised data before it can supply listings reliably; the developer portal discusses licensed listings access at https://developers.zoopla.co.uk/.

OpenRent provides search arrays with exact first-listed timestamps, monthly rents, live/let status, rooms/studios and non-student availability. Its distance parameter is kilometres: we fetch a 2 km circle around the station coordinates and apply the exact 1-mile and road-side screens locally. Pagination follows live adverts; inactive listings and room shares are excluded. Many OpenRent photos are unlabelled, so their floor plans cannot be confirmed automatically. Those homes remain under Needs checking unless a labelled plan is found or a matching advert on another source confirms the requirements.

OnTheMarket uses public Next.js search and property data, with full descriptions, floor-plan sections and reported coordinates. Its station distances are rounded, so map-based station geometry is used for precise station screening on sources without unrounded distances. Exact timestamps are often absent: only explicit Added today/yesterday or calendar dates become day-precision dates (marked approximately in the interface); broad Added < 7 days labels are not promoted into the 24-hour tier. Reduced dates never create new-listing dates. A redirect to a homepage is rejected rather than interpreted as zero results.

`scripts/deduplicate.py` groups matching adverts using explicit OpenRent references, addresses, flat/house numbers, close coordinates and strongly similar full descriptions. Different flat numbers are protected. Ambiguous adverts are not merged solely because they have the same rent or street. Every merged home keeps its source links and aliases, with a stable identity stored in `state/identities.json`. A screened advert can establish a merged home's eligibility while another advert lacks a labelled plan. The earliest known publication date is retained to prevent a new portal advert making an older home look new. The feed records how many duplicate adverts were merged and per-source health. Automatic deduplication cannot identify all hidden-address adverts with certainty; the method favours preserving distinct homes over collapsing a building's different flats.

CARTO basemap attribution is visible on the map alongside OpenStreetMap. If its tile service fails, the map falls back to ordinary OpenStreetMap tiles. Frontend assets remain plain static files, with no framework or build step.
