"""Read the description and station distances from a public property page."""
import json
import re
from urllib.request import Request, urlopen

USER_AGENT = "FindTomAHome/1.0 (+https://gregrmunday.github.io/find_tom_a_home/)"


def parse_details(document):
    match = re.search(r"window\.__PAGE_MODEL\s*=\s*", document)
    if match:
        model = json.JSONDecoder().raw_decode(document[match.end():].lstrip())[0]
        if isinstance(model.get("data"), str):
            table = json.loads(model["data"])
            memo = {}

            def hydrate(index):
                if index < 0:
                    return None
                if index in memo:
                    return memo[index]
                value = table[index]
                if isinstance(value, dict):
                    result = {}
                    memo[index] = result
                    result.update({key: hydrate(ref) for key, ref in value.items()})
                    return result
                if isinstance(value, list):
                    result = []
                    memo[index] = result
                    result.extend(hydrate(ref) for ref in value)
                    return result
                return value

            property_data = hydrate(table[0]["propertyData"])
        else:
            property_data = model.get("propertyData", model.get("data", {}).get("propertyData"))
    else:
        match = re.search(r'<script[^>]*id=[\"\']__NEXT_DATA__[\"\'][^>]*>(.*?)</script>', document, re.S)
        if not match:
            raise ValueError("Property details missing")
        page = json.loads(match[1])["props"]["pageProps"]
        property_data = page.get("propertyData", (page.get("data") or {}).get("propertyData"))
    if not isinstance(property_data, dict) or not property_data.get("id") or "nearestStations" not in property_data:
        raise ValueError("Unexpected property details format")
    data = property_data
    return {
        "id": str(data["id"]), "description": (data.get("text") or {}).get("description", ""),
        "features": data.get("keyFeatures", []), "floorplanCount": len(data.get("floorplans") or []),
        "nearestStations": data.get("nearestStations") or [], "location": data.get("location") or {},
        "tags": data.get("tags") or [], "lettings": data.get("lettings") or {},
        "status": data.get("status") or {}, "propertyType": data.get("propertySubType", ""),
    }


def fetch_details(property_id):
    if not str(property_id).isdigit():
        raise ValueError("Invalid property ID")
    request = Request(f"https://www.rightmove.co.uk/properties/{property_id}", headers={"User-Agent": USER_AGENT, "Accept":"text/html"})
    with urlopen(request, timeout=35) as response:
        content = response.read(8 * 1024 * 1024 + 1)
        if len(content) > 8 * 1024 * 1024:
            raise ValueError("Property page exceeds size limit")
        details = parse_details(content.decode("utf-8"))
        if details["id"] != str(property_id):
            raise ValueError("Property page ID mismatch")
        return details
