'use strict';
const $ = id => document.getElementById(id);
const DAY = 86400000;
const money = new Intl.NumberFormat('en-GB', {style:'currency',currency:'GBP',maximumFractionDigits:0});
let feed = null, demo = false, view = 'recent', map = null, layer = null;
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
const newlyFound = p => !p.baseline && Date.now() - Date.parse(p.firstSeenAt) < DAY;
const safeLink = value => {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'www.rightmove.co.uk' ? u.href : null; } catch (_) { return null; }
};
function exampleFeed() {
  const now = Date.now();
  const examples = [
    ['example-1','A terraced home in Stoke Newington',725000,3,1,'Terraced',51.5615,-0.0778,0.4,'A bright living room, a little garden and space for a proper Sunday lunch.'],
    ['example-2','A Victorian terrace in Forest Hill',650000,3,2,'Terraced',51.4425,-0.0535,2.1,'Period details, a garden to make your own and the neighbourhood on your doorstep.'],
    ['example-3','A cottage in Walthamstow',575000,2,1,'Terraced',51.5817,-0.0186,5.6,'A quiet street, two bedrooms and room to put down roots.'],
    ['example-4','A family home in Tooting',795000,4,2,'Semi-detached',51.4311,-0.1607,19,'An extra bedroom for visitors and a sunny spot for your morning coffee.'],
    ['example-5','A house in Brockley',695000,3,1,'Terraced',51.4578,-0.0345,52,'A spacious home with a leafy outlook and room for your next chapter.']
  ];
  return {status:'example',checkedAt:new Date(now).toISOString(),lastSuccessfulCheckAt:new Date(now).toISOString(),searchTitle:'Example London search',searchSummary:'Example homes only · prices, descriptions and locations are illustrative',warnings:[],properties:examples.map(([id,address,price,bedrooms,bathrooms,type,lat,lng,hours,summary]) => ({id,address,price,bedrooms,bathrooms,type,lat,lng,summary,firstSeenAt:new Date(now-hours*3600000).toISOString(),baseline:false,sourceNames:['Example'],url:'https://www.rightmove.co.uk/property-for-sale.html'}))};
}
function empty(title, description, button = '') {
  $('property-list').innerHTML = `<div class="empty-state"><div class="empty-illustration" aria-hidden="true">⌂</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(description)}</p>${button}</div>`;
}
function render() {
  if (!feed && !demo) return;
  const data = demo ? exampleFeed() : feed;
  const properties = data.properties || [];
  const recent = properties.filter(newlyFound);
  const waiting = data.status === 'awaiting_configuration';
  const bad = ['error','partial'].includes(data.status);
  const stale = data.status === 'ok' && (!data.lastSuccessfulCheckAt || Date.now() - Date.parse(data.lastSuccessfulCheckAt) > 2.5 * 3600000);
  $('status-label').textContent = demo ? 'Example preview' : waiting ? 'Draft · awaiting criteria' : bad ? 'Check needs attention' : stale ? 'Updates overdue' : 'Search active';
  $('status-pill').classList.toggle('live', !demo && !waiting && !bad && !stale);
  $('new-count').textContent = waiting ? '—' : recent.length;
  $('new-count-label').textContent = demo ? 'illustrative new homes' : 'new homes on your radar';
  $('total-count').textContent = `${properties.length} ${demo ? 'example' : 'tracked'} ${properties.length === 1 ? 'home' : 'homes'}`;
  $('criteria-summary').textContent = data.searchSummary;
  $('checked-label').textContent = waiting ? 'Ready for your first search' : data.checkedAt ? `Last attempted ${age(data.checkedAt)}${bad && data.lastSuccessfulCheckAt ? ` · last complete check ${age(data.lastSuccessfulCheckAt)}` : ''}` : 'No check completed yet';
  $('welcome-summary').textContent = demo ? 'Here’s how your daily update will look: four illustrative homes found in the last 24 hours, with the most recent first. These aren’t real listings.' : waiting ? 'Your London home search, all in one place. Tell us what makes a home right for you, and we’ll take it from here.' : bad || stale ? `The latest check ${stale ? 'is overdue' : 'did not complete'}. ${recent.length ? `${recent.length} newly found ${recent.length === 1 ? 'home is' : 'homes are'} shown below.` : 'Previous results are still available.'} New listings may be missing until updates resume.` : recent.length ? `${recent.length === 1 ? 'One new home has' : `${recent.length} new homes have`} appeared on your radar in the last 24 hours. The newest ${recent.length === 1 ? 'is' : 'are'} first—take a look around.` : 'No new homes match your search in the last 24 hours. Check in later—we’ll keep an eye out.';
  const notices = demo ? ['Preview mode: fictional examples to show the layout. Switch back to see your actual search.'] : [...(data.warnings || []), ...(stale ? ['Updates are overdue. The map and list show the last available results.'] : [])];
  $('notice').hidden = !notices.length;
  $('notice').textContent = notices.join(' ');
  $('demo-button').textContent = demo ? 'Back to your search ↩' : 'Preview with examples ↗';
  $('demo-button').setAttribute('aria-pressed', String(demo));
  $('saved-count').textContent = properties.filter(p => saved.has(p.id)).length;
  let visible = properties.filter(p => view === 'recent' ? newlyFound(p) : view === 'saved' ? saved.has(p.id) : true);
  visible.sort((a,b) => $('sort').value === 'price-low' ? (a.price ?? Infinity)-(b.price ?? Infinity) : $('sort').value === 'price-high' ? (b.price ?? -Infinity)-(a.price ?? -Infinity) : Date.parse(b.firstSeenAt)-Date.parse(a.firstSeenAt));
  $('sort-label').textContent = $('sort').selectedOptions[0].textContent;
  $('results-count').textContent = visible.length;
  if (!visible.length) {
    if (view === 'saved') empty('Keep the good ones close.', 'Tap the heart on a home to save it here. Your shortlist stays in this browser.');
    else if (waiting) empty('Let’s find your kind of home.', 'Your budget, your neighbourhoods, your non-negotiables. Once they’re set, your matches will land right here.');
    else if (bad || stale) empty('The search needs a moment.', 'The latest update is incomplete or overdue. New homes may be missing. Try again later.');
    else empty(view === 'recent' ? 'A quiet day on the radar.' : 'Nothing quite right yet.', 'No new suitable homes to show. Check in later—we’ll keep looking.', view === 'recent' && properties.length ? '<button class="outline-button" id="show-all">View all tracked homes →</button>' : '');
  } else {
    $('property-list').innerHTML = visible.map((p,i) => {
      const url = safeLink(p.url);
      const specs = [`${p.bedrooms ?? '?'} beds`,p.bathrooms ? `${p.bathrooms} ${p.bathrooms === 1 ? 'bath' : 'baths'}` : '',p.type,p.tenure].filter(Boolean).join(' · ');
      return `<article class="property-card" id="home-${escapeHTML(p.id)}"><div class="property-number">${String(i+1).padStart(2,'0')}</div><div><div class="card-top"><span class="property-price">${p.price != null ? escapeHTML(money.format(p.price)) : 'Price on request'}${p.priceFrequency && p.priceFrequency !== 'not specified' ? ` <small>${escapeHTML(p.priceFrequency)}</small>` : ''}</span><span class="property-time">${p.baseline ? 'Initial match' : `Found ${age(p.firstSeenAt)}`}</span></div><h3 class="property-address">${escapeHTML(p.address)}</h3><div class="property-specs">${escapeHTML(specs)}</div><p class="property-summary">${escapeHTML(p.summary)}</p>${p.sourceNames?.length ? `<span class="card-tag">${escapeHTML(p.sourceNames.join(' / '))}</span>` : ''}<div class="card-actions">${url ? `<a class="listing-link" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${demo ? 'Explore Rightmove' : 'View on Rightmove'} ↗</a>` : ''}${Number.isFinite(p.lat) && Number.isFinite(p.lng) ? `<button class="locate-button" data-locate="${escapeHTML(p.id)}">Show on map ⌖</button>` : '<span class="muted small">Location unavailable</span>'}</div></div><button class="save-button ${saved.has(p.id) ? 'saved' : ''}" data-save="${escapeHTML(p.id)}" aria-label="${saved.has(p.id) ? 'Remove from' : 'Add to'} shortlist: ${escapeHTML(p.address)}" aria-pressed="${saved.has(p.id)}">${saved.has(p.id) ? '♥' : '♡'}</button></article>`;
    }).join('');
  }
  renderMap(visible);
}
function renderMap(properties) {
  if (!window.L) { $('map').innerHTML = '<div class="empty-state"><h3>Map unavailable.</h3><p>The map library couldn’t load. Your listings are still available.</p></div>'; return; }
  if (!map) {
    map = L.map('map',{scrollWheelZoom:false}).setView([51.505,-0.1],11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
    layer = L.featureGroup().addTo(map);
  }
  layer.clearLayers(); markers.clear();
  for (const p of properties) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const label = p.price != null ? (p.price >= 1000000 ? `£${(p.price/1000000).toFixed(2).replace(/0$/,'')}m` : `£${Math.round(p.price/1000)}k`) : 'Home';
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
function fitMap() { if(map && layer.getLayers().length) map.fitBounds(layer.getBounds(),{padding:[42,42],maxZoom:14}); else if(map) map.setView([51.505,-0.1],11); }
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
