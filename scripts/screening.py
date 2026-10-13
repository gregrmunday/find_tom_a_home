"""Apply the full-description, station and mapped-street requirements."""
import re

from geography import miles_between


EXCLUSIONS = {
    'excludeStudentAccommodation': r'\b(?:student(?:s)?[ -](?:accommodation|housing|hall|halls|only|property|properties|letting|let)|purpose[ -]built student|exclusively for students|students only)\b',
    'excludeShares': r'\b(?:house[ -]?share|flat[ -]?share|shared (?:house|flat|accommodation)|room (?:only|to (?:rent|let)|in a)|rent(?:ing)? (?:a |the )?(?:single|double|individual) room|shared (?:kitchen|bathroom))\b',
    'excludeRetirement': r'\b(?:retirement|sheltered (?:housing|accommodation)|over[ -]?(?:55|60|65)[\x27’]?s|(?:for|aged|age restricted)[^.!?]{0,15}over[ -]?(?:55|60|65)|aged (?:55|60|65) (?:and|or) over)\b',
}


def accommodation_allowed(prop, filters):
    text=' '.join([prop.get('type',''),prop.get('summary',''),prop.get('description',''),*prop.get('features',[])])
    for key,pattern in EXCLUSIONS.items():
        if filters.get(key):
            for match in re.finditer(pattern,text,re.I):
                prefix=text[max(0,match.start()-20):match.start()].casefold()
                if re.search(r'\b(?:not|no)\s+(?:a\s+|an\s+)?$',prefix):
                    continue
                return False
    return True


def apply_details(prop,details,clean):
    prop['description']=clean(details.get('description'))
    prop['features']=[clean(v) for v in details.get('features',[]) if isinstance(v,str)]
    prop['floorplanCount']=details['floorplanCount']
    prop['hasFloorplan']=details['floorplanCount']>0
    prop['nearestStations']=[{'name':clean(s.get('name')),'distanceMiles':float(s['distance']) if s.get('unit')=='miles' else float(s['distance'])/1.609344} for s in details.get('nearestStations',[]) if isinstance(s.get('distance'),(int,float)) and s.get('unit') in ['miles','km']]
    location=details.get('location',{})
    if isinstance(location.get('latitude'),(float,int)) and isinstance(location.get('longitude'),(float,int)):
        prop['lat'],prop['lng']=location['latitude'],location['longitude']
    prop['pinApproximate']=bool(location.get('circleRadiusOnMap')) or location.get('pinType') not in ['ACCURATE_POINT']
    prop['letType']=clean((details.get('lettings') or {}).get('letType'))
    return (details.get('status') or {}).get('published',True) and not (details.get('status') or {}).get('archived',False)


def geography_allowed(prop,config,rail_screen):
    centre=config.get('radius')
    if centre:
        if prop.get('lat') is None or prop.get('lng') is None:
            return 'unverified','Listing coordinates unavailable'
        distance=miles_between(centre['lat'],centre['lng'],prop['lat'],prop['lng'])
        # Prefer Rightmove's own unrounded station distance when available.
        station=next((s for s in prop.get('nearestStations',[]) if s['name'].casefold()==centre['name'].casefold()),None)
        if station:distance=station['distanceMiles']
        prop['distanceMiles']=distance
        prop['distanceSource']='Rightmove station distance' if station else 'Great-circle distance from Rightmove station centre'
        if distance>centre['miles']:
            return 'excluded','Outside the 1-mile radius'
        if prop.get('pinApproximate'):
            return 'unverified','Approximate map pin: radius and street need confirmation'
    settings=config.get('railway',{})
    if settings.get('enabled'):
        stations=prop.get('nearestStations',[])
        if not stations:
            return 'unverified','Rightmove station distances unavailable'
        nearest=min(stations,key=lambda s:s['distanceMiles'])
        prop['nearestStationName']=nearest['name']
        prop['nearestStationMiles']=nearest['distanceMiles']
        if nearest['distanceMiles']<=settings.get('stationMinimumMiles',.1):
            return 'excluded','Within 0.1 miles of a station'
        if rail_screen is None:
            return 'unverified','Railway/street map unavailable'
        return rail_screen.screen(prop)
    return 'screened','Location screened'
