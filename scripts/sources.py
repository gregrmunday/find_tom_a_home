"""Public-page adapters. Challenges and unexpected redirects are reported, never bypassed."""
import html
import json
import re
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse, parse_qs, urlencode, urlunparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

NAMES={'rightmove':'Rightmove','openrent':'OpenRent','onthemarket':'OnTheMarket'}
HOSTS={'rightmove':'www.rightmove.co.uk','openrent':'www.openrent.co.uk','onthemarket':'www.onthemarket.com'}


def text(value):
    return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]*>',' ',str(value or '')))).strip()


def download(url,source):
    if urlparse(url).scheme!='https' or urlparse(url).hostname!=HOSTS[source]:
        raise ValueError('Invalid source URL')
    request=Request(url,headers={'User-Agent':'FindTomAHome/1.0 (+https://gregrmunday.github.io/find_tom_a_home/)','Accept':'text/html'})
    with urlopen(request,timeout=25) as response:
        if urlparse(response.url).hostname!=HOSTS[source]:raise ValueError('Unexpected source redirect')
        data=response.read(8*1024*1024+1)
        if len(data)>8*1024*1024:raise ValueError('Source response too large')
        document=data.decode('utf-8')
        if 'window._cf_chl_opt' in document or '<title>Just a moment' in document:raise PermissionError('Source requires browser verification')
        return document


def next_data(document):
    match=re.search(r'<script[^>]*id=[\"\']__NEXT_DATA__[\"\'][^>]*>(.*?)</script>',document,re.S)
    if not match:raise ValueError('Search data missing')
    return json.loads(match[1])


def pcm(value):
    if isinstance(value,(int,float)):return float(value)
    match=re.search(r'£\s*([\d,]+(?:\.\d+)?)\s*(?:pcm|p/m|per month)',str(value),re.I)
    if match:return float(match[1].replace(',',''))
    match=re.search(r'£\s*([\d,]+(?:\.\d+)?)\s*(?:pw|p/w|per week)',str(value),re.I)
    return round(float(match[1].replace(',',''))*52/12,2) if match else None


def record(source,pid,address,price,beds,baths,kind,lat,lng,url):
    return {'id':f'{source}-{pid}','source':source,'sourceId':str(pid),'address':text(address),'price':price,'priceFrequency':'pcm','bedrooms':beds,'bathrooms':baths,'type':text(kind),'tenure':'','lat':lat,'lng':lng,'summary':'','description':'','features':[],'publishedAt':None,'url':url,'auction':False,'displayStatus':'','floorplanCount':None,'hasFloorplan':None,'sourceUpdatedAt':None,'pinApproximate':False}


def labelled_date(label):
    """Use day precision only for explicit added dates, never reduced dates or broad ranges."""
    label=text(label).lower()
    if not label.startswith('added'):return None
    now=datetime.now(ZoneInfo('Europe/London'))
    day=now.date() if 'today' in label else now.date()-timedelta(days=1) if 'yesterday' in label else None
    if day is None:
        match=re.search(r'added(?: on)?\s+(\d{1,2}[/-]\d{1,2}[/-]\d{4})',label)
        if match:
            day=datetime.strptime(match[1].replace('-','/'),'%d/%m/%Y').date()
    return datetime.combine(day,datetime.min.time(),tzinfo=ZoneInfo('Europe/London')).astimezone(timezone.utc).isoformat().replace('+00:00','Z') if day else None


class HTMLData(HTMLParser):
    def __init__(self,document):
        super().__init__();self.links=[];self.elements=[];self.blocks={};self.stack=[];self.active=[];self.feed(document)
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs);self.elements.append((tag,attrs))
        if tag=='a' and attrs.get('href'):self.links.append(attrs['href'])
        if tag in ['meta','input','link','img','br','hr','source']:return
        key=attrs.get('id')
        self.stack.append((tag,key))
        if key:self.blocks.setdefault(key,[]);self.active.append(key)
    def handle_endtag(self,tag):
        while self.stack:
            current,key=self.stack.pop()
            if key and key in self.active:self.active.remove(key)
            if current==tag:break
    def handle_data(self,data):
        for key in self.active:self.blocks[key].append(data)


def openrent_array(document,name):
    match=re.search(r'var\s+'+re.escape(name)+r'\s*=\s*\[(.*?)\]',document,re.S)
    if not match:raise ValueError(f'OpenRent {name} missing')
    return json.loads('['+re.sub(r',\s*$','',match[1].strip())+']')


