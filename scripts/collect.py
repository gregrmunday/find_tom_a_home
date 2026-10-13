#!/usr/bin/env python3
"""Small, dependency-free property collector. No login, proxies or challenge bypass."""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import os
from pathlib import Path
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
USER_AGENT = "FindTomAHome/1.0 (+https://gregrmunday.github.io/find_tom_a_home/)"


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    os.replace(temp, path)


def clean(value):
    return html.unescape(re.sub(r"<[^>]+>", "", str(value or ""))).strip()


def parse_page(document):
    match = re.search(r'<script\b[^>]*\bid=[\"\']__NEXT_DATA__[\"\'][^>]*>(.*?)</script>', document, re.S)
    if not match:
        raise ValueError("Listing data missing; the source may have changed or blocked access")
    data = json.loads(match.group(1))["props"]["pageProps"]["searchResults"]
    if not isinstance(data.get("properties"), list) or "resultCount" not in data:
        raise ValueError("Unexpected search response; existing results have been preserved")
    return data


def search_url(url, index=0):
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "www.rightmove.co.uk" or parsed.path not in ("/property-for-sale/find.html", "/property-to-rent/find.html"):
        raise ValueError("Use an HTTPS Rightmove sale or rental search results URL")
    params = parse_qs(parsed.query, keep_blank_values=True)
    params.update({"sortType": ["6"], "index": [str(index)]})
    return urlunparse(parsed._replace(query=urlencode(params, doseq=True), fragment=""))


def fetch(url):
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    with urlopen(request, timeout=35) as response:
        if urlparse(response.url).hostname != "www.rightmove.co.uk":
            raise ValueError("Unexpected source redirect")
        payload = response.read(8 * 1024 * 1024 + 1)
        if len(payload) > 8 * 1024 * 1024:
            raise ValueError("Source response exceeds size limit")
        return parse_page(payload.decode("utf-8"))


def normalise(raw):
    property_id = str(raw["id"])
    if not property_id.isdigit():
        raise ValueError("Invalid property ID")
    location, price = raw.get("location") or {}, raw.get("price") or {}
    lat, lng = location.get("latitude"), location.get("longitude")
    if not all(isinstance(v, (float, int)) and math.isfinite(v) for v in (lat, lng)) or not (-90 <= lat <= 90 and -180 <= lng <= 180) or raw.get("showOnMap") is False:
        lat = lng = None
    features = [clean(f.get("description")) for f in raw.get("keyFeatures", [])]
    tenure = (raw.get("tenure") or {}).get("tenureType", "")
    return {
        "id": property_id, "address": clean(raw.get("displayAddress")),
        "price": price.get("amount"), "priceFrequency": price.get("frequency"),
        "bedrooms": raw.get("bedrooms"), "bathrooms": raw.get("bathrooms"),
        "type": clean(raw.get("propertySubType")), "tenure": clean(tenure).replace("_", " ").title(),
        "lat": lat, "lng": lng, "summary": clean(raw.get("summary")), "features": features,
        "publishedAt": raw.get("firstVisibleDate"),
        "url": f"https://www.rightmove.co.uk/properties/{property_id}",
        "auction": bool(raw.get("auction")), "displayStatus": clean(raw.get("displayStatus")),
    }


def matches(p, filters):
    for field, lower, upper in [("price", "minPrice", "maxPrice"), ("bedrooms", "minBedrooms", "maxBedrooms")]:
        value = p.get(field)
        if filters.get(lower) is not None and (value is None or value < filters[lower]):
            return False
        if filters.get(upper) is not None and (value is None or value > filters[upper]):
            return False
    types = [v.casefold() for v in filters.get("propertyTypes", [])]
    if types and p["type"].casefold() not in types:
        return False
    text = " ".join([p["address"], p["summary"], *p["features"], p["tenure"]]).casefold()
    if any(v.casefold() in text for v in filters.get("excludeKeywords", [])):
        return False
    if any(v.casefold() not in text for v in filters.get("includeAllKeywords", [])):
        return False
    include = filters.get("includeAnyKeywords", [])
    if include and not any(v.casefold() in text for v in include):
        return False
    if filters.get("excludeAuction") and (p["auction"] or "auction" in text):
        return False
    if filters.get("excludeSharedOwnership") and ("shared ownership" in text or "sharedownership" in text or "shared-ownership" in text):
        return False
    if filters.get("excludeUnderOffer") and p["displayStatus"]:
        return False
    bounds = filters.get("bounds")
    if bounds and (p["lat"] is None or not (bounds[0] <= p["lat"] <= bounds[2] and bounds[1] <= p["lng"] <= bounds[3])):
        return False
    return True


