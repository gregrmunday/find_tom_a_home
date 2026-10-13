"""Local, cached OSM street/rail checks. Distances are geometry screens, not noise guarantees."""
import math
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.request import Request, urlopen

MILE = 1609.344
EARTH_RADIUS = 6371008.8


def miles_between(lat1, lng1, lat2, lng2):
    a, b = math.radians(lat1), math.radians(lat2)
    delta_lat, delta_lng = b-a, math.radians(lng2-lng1)
    h = math.sin(delta_lat/2)**2 + math.cos(a)*math.cos(b)*math.sin(delta_lng/2)**2
    return EARTH_RADIUS * 2 * math.atan2(math.sqrt(h), math.sqrt(max(0, 1-h))) / MILE


def parse_osm(documents):
    nodes, ways, stations = {}, {}, {}
    for document in documents:
        root = ET.fromstring(document)
        if root.tag != "osm":
            raise ValueError("Invalid OpenStreetMap extract")
        for node in root.findall("node"):
            nodes[node.attrib["id"]] = (float(node.attrib["lat"]), float(node.attrib["lon"]))
            tags={tag.attrib['k']:tag.attrib['v'] for tag in node.findall('tag')}
            if tags.get('railway') in ['station','halt'] and tags.get('name'):
                stations[node.attrib['id']]={'name':tags['name'],'lat':float(node.attrib['lat']),'lng':float(node.attrib['lon'])}
        for way in root.findall("way"):
            tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
            if tags.get("railway") in ("rail", "light_rail", "subway") or (tags.get("highway") and tags.get("name")):
                ways[way.attrib["id"]] = (tags, [n.attrib["ref"] for n in way.findall("nd")])
    rails, streets = [], []
    for tags, refs in ways.values():
        if any(ref not in nodes for ref in refs):
            raise ValueError("OpenStreetMap way is missing coordinates")
        points = [nodes[ref] for ref in refs]
        if tags.get("railway") in ("rail", "light_rail", "subway"):
            rails.append(points)
        elif tags.get("highway") not in ("footway", "path", "cycleway", "steps", "bridleway"):
            streets.append({"name": tags["name"], "points": points})
    if not rails or not streets:
        raise ValueError("Extract is missing rails or streets")
    return {"rails": rails, "streets": streets, "stations":list(stations.values())}


def download_map(bbox):
    west, south, east, north = bbox
    mid_lng, mid_lat = (west+east)/2, (south+north)/2
    documents = []
    for w, s, e, n in [(west,south,mid_lng,mid_lat),(mid_lng,south,east,mid_lat),(west,mid_lat,mid_lng,north),(mid_lng,mid_lat,east,north)]:
        url = f"https://api.openstreetmap.org/api/0.6/map?bbox={w},{s},{e},{n}"
        req = Request(url,headers={"User-Agent":"FindTomAHome/1.0 (+https://gregrmunday.github.io/find_tom_a_home/)"})
        with urlopen(req,timeout=35) as response:
            document = response.read(24*1024*1024+1)
            if len(document)>24*1024*1024:
                raise ValueError("Map extract exceeds size limit")
            documents.append(document)
        time.sleep(1)
    data = parse_osm(documents)
    data.update({"checkedAt":datetime.now(timezone.utc).isoformat(),"bbox":bbox,"source":"OpenStreetMap contributors; ODbL 1.0","sourceUrl":"https://www.openstreetmap.org/copyright"})
    return data


def street_key(name):
    return re.sub(r"[^a-z0-9]+", " ", name.casefold()).strip()


def point_segment_distance(point, a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]
    length_sq = dx*dx+dy*dy
    ratio = max(0,min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length_sq)) if length_sq else 0
    return math.hypot(point[0]-a[0]-ratio*dx,point[1]-a[1]-ratio*dy)


