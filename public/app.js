'use strict';
const $ = id => document.getElementById(id);
const DAY = 86400000;
const money = new Intl.NumberFormat('en-GB', {style:'currency',currency:'GBP',maximumFractionDigits:0});
let feed = null, demo = false, view = 'all', map = null, layer = null, radiusCircle = null;
const markers = new Map();
let saved = new Set();
try { saved = new Set(JSON.parse(localStorage.getItem('tom-home-shortlist') || '[]')); } catch (_) {}
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const age = date => {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 60000));
  if (!Number.isFinite(minutes)) return 'Time unavailable';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
};
const listedAge = p => Number.isFinite(Date.parse(p.publishedAt)) ? Math.max(0, Date.now() - Date.parse(p.publishedAt)) : Infinity;
const newlyFound = p => listedAge(p) < DAY;
const freshness = p => listedAge(p) < DAY ? 0 : listedAge(p) < 3 * DAY ? 1 : 2;
const freshnessLabel = p => freshness(p) === 0 ? 'Listed <24h' : freshness(p) === 1 ? 'Listed <3 days' : listedAge(p) === Infinity ? 'Date unknown' : 'Older listing';
const compareFit = (a,b) => freshness(a)-freshness(b) || ((b.fitScore || 0) % 100)-((a.fitScore || 0) % 100) || (Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0) || (a.distanceMiles??Infinity)-(b.distanceMiles??Infinity);
const safeLink = value => {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'www.rightmove.co.uk' ? u.href : null; } catch (_) { return null; }
};
function exampleFeed() {
  const now = Date.now();
  const examples = [
    ['example-1','Example renovated flat in Camberwell',1800,1,1,'Flat',51.474,-0.094,2,'Newly refurbished throughout, with a bright living room and a separate kitchen.'],
    ['example-2','Example two-bedroom flat in Camberwell',2050,2,1,'Flat',51.473,-0.08,4,'Recently renovated, with two bedrooms and a comfortable living space.'],
    ['example-3','Example one-bedroom flat in East Dulwich',1750,1,1,'Flat',51.461,-0.076,9,'A one-bedroom home with a floor plan and room for your next chapter.'],
    ['example-4','Example freshly decorated flat',1850,1,1,'Flat',51.46,-0.095,48,'Freshly decorated, with a bright bedroom and separate reception room.'],
    ['example-5','Example two-bedroom apartment',2100,2,1,'Apartment',51.475,-0.1,130,'A two-bedroom apartment with a generous reception room.']
  ];
  return {status:'example',checkedAt:new Date(now).toISOString(),lastSuccessfulCheckAt:new Date(now).toISOString(),searchTitle:'Example Denmark Hill search',searchSummary:'Example homes only · prices, descriptions and locations are illustrative',radius:feed?.radius,warnings:[],pendingProperties:[],properties:examples.map(([id,address,price,bedrooms,bathrooms,type,lat,lng,hours,summary],i) => ({id,address,price,priceFrequency:'pcm',bedrooms,bathrooms,type,lat,lng,summary,publishedAt:new Date(now-hours*3600000).toISOString(),firstSeenAt:new Date(now-hours*3600000).toISOString(),baseline:false,hasFloorplan:true,refurbishment:i<2?'Newly refurbished':i===3?'Freshly decorated':null,fitScore:hours<24?350-i*10:hours<72?220:100,distanceMiles:[.44,.53,.76,.66,.75][i],verificationStatus:'screened',sourceNames:['Example'],url:'https://www.rightmove.co.uk/property-to-rent.html'}))};
}
function empty(title, description, button = '') {
  $('property-list').innerHTML = `<div class="empty-state"><div class="empty-illustration" aria-hidden="true">⌂</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(description)}</p>${button}</div>`;
}
function render() {
  if (!feed && !demo) return;
  const data = demo ? exampleFeed() : feed;
  const properties = [...(data.properties || [])].sort(compareFit);
  const pending = data.pendingProperties || [];
  const allProperties = [...properties,...pending];
  const recent = properties.filter(newlyFound);
  const waiting = data.status === 'awaiting_configuration';
  const bad = ['error','partial'].includes(data.status);
  const stale = data.status === 'ok' && (!data.lastSuccessfulCheckAt || Date.now() - Date.parse(data.lastSuccessfulCheckAt) > 2.5 * 3600000);
  $('status-label').textContent = demo ? 'Example preview' : waiting ? 'Draft · awaiting criteria' : bad ? 'Check needs attention' : stale ? 'Updates overdue' : 'Search active';
  $('status-pill').classList.toggle('live', !demo && !waiting && !bad && !stale);
  $('new-count').textContent = waiting ? '—' : recent.length;
  $('new-count-label').textContent = demo ? 'illustrative recent matches' : 'matching homes listed in 24h';
  $('total-count').textContent = `${properties.length} ${demo ? 'example' : 'screened'} ${properties.length === 1 ? 'match' : 'matches'}`;
  $('criteria-summary').textContent = data.searchSummary;
  $('checked-label').textContent = waiting ? 'Ready for your first search' : data.checkedAt ? `Last attempted ${age(data.checkedAt)}${bad && data.lastSuccessfulCheckAt ? ` · last complete check ${age(data.lastSuccessfulCheckAt)}` : ''}` : 'No check completed yet';
  const threeDays=properties.filter(p=>listedAge(p)<3*DAY);
  $('welcome-summary').textContent = demo ? 'An example of your ranked update. These homes are fictional; recent listings and refurbishment mentions come first.' : waiting ? 'Your search is awaiting configuration.' : bad || stale ? `The latest check ${stale ? 'is overdue' : 'is incomplete'}. These are the best available screened matches; new homes may be missing.` : recent.length ? `${recent.length} ${recent.length===1?'match was':'matches were'} listed in the last 24 hours. Your best fits are below, with a boost for refurbishment and budget.` : threeDays.length ? `Nothing suitable added in the last 24 hours—check in later. Here are your best matches from the last 3 days.` : properties.length ? 'Nothing suitable added in the last 3 days—check in later. Your best older matches are below.' : `No suitable screened homes right now. Check in later—we’ll keep looking.${pending.length ? ` ${pending.length} ${pending.length===1?'home needs':'homes need'} a location or description check.` : ''}`;
  const picks=properties.slice(0,3);
  $('ranked-summary').innerHTML=picks.map((p,i)=>`<li><span class="summary-rank">${i+1}.</span><div><a href="${escapeHTML(safeLink(p.url)||'#')}" target="_blank" rel="noopener noreferrer">${escapeHTML(p.address)}</a><span class="summary-reasons">${escapeHTML(money.format(p.price))} pcm · ${p.bedrooms} ${p.bedrooms===1?'bed':'beds'} · ${escapeHTML(freshnessLabel(p))} · ${p.distanceMiles?.toFixed(2)??'?'} mi${p.refurbishment?` · ${escapeHTML(p.refurbishment)}`:''}${p.bedrooms===1&&p.price<=1800?' · Within target':''}</span></div></li>`).join('');
  const notices = demo ? ['Preview mode: fictional examples to show the layout. Switch back to see your actual search.'] : [...(data.warnings || []), ...(stale ? ['Updates are overdue. The map and list show the last available results.'] : [])];
  $('notice').hidden = !notices.length;
  $('notice').textContent = notices.join(' ');
  $('demo-button').textContent = demo ? 'Back to your search ↩' : 'Preview with examples ↗';
  $('demo-button').setAttribute('aria-pressed', String(demo));
  $('saved-count').textContent = allProperties.filter(p => saved.has(p.id)).length;
  $('pending-count').textContent=pending.length;
  let visible = (view==='pending'?pending:view==='saved'?allProperties:properties).filter(p => view === 'recent' ? newlyFound(p) : view === 'three-days' ? listedAge(p)<3*DAY : view === 'saved' ? saved.has(p.id) : true);
  visible.sort((a,b) => $('sort').value === 'price-low' ? (a.price ?? Infinity)-(b.price ?? Infinity) : $('sort').value === 'price-high' ? (b.price ?? -Infinity)-(a.price ?? -Infinity) : $('sort').value==='newest' ? (Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0) : compareFit(a,b));
  $('sort-label').textContent = $('sort').selectedOptions[0].textContent;
  $('results-count').textContent = visible.length;
  if (!visible.length) {
    if (view === 'pending') empty('Everything shown is screened.', 'No homes are currently waiting for a description or location check.');
    else if (view === 'saved') empty('Keep the good ones close.', 'Tap the heart on a home to save it here. Your shortlist stays in this browser.');
    else if (waiting) empty('Let’s find your kind of home.', 'Your budget, your neighbourhoods, your non-negotiables. Once they’re set, your matches will land right here.');
    else if (bad || stale) empty('The search needs a moment.', 'The latest update is incomplete or overdue. New homes may be missing. Try again later.');
    else empty(view === 'recent' ? 'A quiet day on the radar.' : 'Nothing quite right yet.', 'No new suitable homes to show. Check in later—we’ll keep looking.', view === 'recent' && properties.length ? '<button class="outline-button" id="show-all">View all tracked homes →</button>' : '');
  } else {
    $('property-list').innerHTML = visible.map((p,i) => {
      const url = safeLink(p.url);
      const specs = [`${p.bedrooms ?? '?'} ${p.bedrooms===1?'bed':'beds'}`,p.bathrooms ? `${p.bathrooms} ${p.bathrooms === 1 ? 'bath' : 'baths'}` : '',p.type,Number.isFinite(p.distanceMiles)?`${p.distanceMiles.toFixed(2)} mi to Denmark Hill`:''].filter(Boolean).join(' · ');
      return `<article class="property-card" id="home-${escapeHTML(p.id)}"><div class="property-number">${String(i+1).padStart(2,'0')}</div><div><div class="card-top"><span class="property-price">${p.price != null ? escapeHTML(money.format(p.price)) : 'Price on request'}${p.priceFrequency && p.priceFrequency !== 'not specified' ? ` <small>${escapeHTML(p.priceFrequency)}</small>` : ''}</span><span class="property-time">${p.publishedAt ? `Listed ${age(p.publishedAt)}` : 'Date unknown'}</span></div><h3 class="property-address">${escapeHTML(p.address)}</h3><div class="property-specs">${escapeHTML(specs)}</div><p class="property-summary">${escapeHTML(p.summary)}</p>${p.verificationStatus==='unverified'?`<p class="verification-note">Needs checking: ${escapeHTML(p.verificationReason)}</p>`:''}<div class="fit-badges"><span class="fit-badge">${escapeHTML(freshnessLabel(p))}</span>${p.hasFloorplan?'<span class="fit-badge">Floor plan</span>':''}${p.refurbishment?`<span class="fit-badge refurb" title="${escapeHTML(p.refurbishmentEvidence||'Advertiser description')}">${escapeHTML(p.refurbishment)}</span>`:''}${p.bedrooms===1?`<span class="fit-badge">${p.price<=1800?'Within £1,800 target':`£${Math.round(p.price-1800)} above target`}</span>`:''}${p.verificationStatus==='screened'?'<span class="fit-badge">Street screened</span>':'<span class="fit-badge pending">Unverified location / description</span>'}</div><div class="card-actions">${url ? `<a class="listing-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${demo ? 'Explore Rightmove' : 'View on Rightmove'} ↗</a>` : ''}${Number.isFinite(p.lat) && Number.isFinite(p.lng) ? `<button class="locate-button" data-locate="${escapeHTML(p.id)}">Show on map ⌖</button>` : '<span class="muted small">Location unavailable</span>'}</div></div><button class="save-button ${saved.has(p.id) ? 'saved' : ''}" data-save="${escapeHTML(p.id)}" aria-label="${saved.has(p.id) ? 'Remove from' : 'Add to'} shortlist: ${escapeHTML(p.address)}" aria-pressed="${saved.has(p.id)}">${saved.has(p.id) ? '♥' : '♡'}</button></article>`;
    }).join('');
  }
  renderMap(visible,data.radius);
}
function renderMap(properties,centre) {
  if (!window.L) { $('map').innerHTML = '<div class="empty-state"><h3>Map unavailable.</h3><p>The map library couldn’t load. Your listings are still available.</p></div>'; return; }
  if (!map) {
    map = L.map('map',{scrollWheelZoom:false}).setView([51.505,-0.1],11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
    layer = L.featureGroup().addTo(map);
    if(centre){
      radiusCircle=L.circle([centre.lat,centre.lng],{radius:centre.miles*1609.344,color:'#21453d',weight:1.5,dashArray:'5 5',fillColor:'#21453d',fillOpacity:.04}).addTo(map);
      L.marker([centre.lat,centre.lng],{icon:L.divIcon({html:'<div class="station-marker">▤</div>',iconSize:[27,27],iconAnchor:[13,13]}),title:'Denmark Hill Station'}).bindPopup('Denmark Hill Station · 1-mile search radius').addTo(map);
    }
  }
  layer.clearLayers(); markers.clear();
  for (const p of properties) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const label = p.price != null ? money.format(p.price) : 'Home';
    const marker = L.marker([p.lat,p.lng],{icon:L.divIcon({html:`<div class="price-marker">${escapeHTML(label)}</div>`,iconSize:[64,31],iconAnchor:[32,15]}),title:p.address,keyboard:true}).addTo(layer);
    const popup = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = p.address; popup.append(title,document.createElement('br'));
    const url = safeLink(p.url);
    if (url) { const link = document.createElement('a'); link.href=url; link.target='_blank'; link.rel='noopener noreferrer'; link.textContent=demo ? 'Illustrative home · explore Rightmove ↗' : 'View on Rightmove ↗'; popup.append(link); }
    marker.bindPopup(popup).on('click',() => { document.querySelectorAll('.property-card.selected').forEach(el=>el.classList.remove('selected')); const card=$(`home-${p.id}`); if(card){card.classList.add('selected');card.scrollIntoView({behavior:'smooth',block:'nearest'});} });
    markers.set(p.id,marker);
  }
  fitMap();
}
function fitMap() { if(map && radiusCircle){const bounds=radiusCircle.getBounds();if(layer.getLayers().length)bounds.extend(layer.getBounds());map.fitBounds(bounds,{padding:[25,25],maxZoom:14});}else if(map && layer.getLayers().length) map.fitBounds(layer.getBounds(),{padding:[42,42],maxZoom:14});else if(map)map.setView([51.46829,-0.0895],13); }
async function load() {
  $('refresh-button').disabled = true;
  try { const response=await fetch(`data/listings.json?t=${Date.now()}`,{cache:'no-store'}); if(!response.ok) throw Error('Data unavailable'); const next=await response.json(); if(!Array.isArray(next.properties)) throw Error('Invalid feed'); feed=next; render(); }
  catch (_) { $('notice').hidden=false; $('notice').textContent='Couldn’t refresh the listing feed. Try again shortly.'; if(!feed){empty('The feed needs a moment.','Please refresh in a little while.');renderMap([]);} }
  finally { $('refresh-button').disabled=false; }
}
$('demo-button').addEventListener('click',() => {demo=!demo;render();});
$('refresh-button').addEventListener('click',load);
$('sort').addEventListener('change',render);
$('fit-map').addEventListener('click',fitMap);
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});render();}));
$('property-list').addEventListener('click',event=>{
  const save=event.target.closest('[data-save]');
  if(save){const id=save.dataset.save;if(saved.has(id))saved.delete(id);else saved.add(id);try{localStorage.setItem('tom-home-shortlist',JSON.stringify([...saved]));}catch(_){}render();}
  const locate=event.target.closest('[data-locate]');
  if(locate && map){const marker=markers.get(locate.dataset.locate);if(marker){map.setView(marker.getLatLng(),14);marker.openPopup();$('map').scrollIntoView({behavior:'smooth',block:'nearest'});}}
  if(event.target.closest('#show-all')) document.querySelector('[data-view="all"]').click();
});
load();
setInterval(()=>{if(!document.hidden)load();},5*60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
