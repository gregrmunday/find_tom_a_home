'use strict';
const $=id=>document.getElementById(id), DAY=86400000;
const money=new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0});
const names={rightmove:'Rightmove',openrent:'OpenRent',onthemarket:'OnTheMarket'};
const short={rightmove:'RM',openrent:'OpenRent',onthemarket:'OTM'};
const hosts=new Set(['www.rightmove.co.uk','www.openrent.co.uk','www.onthemarket.com']);
let feed=null,view='all',map=null,layer=null,circle=null,current=[],selected=null,busy=false;
const markers=new Map();let saved=new Set();
try{const data=JSON.parse(localStorage.getItem('tom-home-shortlist')||'[]');if(Array.isArray(data))saved=new Set(data);}catch(_){}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&hosts.has(u.hostname)&&!u.username&&!u.password?u.href:null;}catch(_){return null;}};
const age=date=>{const mins=Math.max(0,Math.floor((Date.now()-Date.parse(date))/60000));return !Number.isFinite(mins)?'?':mins<60?`${mins}m`:mins<1440?`${Math.floor(mins/60)}h`:`${Math.floor(mins/1440)}d`;};
const listedAge=p=>Number.isFinite(Date.parse(p.publishedAt))?Math.max(0,Date.now()-Date.parse(p.publishedAt)):Infinity;
const tier=p=>listedAge(p)<DAY?0:listedAge(p)<3*DAY?1:2;
const compare=(a,b)=>tier(a)-tier(b)||((b.fitScore||0)%100)-((a.fitScore||0)%100)||(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0)||(a.distanceMiles??Infinity)-(b.distanceMiles??Infinity);
const isSaved=p=>[p.id,...(p.aliasIds||[])].some(id=>saved.has(id));
const links=p=>p.sourceLinks?.length?p.sourceLinks:[{source:p.source||'rightmove',name:names[p.source||'rightmove'],url:p.url}];
const linkHTML=p=>links(p).filter(l=>safeLink(l.url)).map(l=>`<a href="${esc(safeLink(l.url))}" target="_blank" rel="noopener noreferrer" title="Open ${esc(l.name)} advert">${esc(short[l.source]||l.name)} ↗</a>`).join('');
function setView(next){view=next;document.querySelectorAll('[data-view]').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});render();}
function empty(title,description){$('property-list').innerHTML=`<div class="empty-state"><h3>${esc(title)}</h3><p>${esc(description)}</p></div>`;}
function render(){
 if(!feed)return;
 const homes=[...feed.properties].sort(compare),pending=feed.pendingProperties||[],all=[...homes,...pending];
 const recent=homes.filter(p=>tier(p)===0),days=homes.filter(p=>tier(p)<=1);
 const health=feed.sourceHealth||[];const active=health.filter(s=>s.status==='ok').length;
 $('checked-label').textContent=feed.checkedAt?`Checked ${age(feed.checkedAt)} ago`:'Awaiting first check';
 $('stats-text').innerHTML=`<strong>${homes.length}</strong> matches <span class="divider">/</span> <strong>${recent.length}</strong> in 24h <span class="divider">/</span> ${pending.length} need checking`;
 $('source-health').innerHTML=health.map(s=>`<span class="source-status ${esc(s.status)}" title="${esc(s.name)}: ${esc(s.status)}"><i class="health-dot"></i>${esc(s.name)}${s.status==='ok'?'':` · ${esc(s.status)}`}</span>`).join('');
 const stale=!feed.checkedAt||Date.now()-Date.parse(feed.checkedAt)>2.5*3600000;
 const notices=[...(feed.warnings||[]),...(stale?['Updates overdue; results may be stale.']:[])];
 $('notice').hidden=!notices.length;$('notice').textContent=[...new Set(notices)].join(' ');
 $('welcome-summary').textContent=recent.length?`${recent.length} added in 24h · ranked by fit`:days.length?'No 24h matches · recent alternatives':homes.length?'No 24h matches · best older homes':'No screened matches · check later';
 const picks=homes.slice(0,3);
 $('ranked-summary').innerHTML=picks.map((p,i)=>`<li><span class="summary-rank">${i+1}</span><div><a href="${esc(safeLink(p.url)||'#')}" target="_blank" rel="noopener noreferrer">${esc(p.address)}</a><span class="summary-reasons">${esc(money.format(p.price))} · ${p.bedrooms} bed · ${Number.isFinite(p.distanceMiles)?p.distanceMiles.toFixed(2)+' mi':'?'} · ${p.publishedAt?age(p.publishedAt)+(p.datePrecision==='day'?' ≈':''):'date ?'}${p.refurbishment?' · '+esc(p.refurbishment):''}</span></div></li>`).join('');
 $('match-count').textContent=homes.length;$('recent-count').textContent=recent.length;$('pending-count').textContent=pending.length;$('saved-count').textContent=all.filter(isSaved).length;
 let visible=(view==='pending'?pending:view==='saved'?all:homes).filter(p=>view==='recent'?tier(p)===0:view==='three-days'?tier(p)<=1:view==='saved'?isSaved(p):true);
 const source=$('source-filter').value;if(source!=='all')visible=visible.filter(p=>links(p).some(l=>l.source===source));
 visible.sort((a,b)=>$('sort').value==='price-low'?(a.price??Infinity)-(b.price??Infinity):$('sort').value==='price-high'?(b.price??-Infinity)-(a.price??-Infinity):$('sort').value==='newest'?(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0):compare(a,b));
 current=visible;$('results-count').textContent=`${visible.length} shown`;$('map-count').textContent=`${visible.length} homes`;
 $('merge-count').textContent=`${feed.duplicatesMerged||0} duplicate adverts merged · ${active}/${health.length||1} sources live`;
 if(!visible.length){const sourceState=health.find(s=>s.source===source);empty(sourceState?.status==='blocked'?`${names[source]} blocked`:view==='saved'?'No saved homes':view==='pending'?'No unresolved checks':'No matches in this view',sourceState?.status==='blocked'?'Automated access is blocked. Other sources are still available.':view==='saved'?'Use the heart to save a home.':'Try another filter or check later.');}
 else $('property-list').innerHTML=visible.map((p,i)=>{
  const pending=p.verificationStatus!=='screened';
  const distance=Number.isFinite(p.distanceMiles)?p.distanceMiles.toFixed(2):'?';
  const station=Number.isFinite(p.nearestStationMiles)?`${esc(p.nearestStationName)}: ${p.nearestStationMiles.toFixed(2)} mi`:'Station distance unavailable';
  const details=`<p>${station}${p.nearestTrackMetres!=null?` · Mapped track: ${p.nearestTrackMetres} m`:''}${p.southOfRoadMetres!=null?` · ${p.southOfRoadMetres} m south of boundary`:''}</p><p>${esc(p.description||p.summary||'Description unavailable')}</p>`;
  return `<article class="property-card ${selected===p.id?'selected':''}" id="home-${esc(p.id)}"><span class="property-number">${i+1}</span><div class="property-price">${p.price!=null?esc(money.format(p.price)):'?'}<span class="price-note">pcm</span></div><div><h2 class="property-address"><button data-locate="${esc(p.id)}" title="Show on map">${esc(p.address)}</button></h2><div class="property-specs">${p.bedrooms??'?'} bed${p.bathrooms?' · '+p.bathrooms+' bath':''}${p.type?' · '+esc(p.type):''}</div>${pending?`<p class="verification-note">${esc(p.verificationReason||'Needs checking')}</p>`:''}<div class="fit-badges">${p.hasFloorplan?'<span class="fit-badge">Floor plan</span>':''}${p.refurbishment?`<span class="fit-badge refurb" title="${esc(p.refurbishmentEvidence||'Advertiser description')}">${esc(p.refurbishment)}</span>`:''}${p.bedrooms===1?`<span class="fit-badge budget">${p.price<=1800?'Within target':'£'+Math.round(p.price-1800)+' above target'}</span>`:''}${pending?'<span class="fit-badge pending">Unverified</span>':''}</div><div class="source-links">${linkHTML(p)}<details class="details-more"><summary>Details</summary><div class="details-body">${details}</div></details></div></div><span class="cell-distance" title="${distance} miles to Denmark Hill">${distance} mi</span><span class="cell-age ${tier(p)===0?'fresh':''}" title="${esc(p.publishedAt||p.sourceDateLabel||'Unknown listing date')}">${p.publishedAt?age(p.publishedAt)+(p.datePrecision==='day'?' ≈':''):'?'}</span><button class="save-button ${isSaved(p)?'saved':''}" data-save="${esc(p.id)}" aria-pressed="${isSaved(p)}" aria-label="${isSaved(p)?'Unsave':'Save'} ${esc(p.address)}">${isSaved(p)?'♥':'♡'}</button></article>`;
 }).join('');
 resizePanels();renderMap();
}
function resizePanels(){const panel=document.querySelector('.dashboard');if(window.innerWidth>820)panel.style.setProperty('--panel-height',`${Math.max(350,window.innerHeight-panel.getBoundingClientRect().top-33)}px`);if(map){map.invalidateSize({pan:false});renderPins();}}
function renderMap(){
 if(!window.L){$('map').innerHTML='<div class="empty-state"><h3>Map unavailable</h3><p>Results remain available.</p></div>';return;}
 if(!map){
  const c=feed.radius||{lat:51.46829,lng:-.0895,miles:1};
  map=L.map('map',{scrollWheelZoom:true,zoomControl:true}).setView([c.lat,c.lng],13);
  const basemap=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
  let tileFailures=0;basemap.on('tileerror',()=>{if(++tileFailures===4)$('map-count').textContent='Map tiles unavailable';});
  circle=L.circle([c.lat,c.lng],{radius:c.miles*1609.344,color:'#549c91',weight:1.3,dashArray:'4 5',fillColor:'#2e9b85',fillOpacity:.035}).addTo(map);
  if(feed.boundaryLines?.length)L.polyline(feed.boundaryLines,{color:'#868da8',weight:2.5,opacity:.7,interactive:false}).addTo(map);
  L.marker([c.lat,c.lng],{icon:L.divIcon({html:'<div class="station-marker">▤</div>',iconSize:[22,22],iconAnchor:[11,11]}),title:'Denmark Hill Station'}).bindTooltip('Denmark Hill',{permanent:true,direction:'right',offset:[8,0],className:'station-tooltip'}).addTo(map);
  layer=L.featureGroup().addTo(map);map.on('zoomend',renderPins);fitMap();
 }
 renderPins();
}
function renderPins(){
 if(!map||!layer)return;layer.clearLayers();markers.clear();const occupied=[];
 current.forEach((p,i)=>{
  if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng))return;
  const actual=L.latLng(p.lat,p.lng),point=map.latLngToLayerPoint(actual);let display=point;
  // Offset colliding numbered pins, retaining a fine connector to their reported positions.
  for(let attempt=0;attempt<25&&occupied.some(q=>q.distanceTo(display)<23);attempt++){
   const ring=1+Math.floor(attempt/8),angle=(attempt%8)*Math.PI/4;
   display=point.add(L.point(Math.cos(angle)*ring*25,Math.sin(angle)*ring*25));
  }
  occupied.push(display);const location=map.layerPointToLatLng(display);
  if(display.distanceTo(point)>1)L.polyline([actual,location],{color:'#8ba2aa',weight:1,opacity:.65,interactive:false}).addTo(layer);
  const cls=p.verificationStatus!=='screened'?'pending':p.bedrooms===2?'two':'';
  const marker=L.marker(location,{icon:L.divIcon({html:`<div class="home-pin ${cls} ${selected===p.id?'selected':''}"><span>${i+1}</span></div>`,iconSize:[28,34],iconAnchor:[14,32],popupAnchor:[0,-27]}),title:`${i+1}. ${p.address}`,keyboard:true,zIndexOffset:selected===p.id?1000:0}).addTo(layer);
  marker.bindTooltip(`${esc(money.format(p.price))} pcm · ${p.bedrooms} bed`,{direction:'top',offset:[0,-30],className:'pin-tooltip'});
  const popup=document.createElement('div');popup.innerHTML=`<strong>${esc(p.address)}</strong><br>${esc(money.format(p.price))} pcm · ${p.bedrooms} bed · ${p.distanceMiles?.toFixed(2)??'?'} mi<br>${p.refurbishment?esc(p.refurbishment)+'<br>':''}${linkHTML(p)}${p.verificationStatus!=='screened'?'<br><small>Needs checking</small>':''}`;
  marker.bindPopup(popup).on('click',()=>selectHome(p.id,false));markers.set(p.id,marker);
 });
}
function selectHome(id,zoom){
 const p=current.find(p=>p.id===id);if(!p)return;selected=id;
 document.querySelectorAll('.property-card').forEach(el=>el.classList.toggle('selected',el.id===`home-${id}`));
 const row=$(`home-${id}`);if(row)row.scrollIntoView({behavior:'smooth',block:'nearest'});
 if(map){if(zoom&&Number.isFinite(p.lat)&&Number.isFinite(p.lng))map.setView([p.lat,p.lng],15,{animate:false});renderPins();markers.get(id)?.openPopup();}
}
function fitMap(){if(map&&circle)map.fitBounds(circle.getBounds(),{padding:[22,22],maxZoom:14});}
async function load(){
 if(busy)return;busy=true;$('refresh-button').disabled=true;
 try{const response=await fetch(`data/listings.json?t=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw Error('Feed unavailable');const next=await response.json();if(!Array.isArray(next.properties))throw Error('Invalid feed');feed=next;render();}
 catch(_){$('notice').hidden=false;$('notice').textContent='Feed refresh failed; try again shortly.';if(!feed)empty('Feed unavailable','Try refreshing shortly.');}
 finally{busy=false;$('refresh-button').disabled=false;}
}
$('refresh-button').addEventListener('click',load);$('sort').addEventListener('change',render);$('source-filter').addEventListener('change',render);$('fit-map').addEventListener('click',fitMap);
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$('property-list').addEventListener('click',event=>{
 const button=event.target.closest('[data-save]');
 if(button){const p=current.find(p=>p.id===button.dataset.save);if(p){const remove=isSaved(p);[p.id,...(p.aliasIds||[])].forEach(id=>saved.delete(id));if(!remove)saved.add(p.id);try{localStorage.setItem('tom-home-shortlist',JSON.stringify([...saved]));}catch(_){}render();}}
 const locate=event.target.closest('[data-locate]');if(locate)selectHome(locate.dataset.locate,true);
});
window.addEventListener('resize',resizePanels);load();setInterval(()=>{if(!document.hidden)load();},5*60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