class RailScreen:
    def __init__(self, data, centre, settings):
        self.centre, self.settings = centre, settings
        self.stations = data.get('stations',[])
        self.x_scale = math.cos(math.radians(centre["lat"])) * math.pi*EARTH_RADIUS/180
        self.y_scale = math.pi*EARTH_RADIUS/180
        self.rails = []
        self.grid = {}
        self.streets = {}
        self.blocked = {}
        for line in data["rails"]:
            points = [self.project(*p) for p in line]
            for a,b in zip(points,points[1:]):
                index = len(self.rails)
                self.rails.append((a,b))
                for x in range(math.floor(min(a[0],b[0])/100),math.floor(max(a[0],b[0])/100)+1):
                    for y in range(math.floor(min(a[1],b[1])/100),math.floor(max(a[1],b[1])/100)+1):
                        self.grid.setdefault((x,y),set()).add(index)
        for road in data["streets"]:
            key = street_key(road["name"])
            self.streets.setdefault(key,{"name":road["name"],"segments":[]})
            pts = [self.project(*p) for p in road["points"]]
            self.streets[key]["segments"].extend(zip(pts,pts[1:]))
        buffer = settings.get("trackBufferMetres",50)
        for key,road in self.streets.items():
            alongside = 0
            for a,b in road["segments"]:
                dx,dy = b[0]-a[0],b[1]-a[1]
                length = math.hypot(dx,dy)
                if not length:
                    continue
                samples = max(1,math.ceil(length/20))
                for i in range(samples):
                    t=(i+.5)/samples
                    p=(a[0]+t*dx,a[1]+t*dy)
                    if math.hypot(*p)>centre["miles"]*MILE+150:
                        continue
                    for index in self.nearby(p,buffer):
                        ra,rb=self.rails[index]
                        rx,ry=rb[0]-ra[0],rb[1]-ra[1]
                        rlen=math.hypot(rx,ry)
                        parallel=abs(dx*rx+dy*ry)/(length*rlen) if rlen else 0
                        if parallel>=.8 and point_segment_distance(p,ra,rb)<=buffer:
                            alongside+=length/samples
                            break
            if alongside>=settings.get("minimumParallelLengthMetres",50):
                self.blocked[key]=road["name"]

    def project(self,lat,lng):
        return ((lng-self.centre["lng"])*self.x_scale,(lat-self.centre["lat"])*self.y_scale)

    def nearby(self,point,radius):
        indices=set()
        for x in range(math.floor((point[0]-radius)/100),math.floor((point[0]+radius)/100)+1):
            for y in range(math.floor((point[1]-radius)/100),math.floor((point[1]+radius)/100)+1):
                indices.update(self.grid.get((x,y),()))
        return indices

    def screen(self,prop):
        point=self.project(prop["lat"],prop["lng"])
        nearest=min((point_segment_distance(point,*segment) for segment in self.rails),default=None)
        prop["nearestTrackMetres"]=round(nearest) if nearest is not None else None
        # Also reject a pin beside the tracks even if the advertised street is misleading.
        if nearest is not None and nearest<=self.settings.get("trackBufferMetres",50):
            return "excluded","Listing pin is within 50 m of a railway track"
        address=f" {street_key(prop['address'])} "
        keys=[k for k in self.streets if f" {k} " in address]
        if not keys:
            return "unverified","Advertised address does not identify a mapped street"
        key=max(keys,key=len)
        street=self.streets[key]
        if min(point_segment_distance(point,*segment) for segment in street["segments"])>250:
            return "unverified","Listing pin and advertised street disagree"
        prop["streetName"]=street["name"]
        if self.settings.get("mode","street")=="street" and key in self.blocked:
            return "excluded",f"{street['name']} runs alongside railway tracks"
        if prop.get("pinApproximate"):
            return "unverified","Approximate listing pin needs a street/rail check"
        return "screened","Street screened against mapped railway tracks"


class SouthBoundary:
    def __init__(self,data,settings):
        names={settings['streetName'],*settings.get('extensions',[])}
        self.segments=[];self.settings=settings
        for street in data['streets']:
            if street['name'] in names:
                self.segments.extend(zip(street['points'],street['points'][1:]))
        if not self.segments:raise ValueError('Road boundary geometry missing')
    def check(self,prop):
        lat,lng=prop.get('lat'),prop.get('lng')
        if lat is None or lng is None:return 'unverified','Road-side location unavailable'
        intersections=[]
        for a,b in self.segments:
            if min(a[1],b[1])<=lng<=max(a[1],b[1]) and a[1]!=b[1]:
                intersections.append(a[0]+(lng-a[1])/(b[1]-a[1])*(b[0]-a[0]))
        if not intersections:return 'unverified','Road boundary does not cover the listing longitude'
        # Split carriageways are represented by the mean road centreline at this longitude.
        boundary=sum(intersections)/len(intersections)
        clearance=(boundary-lat)*math.pi*EARTH_RADIUS/180
        prop['southOfRoadMetres']=round(clearance)
        margin=self.settings.get('uncertaintyMetres',15)
        if clearance < -margin:return 'excluded','North of Peckham Road and its continuation'
        if clearance<=margin:return 'unverified','Listing pin is too close to the road boundary'
        return 'screened','South of Peckham Road'
