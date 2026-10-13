"""Group confidently matching adverts, retaining every source link and a stable home ID."""
import re
from copy import deepcopy
from difflib import SequenceMatcher
from datetime import datetime

from geography import miles_between, MILE
from ranking import rank
from sources import NAMES


def words(value):
    return re.sub(r'[^a-z0-9]+',' ',str(value or '').casefold()).strip()


def unit(address):
    match=re.search(r'\b(?:flat|apartment|apt|unit)\s+([0-9]+[a-z]?|[a-z])\b',address,re.I)
    return match[1].lower() if match else None


def duplicate(a,b):
    if a['id']==b['id']:return True
    if a.get('bedrooms')!=b.get('bedrooms'):return False
    ua,ub=unit(a['address']),unit(b['address'])
    if ua and ub and ua!=ub:return False
    # OpenRent adverts commonly carry the same explicit reference on the agent portals.
    def ref(p):return p.get('openrentReference') or (p.get('sourceId') if p.get('source')=='openrent' else None)
    if ref(a) and ref(a)==ref(b):return True
    if a.get('price') is None or b.get('price') is None or abs(a['price']-b['price'])>25:return False
    if not all(isinstance(p.get(k),(float,int)) for p in [a,b] for k in ['lat','lng']):return False
    metres=miles_between(a['lat'],a['lng'],b['lat'],b['lng'])*MILE
    if metres>50:return False
    house=lambda p:re.match(r'^(?:flat\s+\w+\s*[, ]+)?(\d+[a-z]?)\s',p['address'],re.I)
    ha,hb=house(a),house(b)
    if ha and hb and ha[1].lower()!=hb[1].lower():return False
    pa,pb=a.get('postcode'),b.get('postcode')
    if pa and pb and words(pa)!=words(pb):return False
    street_a=words(a.get('streetName') or a['address']);street_b=words(b.get('streetName') or b['address'])
    if street_a!=street_b and words(a['address'])!=words(b['address']):return False
    da,db=words(a.get('description')),words(b.get('description'))
    similarity=SequenceMatcher(None,da,db,autojunk=False).ratio() if len(da)>70 and len(db)>70 else 0
    if ua and ub and ha and hb and ha[1]==hb[1] and metres<30:return True
    return similarity>=.86 and metres<=25


def merge_homes(records,identities,settings):
    parents=list(range(len(records)))
    def root(i):
        while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
        return i
    for i,a in enumerate(records):
        for j in range(i):
            if identities.get(a['id']) and identities.get(a['id'])==identities.get(records[j]['id']) or duplicate(a,records[j]):parents[root(i)]=root(j)
    groups={}
    for i,p in enumerate(records):groups.setdefault(root(i),[]).append(p)
    homes=[]
    for group in groups.values():
        # Preserve Rightmove shortlist IDs when known; otherwise use an existing group's identity.
        preferred=sorted(group,key=lambda p:(p.get('verificationStatus')!='screened',p.get('source')!='rightmove',-len(p.get('description','')),p['id']))
        home=deepcopy(preferred[0]);aliases=sorted({p['id'] for p in group})
        existing=[identities[pid] for pid in aliases if pid in identities]
        home['id']=next((pid for pid in existing if pid.isdigit()),existing[0] if existing else next((p['id'] for p in group if p.get('source')=='rightmove'),home['id']))
        home['aliasIds']=aliases
        for pid in aliases:identities[pid]=home['id']
        home['sourceLinks']=[{'source':p.get('source','rightmove'),'name':NAMES[p.get('source','rightmove')],'id':p.get('sourceId',p['id']),'url':p['url'],'publishedAt':p.get('publishedAt')} for p in sorted(group,key=lambda p:(p.get('source')!='rightmove',p['id']))]
        home['sourceNames']=sorted({link['name'] for link in home['sourceLinks']})
        dates=[]
        for p in group:
            try:dates.append((datetime.fromisoformat((p.get('publishedAt') or '').replace('Z','+00:00')).timestamp(),p))
            except (ValueError,TypeError):pass
        if dates:
            earliest=min(dates,key=lambda pair:pair[0])[1]
            home['publishedAt']=earliest['publishedAt'];home['datePrecision']=earliest.get('datePrecision','timestamp')
        home['firstSeenAt']=min(p['firstSeenAt'] for p in group)
        best_refurb=max(group,key=lambda p:p.get('refurbishmentStrength',0))
        if best_refurb.get('refurbishmentStrength',0)>home.get('refurbishmentStrength',0):
            home['description']=best_refurb['description'];home['refurbishmentSource']=best_refurb.get('source')
        rank(home,settings);homes.append(home)
    homes.sort(key=lambda p:rank(p,settings))
    return homes,len(records)-len(homes)