def collect(config, state, previous, loader=fetch):
    now = stamp()
    output = {
        "schemaVersion": 1, "status": "awaiting_configuration", "checkedAt": now,
        "lastSuccessfulCheckAt": previous.get("lastSuccessfulCheckAt"),
        "intervalMinutes": config.get("intervalMinutes", 60),
        "searchTitle": config.get("title", "Your London search"),
        "searchSummary": config.get("summary", ""), "searches": [], "warnings": [], "properties": [],
    }
    if not config.get("enabled") or not config.get("searches"):
        return output, state, False
    state.setdefault("properties", {})
    state.setdefault("searches", {})
    ids = [s["id"] for s in config["searches"]]
    if len(ids) != len(set(ids)):
        raise ValueError("Each saved search needs a unique ID")
    failed = 0
    filters = config.get("filters", {})
    for search in config["searches"]:
        sid, name = search["id"], search["name"]
        signature = hashlib.sha256(json.dumps([search["url"], filters, search.get("filters", {})], sort_keys=True).encode()).hexdigest()
        old_search = state["searches"].get(sid, {})
        baseline = old_search.get("signature") != signature
        report = {"id": sid, "name": name, "status": "ok", "checkedAt": now, "url": search["url"]}
        found = {}
        try:
            index, visited = 0, set()
            max_pages = max(1, min(42, int(config.get("maxPagesPerSearch", 8))))
            complete = False
            for page in range(max_pages):
                if index in visited:
                    raise ValueError("Unexpected pagination loop")
                visited.add(index)
                data = loader(search_url(search["url"], index))
                for raw in data["properties"]:
                    p = normalise(raw)
                    if matches(p, {**filters, **search.get("filters", {})}):
                        found[p["id"]] = p
                nxt = (data.get("pagination") or {}).get("next")
                if nxt is None or nxt == "" or int(nxt) <= index:
                    complete = True
                    break
                index = int(nxt)
                if page + 1 < max_pages:
                    time.sleep(2)
            if not complete:
                report["status"] = "partial"
                output["warnings"].append(f"{name}: page limit reached; results may be incomplete. Narrow the search or raise the page limit.")
                failed += 1
            # Only a complete search can remove membership from old matches.
            if complete:
                for existing in state["properties"].values():
                    existing.get("sourceIds", {}).pop(sid, None)
            for pid, p in found.items():
                old = state["properties"].get(pid)
                p["firstSeenAt"] = old["firstSeenAt"] if old else now
                p["baseline"] = old.get("baseline", False) if old else baseline
                p["lastSeenAt"] = now
                p["sourceIds"] = dict(old.get("sourceIds", {})) if old else {}
                p["sourceIds"][sid] = name
                state["properties"][pid] = p
            if complete:
                state["searches"][sid] = {"signature": signature, "lastSuccessfulCheckAt": now}
            report["matched"] = len(found)
        except Exception as error:
            failed += 1
            report["status"] = "error"
            # Do not expose URLs, credentials or response bodies in the public feed.
            output["warnings"].append(f"{name}: check failed ({type(error).__name__}). Previous results are preserved; new homes may be missing.")
            print(f"Search {sid}: {type(error).__name__}: {error}", file=sys.stderr)
        output["searches"].append(report)
    output["status"] = "ok" if failed == 0 else "error" if all(s["status"] == "error" for s in output["searches"]) else "partial"
    if failed == 0:
        output["lastSuccessfulCheckAt"] = now
    cutoff = (datetime.now(timezone.utc) - timedelta(days=config.get("retentionDays", 90))).isoformat(timespec="seconds").replace("+00:00", "Z")
    state["properties"] = {pid: p for pid, p in state["properties"].items() if p["lastSeenAt"] >= cutoff}
    for p in state["properties"].values():
        sources = {sid: name for sid, name in p.get("sourceIds", {}).items() if sid in ids}
        if sources:
            output["properties"].append({**{k: v for k, v in p.items() if k != "sourceIds"}, "sourceNames": list(sources.values())})
    output["properties"].sort(key=lambda p: p["firstSeenAt"], reverse=True)
    return output, state, bool(failed)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "config/searches.json")
    args = parser.parse_args()
    state_path, feed_path = ROOT / "state/seen.json", ROOT / "public/data/listings.json"
    output, state, failed = collect(read_json(args.config), read_json(state_path, {"schemaVersion": 1, "properties": {}, "searches": {}}), read_json(feed_path, {}))
    write_json(state_path, state)
    write_json(feed_path, output)
    print(f"Status: {output['status']}; {len(output['properties'])} homes; {len(output['warnings'])} warnings")
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