def parse_openrent_search(document,url):
    ids=openrent_array(document,'PROPERTYIDS')
    arrays={name:openrent_array(document,name) for name in ['prices','bedrooms','bathrooms','islivelistBool','isshared','isstudio','nonStudents','PROPERTYLISTLATITUDES','PROPERTYLISTLONGITUDES','dateFirstListedMs']}
    if any(len(v)!=len(ids) for v in arrays.values()):raise ValueError('OpenRent search arrays disagree')
    links={str(re.search(r'/(\d+)(?:[/?#]|$)',link)[1]):urljoin(url,link) for link in HTMLData(document).links if '/property-to-rent/' in link and re.search(r'/(\d+)(?:[/?#]|$)',link)}
    properties=[]
    # Only emit the current page's cards. The arrays include other pages and inactive homes.
    for index,pid in enumerate(ids):
        if str(pid) not in links:continue
        if not arrays['islivelistBool'][index] or arrays['isshared'][index] or arrays['isstudio'][index] or not arrays['nonStudents'][index]:continue
        path=urlparse(links[str(pid)]).path.split('/')
        address=' '.join(path[-2].split('-')[3:]).title()
        p=record('openrent',pid,address,arrays['prices'][index],arrays['bedrooms'][index],arrays['bathrooms'][index],'Flat' if 'flat' in path[-2] else 'House',arrays['PROPERTYLISTLATITUDES'][index],arrays['PROPERTYLISTLONGITUDES'][index],links[str(pid)])
        p['publishedAt']=datetime.fromtimestamp(arrays['dateFirstListedMs'][index]/1000,timezone.utc).isoformat().replace('+00:00','Z')
        p['datePrecision']='timestamp';properties.append(p)
    parsed=urlparse(url);skip=int(parse_qs(parsed.query).get('skip',['0'])[0]);params=parse_qs(parsed.query);params['skip']=[str(skip+20)]
    live=arrays['islivelistBool']
    return {'properties':properties,'total':sum(bool(x) for x in live),'next':urlunparse(parsed._replace(query=urlencode(params,doseq=True))) if any(live[skip+20:]) else None,'coverageCount':sum(bool(x) for x in live[skip:skip+20])}


def parse_openrent_details(document,pid):
    data=HTMLData(document)
    description=text(' '.join(data.blocks.get('descriptionText',[])))
    if not description:raise ValueError('OpenRent full description missing')
    map_attrs=next((a for t,a in data.elements if a.get('id')=='map'),{})
    title=next((a.get('content') for t,a in data.elements if t=='meta' and a.get('property')=='og:title'),None)
    if not title:
        match=re.search(r'<h1[^>]*>(.*?)</h1>',document,re.S);title=text(match[1]) if match else ''
    plans=sum(1 for tag,attrs in data.elements if tag=='a' and re.search(r'floor[ -]?plan',attrs.get('data-pswp-caption','')+' '+attrs.get('href',''),re.I))
    canonical=next((a.get('href') for t,a in data.elements if t=='link' and a.get('rel')=='canonical'),None)
    if canonical and not canonical.rstrip('/').endswith('/'+str(pid)):raise ValueError('OpenRent property ID mismatch')
    return {'id':str(pid),'description':description,'features':[],'floorplanCount':plans or None,'nearestStations':[],'location':{'latitude':float(map_attrs['data-lat']),'longitude':float(map_attrs['data-lng']),'pinType':'SOURCE_POINT'},'address':re.sub(r'^\d+\s*Bed\s*(?:Flat|House)\s*,?\s*','',title or '',flags=re.I),'status':{'published':'Property Let' not in title if title else True},'agentName':'OpenRent','lettings':{},'propertyType':'','openrentReference':str(pid)}


def parse_otm_search(document,url):
    data=next_data(document)
    state=data['props']['pageProps']['initialReduxState']
    if not data.get('page','').startswith('/[searchType]') or state['query'].get('searchType')!='to-rent':raise ValueError('OnTheMarket returned a different page')
    results=state['results'];properties=[]
    for raw in results['list']:
        if not raw.get('id') or not raw.get('details-url'):continue
        location=raw.get('location') or {}
        p=record('onthemarket',raw['id'],raw.get('address'),pcm(raw.get('price')),raw.get('bedrooms'),raw.get('bathrooms'),raw.get('humanised-property-type'),location.get('lat'),location.get('lon'),urljoin(url,raw['details-url']))
        p.update({'features':raw.get('features') or [],'agentName':(raw.get('agent') or {}).get('name',''),'publishedAt':labelled_date(raw.get('days-since-added-reduced')),'datePrecision':'day','sourceDateLabel':raw.get('days-since-added-reduced')})
        properties.append(p)
    nxt=(results.get('paginationControls',{}).get('next') or {}).get('next-link')
    return {'properties':properties,'total':results.get('totalResults'),'next':urljoin(url,nxt) if nxt else None,'coverageCount':len({p['id'] for p in properties})}


def parse_otm_details(document,pid):
    data=next_data(document)['props']['pageProps']['initialReduxState']['property']
    if str(data.get('id'))!=str(pid) or not data.get('toRent'):raise ValueError('OnTheMarket rental details mismatch')
    location=data.get('location') or {};stations=[]
    for station in data.get('station') or []:
        distance=re.search(r'([\d.]+)\s*mi',station.get('displayDistance',''))
        if distance:stations.append({'name':station.get('fullName') or station.get('name'),'distance':float(distance[1]),'unit':'miles','rounded':True})
    ref=(data.get('agent') or {}).get('propertyReference')
    agent=(data.get('agent') or {}).get('name','')
    return {'id':str(pid),'description':data.get('description',''),'features':[f['feature'] for f in data.get('features') or [] if f.get('feature')],'floorplanCount':len(data.get('floorplans') or [])+len(data.get('externalFloorplans') or []),'nearestStations':stations,'location':{'latitude':location.get('lat'),'longitude':location.get('lon'),'pinType':'SOURCE_POINT'},'status':{'published':not data.get('retracted')},'address':data.get('displayAddress'),'agentName':agent,'lettings':{},'propertyType':data.get('humanisedPropertyType'),'openrentReference':str(ref) if ref and 'openrent' in agent.lower() and str(ref).isdigit() else None}


def search_page(source,url):
    return {'openrent':parse_openrent_search,'onthemarket':parse_otm_search}[source](download(url,source),url)


def listing_details(source,pid,url):
    document=download(url,source)
    if source=='openrent':return parse_openrent_details(document,pid)
    if source=='onthemarket':return parse_otm_details(document,pid)
    raise ValueError('Unsupported listing source')
