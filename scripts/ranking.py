"""Explainable ranking: listed within 24h, then 72h, then older; preferences within each tier."""
import re
from datetime import datetime, timezone

REFURBISHMENT = [
    (r"\b(?:newly|recently|fully|completely|freshly)\s+(?:refurbished|renovated|refitted|modernised|modernized)\b", "Newly refurbished", 2),
    (r"\b(?:full|complete|extensive)\s+(?:refurbishment|renovation)\b", "Refurbishment mentioned", 2),
    (r"\b(?:undergone|underwent)\s+(?:a\s+)?(?:full\s+)?(?:refurbishment|renovation)\b", "Refurbishment mentioned", 2),
    (r"\b(?:newly|recently|freshly)\s+(?:decorated|redecorated|painted)\b", "Freshly decorated", 1),
    (r"\b(?:brand[ -]new|newly fitted)\s+(?:kitchen|bathroom|interior)\b", "New fittings mentioned", 1),
]


def listed_hours(prop, now=None):
    now=now or datetime.now(timezone.utc)
    try:
        date=datetime.fromisoformat(prop['publishedAt'].replace('Z','+00:00'))
        if date.tzinfo is None: return float('inf')
        return max(0,(now-date).total_seconds()/3600)
    except (ValueError,KeyError,TypeError):
        return float('inf')


def refurbishment(text):
    for pattern,label,strength in REFURBISHMENT:
        for match in re.finditer(pattern,text,re.I):
            context=text[max(0,match.start()-80):match.end()+60].casefold()
            if re.search(r"\b(?:not|requires?|needs?|in need of|potential|plans?|will be|to be|due to|scheduled)\b",context):
                continue
            return label,strength,match.group(0)
    return None,0,None


def rank(prop,settings,now=None):
    hours=listed_hours(prop,now)
    tier=0 if hours<24 else 1 if hours<72 else 2
    prop['freshnessTier']=tier
    prop['freshnessLabel']='Listed <24h' if tier==0 else 'Listed <3 days' if tier==1 else 'Older listing' if hours!=float('inf') else 'Listing date unknown'
    text=' '.join([prop.get('description',''),prop.get('summary',''),*prop.get('features',[])])
    label,strength,evidence=refurbishment(text)
    prop['refurbishment']=label
    prop['refurbishmentStrength']=strength
    prop['refurbishmentEvidence']=evidence
    price=prop.get('price') or 0
    target=settings.get('oneBedTarget',1800)
    within_target=prop.get('bedrooms')==1 and price<=target
    # The ranges cannot cross freshness tiers; refurbished homes receive first preference within a tier.
    ceiling=settings.get('oneBedMaximum',2000) if prop.get('bedrooms')==1 else settings.get('twoBedMaximum',2100)
    headroom=max(0,min(10,(ceiling-price)/50))
    preference=strength*20+(12 if within_target else 0)+headroom
    prop['fitScore']=round((300-tier*100)+preference,1)
    prop['fitReasons']=[prop['freshnessLabel'],f"{prop.get('distanceMiles',0):.2f} mi to Denmark Hill",'Floor plan']
    if label: prop['fitReasons'].insert(1,label)
    if within_target:prop['fitReasons'].append('Within £1,800 target')
    elif prop.get('bedrooms')==1:prop['fitReasons'].append(f"£{price-target:,.0f} above target")
    else:prop['fitReasons'].append(f"£{settings.get('twoBedMaximum',2100)-price:,.0f} below 2-bed ceiling")
    try:
        published=datetime.fromisoformat(prop['publishedAt'].replace('Z','+00:00')).timestamp()
    except (ValueError,KeyError,TypeError):
        published=0
    return (-prop['fitScore'],-published,prop.get('distanceMiles',float('inf')),prop['id'])
