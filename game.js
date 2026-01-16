// --- game.js ---
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// MOB SPRITE LOADER (color-key background removal)
window.MOB_SPRITES = window.MOB_SPRITES || {};
function loadMobSprite(key, url, opts){
    opts = opts || {};
    // support .ctx manifest files which can reference a PNG or embed a dataURL
    try{
        if(typeof url === 'string' && url.toLowerCase().endsWith('.ctx')){
            fetch(url).then(r=>r.json()).then(cfg=>{
                if(cfg && cfg.src){
                    // resolve to the referenced image
                    loadMobSprite(key, cfg.src, opts);
                }else if(cfg && cfg.dataURL){
                    const img = new Image(); img.crossOrigin = 'anonymous';
                    img.onload = ()=>{ try{ processSpriteImage(key, img, opts); }catch(e){ console.warn('sprite process failed', e); } };
                    img.onerror = ()=>{ console.warn('failed to load dataURL sprite', url); };
                    img.src = cfg.dataURL;
                }else{
                    console.warn('invalid .ctx manifest', url);
                }
            }).catch(e=>{ console.warn('failed to fetch .ctx', url, e); });
            return;
        }
    }catch(e){ /* ignore fetch/init errors and fall through to image load */ }

    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = ()=>{ processSpriteImage(key, img, opts); };
    img.onerror = ()=>{ console.warn('failed to load sprite', url); };
    img.src = url;
}

// helper to turn a loaded Image into a color-keyed offscreen canvas entry
function processSpriteImage(key, img, opts){
    try{
        const w = img.width, h = img.height;
        const oc = document.createElement('canvas'); oc.width = w; oc.height = h; const octx = oc.getContext('2d');
        octx.drawImage(img,0,0);
        try{
            const id = octx.getImageData(0,0,1,1).data; // top-left pixel as background
            const br = id[0], bg = id[1], bb = id[2];
            const data = octx.getImageData(0,0,w,h);
            for(let i=0;i<data.data.length;i+=4){
                const r = data.data[i], g = data.data[i+1], b = data.data[i+2];
                const tol = (opts && opts.tolerance) ? opts.tolerance : 32;
                if(Math.abs(r-br)<tol && Math.abs(g-bg)<tol && Math.abs(b-bb)<tol){ data.data[i+3] = 0; }
            }
            octx.putImageData(data,0,0);
        }catch(e){}
        window.MOB_SPRITES[key] = { img, canvas: oc, w: w, h: h, loaded: true };
    }catch(e){ console.warn('sprite load failed', e); }
}

// ====================
// Bee Sprite Setup
// ====================

const beeImg = new Image();
beeImg.crossOrigin = 'anonymous';
// prefer the assets folder if present
beeImg.src = 'assets/bee.png';

let beeLoaded = false;
beeImg.onload = () => { beeLoaded = true; };
beeImg.onerror = () => { beeLoaded = false; };

// ====================
// Draw Bee (Sprite)
// ====================

function drawbee(ctx, x, y, radius = 16, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);

    const size = radius * 2;

    if (!(beeLoaded && beeImg && beeImg.complete && beeImg.naturalWidth)){
        ctx.restore();
        return; // only render when sprite is available
    }

    // Disable smoothing if pixel art
    ctx.imageSmoothingEnabled = false;
    // preserve source aspect ratio when drawing
    const aspect = beeImg.naturalWidth / beeImg.naturalHeight;
    let drawW = size, drawH = size;
    if(aspect > 1){ // wide image
        drawW = size; drawH = size / aspect;
    } else if(aspect < 1){ // tall image
        drawH = size; drawW = size * aspect;
    }
    ctx.drawImage(beeImg, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
}

// NOTE: Procedural hornet/bee renderers removed — sprites are used instead.
// try loading a default mandible sprite - prefer SVG (transparent via magenta key), fallback to PNG
try{ loadMobSprite('mandible', 'assets/mandible.svg', { tolerance: 40 }); }catch(e){}
try{ loadMobSprite('mandible', 'assets/mandible.png', { tolerance: 40 }); }catch(e){}
try{ loadMobSprite('hornet', 'assets/hornet.png', { tolerance: 40 }); }catch(e){}


// Run equip hooks for all currently equipped items (best-effort idempotent sync)
function runEquipHooks(){
    try{
        for(let i=0;i<10;i++){
            if(player.equipped[i] && player.equipped[i].type) applyOnEquip(i, false);
            if(player.swap[i] && player.swap[i].type) applyOnEquip(i, true);
        }
    }catch(e){}
}

let CENTER_X = canvas.width/2;
let CENTER_Y = canvas.height/2;
let viewWidth = canvas.width;
let viewHeight = canvas.height;

/* =========================
   CANVAS SCALE & COLLISION FIX
   ========================= */
// FORCE 1:1 coordinate system (NO CSS scaling)
function resizeCanvas(){
    const scale = window.devicePixelRatio || 1;
    // Match canvas resolution to displayed size
    let rect = canvas.getBoundingClientRect();
    // If the canvas has no layout size (hidden or not yet in DOM), fallback to window size
    if(!rect.width || !rect.height){
        rect = { width: window.innerWidth || 800, height: window.innerHeight || 600, left: 0, top: 0 };
    }
    canvas.width  = Math.floor(rect.width  * scale);
    canvas.height = Math.floor(rect.height * scale);
    // apply transform so drawing uses CSS pixels
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // update center variables (in CSS pixels)
    CENTER_X = rect.width/2;
    CENTER_Y = rect.height/2;
    viewWidth = rect.width;
    viewHeight = rect.height;
    // ensure the element's CSS size matches the logical view
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
}
// Run once and on resize
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

let keys = {};
document.addEventListener("keydown", e => keys[e.key] = true);
document.addEventListener("keyup", e => keys[e.key] = false);

// collision debug toggle
window.COLLISION_DEBUG = false;
// verbose collision logs (disable to avoid console spam)
window.COLLISION_LOGS = false;

// small throttled logger to avoid console spam for repeated collision messages
window._lastLogTimes = window._lastLogTimes || {};
function throttleLog(key, fn, minMs = 250){
    try{
        const now = Date.now();
        const last = window._lastLogTimes[key] || 0;
        if(now - last > minMs){ fn(); window._lastLogTimes[key] = now; }
    }catch(e){ /* ignore logging failures */ }
}

// control mode: 'keyboard' or 'mouse'
let controlMode = localStorage.getItem('controlMode') || 'keyboard';
window.setControlMode = function(mode){ controlMode = mode; localStorage.setItem('controlMode', mode); };

// show hitboxes toggle
let showHitboxes = (localStorage.getItem('showHitboxes') === '1');
window.setShowHitboxes = function(v){ showHitboxes = !!v; localStorage.setItem('showHitboxes', showHitboxes ? '1' : '0'); };

// Keyboard toggles for UI (will call DOM modal toggles)
document.addEventListener("keydown", e => {
    if(typeof e.key === 'string'){
        const k = e.key.toLowerCase();
        if(k === 'x' && window.toggleInventory) window.toggleInventory();
        if(k === 'c' && window.toggleCraft) window.toggleCraft();
        if(k === 'v' && window.toggleSeen) window.toggleSeen();
    }
});

// --- PLAYER ---
let player = { x:CENTER_X, y:CENTER_Y, radius:15, speed:4, health:100, maxHealth:100, petals:10, petalsDistance:30, inventory:[], equipped:Array(10).fill(null), cooldowns:{}, mass: 10, vx:0, vy:0 };
// separate swap row storage (user-visible second row)
player.swap = Array(10).fill(null);
// godmode flag
player.godmode = false;
// store default and expanded distances for smooth transitions
player.petalsDistanceDefault = 30;
player.petalsDistanceExpanded = 80;
// track seen mobs and allow inventory stacking by type+rarity
player.seenMobs = {};
let petals = [];
function refreshPetals(){
    petals = [];
    for(let i=0;i<player.petals;i++){
        petals.push({angle:(Math.PI*2/player.petals)*i,radius:6, slotIndex: i});
    }
}

// Passive effects for equipped petals (per-slot cooldowns)
function applyPassiveEffects(){
    const now = Date.now();
    for(let i=0;i<player.equipped.length;i++){
        const slot = player.equipped[i]; if(!slot) continue;
        const type = slot.type;
        const key = 'passive_' + i;
        if(type === 'Rose'){
            // small heal every 1000ms
            if(!player.cooldowns[key] || now - player.cooldowns[key] >= 1000){ player.health = Math.min(player.maxHealth, player.health + 2); player.cooldowns[key] = now; }
        } else if(type === 'Pollen'){
            // aura damage to nearby mobs every 600ms
            if(!player.cooldowns[key] || now - player.cooldowns[key] >= 600){
                mobs.forEach(mob=>{ const d=Math.hypot(mob.x-player.x,mob.y-player.y); if(d < player.petalsDistance+20) mob.health -= 2; });
                player.cooldowns[key] = now;
            }
        }
    }
}
refreshPetals();
// track last time player was hit for i-frames
player.lastHitTime = 0;

// --- GAME STATE ---
let mobs=[];
let drops=[];
let projectiles=[];
let currentWave=1;
let isDead=false;
let spaceHeld = false;
let mouseHeld = false;
let animationId = null;
let nextEquipIndex = 0;

// ---- GLOBAL COOLDOWNS ----
const PETAL_HIT_COOLDOWN = 350; // ms between petal hits per mob
const PLAYER_IFRAME_TIME = 500; // ms of invincibility after hit

// --- ITEMS ---
const ITEM_TYPES={
    Rose:{name:"Rose",heal:15,cooldown:1000,useTime:1000, mass:0.2},
    Light:{name:"Light",damage:5,cooldown:700,useTime:700, mass:0.3},
    Stinger:{name:"Stinger",damage:20,cooldown:5000,useTime:5000, mass:0.7},
    Pollen:{name:"Pollen",damage:3,cooldown:1200,useTime:300, mass:0.25},
    Missile:{name:"Missile",damage:10,cooldown:1200,useTime:400, mass:1.0}
};

function spawnDrop(name,x,y, rarity){
    rarity = rarity || 'Common';
    const icon = getPetalIconURL(name, rarity, 40);
    const drop = { x, y, radius:18, type: name, stack: 1, rarity: rarity, iconURL: icon, _imgLoaded: false, _img: null };
    // lazy image cache
    try{
        const img = new Image(); img.onload = ()=>{ drop._imgLoaded = true; drop._img = img; };
        img.src = icon;
    }catch(e){}
    drops.push(drop);
}

function spawnMobDrops(mob){
    // data-driven drops if CONFIG available
    try{
        if(typeof window !== 'undefined' && window.ZEPHYRAX_CONFIG){
            const tpl = window.ZEPHYRAX_CONFIG.mobs.find(m=>m.id===mob.type || m.name===mob.name);
            if(tpl && tpl.drops && tpl.drops.length>0){
                tpl.drops.forEach((d,idx)=> spawnDrop(d, mob.x + (idx*22) - (tpl.drops.length*10), mob.y + (idx*8), mob.rarity || mob.rarityName || 'Common'));
                return;
            }
        }
    }catch(e){}
    // fallback
    switch(mob.type){
        case "Ladybug": spawnDrop("Rose",mob.x,mob.y); spawnDrop("Light",mob.x+15,mob.y+15); break;
        case "Bee": spawnDrop("Stinger",mob.x,mob.y); spawnDrop("Pollen",mob.x+15,mob.y+15); break;
        case "Hornet": spawnDrop("Missile",mob.x,mob.y); break;
    }
}

// helper to add inventory entries (type,rarity,stack)
function addToInventory(type,rarity,amount){
    amount = amount || 1;
    let found = player.inventory.find(it=>it.type===type && it.rarity===rarity);
    if(found) found.stack += amount; else player.inventory.push({type,rarity,stack:amount});
    try{ savePlayerState(); }catch(e){}
}

// ----- Petal definitions loader and equip hooks -----
window.PETAL_DEFS = {};
window.PETAL_HOOKS = window.PETAL_HOOKS || {};
function loadPetalDefs(){
    // try fetching JSON definitions; if failure, fallback to empty
    fetch('data/petals.json').then(r=>r.json()).then(list=>{
        list.forEach(p=>{ window.PETAL_DEFS[p.name || p.id] = p; window.PETAL_DEFS[p.id || p.name] = p; });
        // also index by lowercase
        list.forEach(p=>{ if(p.name) window.PETAL_DEFS[p.name.toLowerCase()] = p; if(p.id) window.PETAL_DEFS[p.id.toLowerCase()] = p; });
    }).catch(()=>{
        // ignore failures; game will still function with textual names
    });
    // Also seed from embedded config if present (runs immediately)
    try{
        if(window.ZEPHYRAX_CONFIG && Array.isArray(window.ZEPHYRAX_CONFIG.petals)){
            window.ZEPHYL_PETALS = window.ZEPHYRAX_CONFIG.petals;
            window.ZEPHYRAX_CONFIG.petals.forEach(p=>{
                if(!p) return;
                const keyName = p.name || p.id;
                if(keyName){ window.PETAL_DEFS[keyName] = p; window.PETAL_DEFS[(p.id||keyName)] = p; window.PETAL_DEFS[keyName.toLowerCase()] = p; if(p.id) window.PETAL_DEFS[p.id.toLowerCase()] = p; }
            });
        }
    }catch(e){}
}
loadPetalDefs();

// Simple SVG icon generator for petals (data URL cache)
const PETAL_ICON_CACHE = {};
function getPetalIconURL(type, rarity, size=40){
    const key = `${type}|${rarity}|${size}`;
    if(PETAL_ICON_CACHE[key]) return PETAL_ICON_CACHE[key];
    const def = window.PETAL_DEFS[type] || window.PETAL_DEFS[(type||'').toLowerCase()] || {};
    const fill = def.color || RARITY_COLOR[rarity] || '#d0d0d0';
    const stroke = '#111';
    const t = (type||'').toLowerCase();
    let shape = 'circle';
    if(t.includes('leaf') || t.includes('leafy') || t.includes('peas') || t.includes('clover')) shape = 'leaf';
    else if(t.includes('stinger') || t.includes('thorn') || t.includes('spike')) shape = 'spike';
    else if(t.includes('honey') || t.includes('wax') || t.includes('bee')) shape = 'hex';
    else if(t.includes('glass') || t.includes('rock') || t.includes('stone')) shape = 'diamond';
    else if(t.includes('rose') || t.includes('flower') || t.includes('basil')) shape = 'flower';
    else if(t.includes('light') || t.includes('glow')) shape = 'glow';

    const w = size, h = size;
    let svg = '';
    if(shape === 'circle' || shape === 'glow'){
        const g = shape==='glow' ? `<radialGradient id='g'><stop offset='0%' stop-color='${fill}' stop-opacity='1'/><stop offset='80%' stop-color='${fill}' stop-opacity='0.55'/></radialGradient>` : '';
        svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${g}<rect width='100%' height='100%' fill='transparent'/>${shape==='glow'?`<circle cx='${w/2}' cy='${h/2}' r='${w*0.38}' fill='url(#g)' stroke='${stroke}' stroke-width='1'/>`:`<circle cx='${w/2}' cy='${h/2}' r='${w*0.36}' fill='${fill}' stroke='${stroke}' stroke-width='1'/>`}<text x='50%' y='55%' font-size='12' text-anchor='middle' fill='#ffffff' font-family='Arial' font-weight='700'>${(type||'')[0]||''}</text></svg>`;
    } else if(shape === 'hex'){
        const cx=w/2, cy=h/2, r=w*0.34; const pts=[]; for(let i=0;i<6;i++){ const a = Math.PI/3 * i - Math.PI/6; pts.push((cx+Math.cos(a)*r).toFixed(2)+','+(cy+Math.sin(a)*r).toFixed(2)); }
        svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><polygon points='${pts.join(' ')}' fill='${fill}' stroke='${stroke}' stroke-width='1'/><text x='50%' y='58%' font-size='12' text-anchor='middle' fill='#fff' font-family='Arial' font-weight='700'>${(type||'')[0]||''}</text></svg>`;
    } else if(shape === 'diamond'){
        const pts = `${w/2},${h*0.15} ${w*0.85},${h/2} ${w/2},${h*0.85} ${w*0.15},${h/2}`;
        svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><polygon points='${pts}' fill='${fill}' stroke='${stroke}' stroke-width='1'/></svg>`;
    } else if(shape === 'leaf'){
        svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><path d='M${w*0.2},${h*0.6} C${w*0.25},${h*0.2} ${w*0.6},${h*0.2} ${w*0.8},${h*0.35} C${w*0.65},${h*0.65} ${w*0.35},${h*0.9} ${w*0.2},${h*0.6} Z' fill='${fill}' stroke='${stroke}' stroke-width='1'/></svg>`;
    } else if(shape === 'flower'){
        // simple 5-petal flower
        const cx=w/2, cy=h/2; svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>`;
        for(let i=0;i<5;i++){ const a = (Math.PI*2/5)*i; const px=cx+Math.cos(a)*(w*0.26); const py=cy+Math.sin(a)*(h*0.26); svg += `<ellipse cx='${px}' cy='${py}' rx='${w*0.16}' ry='${h*0.12}' fill='${fill}' stroke='${stroke}' stroke-width='0.6' transform='rotate(${(a*180/Math.PI)} ${px} ${py})'/>`; }
        svg += `<circle cx='${cx}' cy='${cy}' r='${w*0.12}' fill='#fff'/>`;
        svg += `</svg>`;
    } else if(shape === 'spike'){
        // star-like
        const cx=w/2, cy=h/2; let pts=''; for(let i=0;i<8;i++){ const r = (i%2==0)?w*0.38:w*0.16; const a = (Math.PI*2/8)*i - Math.PI/2; pts += (cx+Math.cos(a)*r).toFixed(2)+','+(cy+Math.sin(a)*r).toFixed(2)+' '; }
        svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><polygon points='${pts.trim()}' fill='${fill}' stroke='${stroke}' stroke-width='0.8'/></svg>`;
    }
    const data = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    PETAL_ICON_CACHE[key] = data;
    return data;
}

// Create a floating tooltip element for petal stats/descriptions
function ensurePetalTooltip(){
    if(window._petalTooltipCreated) return;
    window._petalTooltipCreated = true;
    function make(){
        const el = document.createElement('div');
        el.id = 'petalTooltip';
        el.style.position = 'fixed';
        el.style.pointerEvents = 'none';
        el.style.zIndex = 99999;
        el.style.padding = '8px 10px';
        el.style.background = 'rgba(12,12,16,0.94)';
        el.style.color = 'white';
        el.style.borderRadius = '8px';
        el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.6)';
        el.style.fontSize = '13px';
        el.style.lineHeight = '1.2';
        el.style.maxWidth = '320px';
        el.style.display = 'none';
        document.body.appendChild(el);
        window._petalTooltipEl = el;
    }
    if(document.body) make(); else document.addEventListener('DOMContentLoaded', make);

    let currentTarget = null;
    document.addEventListener('pointerover', function(ev){
        try{
            const t = ev.target.closest && ev.target.closest('[data-type]');
            if(!t) return;
            const type = t.dataset.type;
            if(!type) return;
            currentTarget = t;
            const rarity = t.dataset.rarity || 'Common';
            const def = window.PETAL_DEFS && (window.PETAL_DEFS[type] || window.PETAL_DEFS[type.toLowerCase()]) ? (window.PETAL_DEFS[type] || window.PETAL_DEFS[type.toLowerCase()]) : null;
            const title = def && (def.name || def.id) ? (def.name || def.id) : (type || 'Unknown');
            const desc = def && def.description ? def.description : '';
            const bp = def && (def.basePower || def.power) ? (`<div style="margin-top:6px;color:#ddd;font-size:12px">Power: <strong style='color:#fff'>${def.basePower || def.power}</strong></div>`) : '';
            const typ = def && def.type ? (`<div style="margin-top:4px;color:#ccc;font-size:12px">Type: ${def.type}</div>`) : '';
            const rarityColor = RARITY_COLOR[rarity] || '#ddd';
            const html = `<div style="font-weight:700;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between"><div>${title}</div><div style='font-size:11px;padding:2px 6px;border-radius:6px;background:${rarityColor};color:${contrastColor(rarityColor)}'>${rarity}</div></div><div style="color:#ddd;font-size:13px">${desc}</div>${typ}${bp}`;
            if(window._petalTooltipEl){ window._petalTooltipEl.innerHTML = html; window._petalTooltipEl.style.display = 'block'; }
        }catch(e){}
    });

    document.addEventListener('pointermove', function(ev){
        try{
            if(!window._petalTooltipEl || !currentTarget) return;
            const pad = 12;
            let x = ev.clientX + pad;
            let y = ev.clientY + pad;
            const w = window._petalTooltipEl.offsetWidth;
            const h = window._petalTooltipEl.offsetHeight;
            if(x + w > window.innerWidth) x = Math.max(8, ev.clientX - w - pad);
            if(y + h > window.innerHeight) y = Math.max(8, ev.clientY - h - pad);
            window._petalTooltipEl.style.left = x + 'px'; window._petalTooltipEl.style.top = y + 'px';
        }catch(e){}
    });

    document.addEventListener('pointerout', function(ev){
        try{
            const left = ev.target.closest && ev.target.closest('[data-type]');
            if(!left) return;
            if(window._petalTooltipEl){ window._petalTooltipEl.style.display = 'none'; }
            currentTarget = null;
        }catch(e){}
    });
}
ensurePetalTooltip();

function applyOnEquip(slotIndex, isSwap){
    const arr = isSwap ? player.swap : player.equipped;
    const s = arr[slotIndex];
    if(!s || !s.type) return;
    const def = window.PETAL_DEFS[s.type] || window.PETAL_DEFS[(s.type||'').toLowerCase()];
    if(def && def.onEquip && typeof window.PETAL_HOOKS[def.onEquip] === 'function'){
        try{ window.PETAL_HOOKS[def.onEquip](slotIndex, s); }catch(e){}
    }
}

function applyOnUnequip(slotIndex, isSwap){
    const arr = isSwap ? player.swap : player.equipped;
    const s = arr[slotIndex];
    // when unequipping we may want to run remove hooks — placeholder
    if(!s) return;
    const def = window.PETAL_DEFS[s.type] || window.PETAL_DEFS[(s.type||'').toLowerCase()];
    if(def && def.onUnequip && typeof window.PETAL_HOOKS[def.onUnequip] === 'function'){
        try{ window.PETAL_HOOKS[def.onUnequip](slotIndex, s); }catch(e){}
    }
}

// Persist inventory and equipped state so items don't disappear after death or reload
function savePlayerState(){
    try{
        const state = { inventory: player.inventory, equipped: player.equipped, swap: player.swap };
        localStorage.setItem('zephyrax_player_state', JSON.stringify(state));
    }catch(e){}
}
function loadPlayerState(){
    try{
        const raw = localStorage.getItem('zephyrax_player_state');
        if(!raw) return;
        const state = JSON.parse(raw);
        if(state.inventory && Array.isArray(state.inventory)) player.inventory = state.inventory;
        if(state.equipped && Array.isArray(state.equipped)) player.equipped = state.equipped;
        if(state.swap && Array.isArray(state.swap)) player.swap = state.swap;
    }catch(e){}
}
// load on script start
loadPlayerState();

// --- SPAWN WAVE ---
function spawnWave(waveNumber){
    // spawn queue to emit enemies over time instead of all at once
    mobs = mobs || [];
    const cfg = (typeof window !== 'undefined' && window.ZEPHYRAX_CONFIG) ? window.ZEPHYRAX_CONFIG : null;
    const count = Math.max(6, 8 + Math.floor(waveNumber * 1.6));
    const spawnList = [];
    for(let i=0;i<count;i++){
        const x=Math.random()*viewWidth;
        const y=Math.random()*viewHeight;
        if(cfg && cfg.mobs && cfg.mobs.length){
            const tpl = cfg.mobs[Math.floor(Math.random()*cfg.mobs.length)];
            const maxR = (cfg.rarities && cfg.rarities.length) ? cfg.rarities.length - 1 : (RARITY_NAMES.length - 1);
            let base = Math.max(0, tpl.baseRarity || 0);
            let rarityName = pickRarityByWave(waveNumber);
            let rarityIndex = RARITY_NAMES.indexOf(rarityName);
            if(rarityIndex < 0) rarityIndex = Math.min(base + Math.floor(waveNumber/10), maxR);
            if(base) rarityIndex = Math.max(rarityIndex, base);
            let multiplier = 1;
            if(cfg.rarities && cfg.rarities[rarityIndex]){
                multiplier = cfg.rarities[rarityIndex].multiplier || rarityMultiplier(rarityIndex);
                rarityName = cfg.rarities[rarityIndex].name || RARITY_NAMES[rarityIndex] || 'Common';
            } else {
                multiplier = rarityMultiplier(rarityIndex);
                rarityName = RARITY_NAMES[rarityIndex] || 'Common';
            }
            spawnList.push({ tpl, x, y, rarityIndex, rarityName, multiplier, waveNumber });
        } else {
            const rName = pickRarityByWave(waveNumber);
            const rarityIndex = Math.max(0, Math.min(RARITY_NAMES.indexOf(rName), RARITY_NAMES.length-1));
            spawnList.push({ tpl: null, x, y, rarityIndex, rarityName: rName, multiplier: rarityMultiplier(rarityIndex), waveNumber });
        }
    }

    // schedule spawns gradually
    if(window._spawnInterval) try{ clearInterval(window._spawnInterval); }catch(e){}
    let idx = 0; const spacing = Math.max(120, 600 - Math.min(400, waveNumber*10));
    window._spawnInterval = setInterval(()=>{
        try{
            if(idx >= spawnList.length){ clearInterval(window._spawnInterval); window._spawnInterval = null; return; }
            const s = spawnList[idx++];
            if(s.tpl){
                const tpl = s.tpl; const rarityIndex = s.rarityIndex; const rarityName = s.rarityName; const multiplier = s.multiplier; const wave = s.waveNumber;
                const hp = Math.max(6, Math.round((tpl.baseHP||30) * multiplier * (1 + wave*0.03)));
                const dmg = Math.max(1, Math.round((tpl.baseDamage||2) * multiplier));
                const size = Math.max(8, Math.round((tpl.baseSize||12) * (1 + rarityIndex*0.07)));
                const speed = Math.max(0.2, (tpl.baseSpeed? tpl.baseSpeed : Math.max(0.6, 1.6 - (rarityIndex*0.04))));
                const typeVal = (tpl.id || tpl.name || '').toString();
                const shootCd = (tpl.shootCooldown != null) ? tpl.shootCooldown : ((typeVal.toLowerCase() === 'hornet') ? 120 : 0);
                // Special-case: centipede as segmented mob
                if((typeVal||'').toLowerCase() === 'centipede'){
                    const segCount = tpl.segments || 8;
                    const segs = [];
                    for(let i=0;i<segCount;i++){
                        segs.push({ x: s.x - i*(size*0.9), y: s.y, radius: Math.max(6, Math.round(size*0.6)), hp: Math.max(6, Math.round(hp/segCount)), maxHp: Math.max(6, Math.round(hp/segCount)) });
                    }
                    mobs.push({ type: 'Centipede', name: tpl.name || 'Centipede', segments: segs, speed: speed, rarityIndex: rarityIndex, rarityName: rarityName, stationary: !!tpl.stationary, mass: 9999, vx:0, vy:0 });
                } else {
                    const mobObj = {x:s.x,y:s.y,radius:size,speed:speed,health:hp,maxHealth:hp,name:tpl.name,type:typeVal,projectiles:[],shootCooldown: shootCd,rarityIndex:rarityIndex,rarityName:rarityName,stationary:!!tpl.stationary, mass: Math.max(1, Math.round(size * (1 + rarityIndex*0.06))), vx:0, vy:0};
                    // apply mandible sprite and simple patrol for ant-like mobs
                    try{
                        const tv = (typeVal||'').toString().toLowerCase();
                        if(tv.indexOf('ant') >= 0){ mobObj.spriteKey = 'mandible'; mobObj.patrol = true; mobObj.patrolRange = tpl.patrolRange || 72; mobObj._patrolCenter = s.x; }
                    }catch(e){}
                    mobs.push(mobObj);
                }
            } else {
                const rIdx = s.rarityIndex; const rName = s.rarityName; const mult = s.multiplier; const choice = Math.random();
                if(choice<0.25) mobs.push({x:s.x,y:s.y,radius:Math.round(12 * (1 + rIdx*0.06)),speed:Math.max(0.2,1.5/(Math.max(1,mult*0.8))),health:Math.round(50*mult),maxHealth:Math.round(50*mult),name:"Ladybug",type:"Ladybug",projectiles:[],rarityIndex:rIdx,rarityName:rName,stationary:false, mass: Math.round(12 * (1 + rIdx*0.06)), vx:0, vy:0});
                else if(choice<0.5) mobs.push({x:s.x,y:s.y,radius:Math.round(10 * (1 + rIdx*0.06)),speed:Math.max(0.2,2/(Math.max(1,mult*0.8))),health:Math.round(30*mult),maxHealth:Math.round(30*mult),name:"Bee",type:"Bee",projectiles:[],rarityIndex:rIdx,rarityName:rName,stationary:false, mass: Math.round(10 * (1 + rIdx*0.06)), vx:0, vy:0});
                else if(choice<0.75) mobs.push({x:s.x,y:s.y,radius:Math.round(12 * (1 + rIdx*0.06)),speed:Math.max(0.2,1.2/(Math.max(1,mult*0.8))),health:Math.round(40*mult),maxHealth:Math.round(40*mult),name:"Hornet",type:"Hornet",projectiles:[],shootCooldown:120,spriteKey:'hornet',rarityIndex:rIdx,rarityName:rName,stationary:false, mass: Math.round(12 * (1 + rIdx*0.06)), vx:0, vy:0});
                else mobs.push({x:s.x,y:s.y,radius:Math.round(18 * (1 + rIdx*0.06)),speed:0,health:Math.round(30*mult),maxHealth:Math.round(30*mult),name:"Dandelion",type:"Dandelion",projectiles:[],rarityIndex:rIdx,rarityName:rName,stationary:true, mass: Math.round(18 * (1 + rIdx*0.06)), vx:0, vy:0});
            }
        }catch(e){ console.warn('spawn tick failed',e); }
    }, spacing);
}

// update & draw player projectiles
function updateProjectiles(){
    for(let i=projectiles.length-1;i>=0;i--){
        const p = projectiles[i];
        p.x += p.dx; p.y += p.dy;
        // remove off-screen
        if(p.x < -50 || p.x > viewWidth+50 || p.y < -50 || p.y > viewHeight+50){ projectiles.splice(i,1); }
    }
}

function drawProjectiles(){
    projectiles.forEach(p=>{
        if(p.type === 'Missile'){
            // draw isosceles triangle pointing along velocity
            const angle = Math.atan2(p.dy || 0, p.dx || 1);
            const len = Math.max(8, (p.radius||4) * 2.2);
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle);
            ctx.fillStyle = 'grey'; ctx.beginPath(); ctx.moveTo(len,0); ctx.lineTo(-len*0.4, -len*0.6); ctx.lineTo(-len*0.4, len*0.6); ctx.closePath(); ctx.fill();
            if(showHitboxes){ ctx.strokeStyle='red'; ctx.lineWidth=1; ctx.stroke(); }
            ctx.restore();
        } else {
            ctx.fillStyle = 'white';
            ctx.beginPath(); ctx.arc(p.x,p.y,p.radius||4,0,Math.PI*2); ctx.fill();
            if(showHitboxes){ ctx.strokeStyle='red'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(p.x,p.y,p.radius||4,0,Math.PI*2); ctx.stroke(); }
        }
    });
}

// --- PLAYER MOVEMENT ---
function movePlayer(){
    if(isDead) return;
    if(controlMode === 'mouse'){
        // follow mouse smoothly
        const dx = mouseX - player.x; const dy = mouseY - player.y; const dist = Math.hypot(dx,dy);
        if(dist > 2){ player.x += (dx/dist) * Math.min(player.speed, dist); player.y += (dy/dist) * Math.min(player.speed, dist); }
        return;
    }
    if(keys["ArrowUp"] || keys['w'] || keys['W']) player.y-=player.speed;
    if(keys["ArrowDown"] || keys['s'] || keys['S']) player.y+=player.speed;
    if(keys["ArrowLeft"] || keys['a'] || keys['A']) player.x-=player.speed;
    if(keys["ArrowRight"] || keys['d'] || keys['D']) player.x+=player.speed;
    player.x=Math.max(player.radius,Math.min(viewWidth-player.radius,player.x));
    player.y=Math.max(player.radius,Math.min(viewHeight-player.radius,player.y));
}

// --- PETALS ---
function updatePetals(){ if(!isDead) petals.forEach(p=>p.angle+=0.05); }

// Smoothly move petal distance toward target depending on hold state
function updatePetalDistance(){
    if(spaceHeld || mouseHeld){
        // immediate expand for responsiveness
        player.petalsDistance = player.petalsDistanceExpanded;
        return;
    }
    const target = player.petalsDistanceDefault;
    // lerp back faster
    player.petalsDistance += (target - player.petalsDistance) * 0.6;
}

// --- MOB MOVEMENT ---
function moveMobs(){
    if(isDead) return;
    mobs.forEach(mob=>{
        // compute angle from mob to player for facing/flip
        const angleToPlayer = Math.atan2((player.y || (viewHeight/2)) - (mob.y || 0), (player.x || (viewWidth/2)) - (mob.x || 0)) || 0;
        if(mob.stationary){
            // stationary mobs do not move, but their projectiles should still update
            if(mob.projectiles && mob.projectiles.length){ for(let i=0;i<mob.projectiles.length;i++){ const p = mob.projectiles[i]; p.x += p.dx; p.y += p.dy; } }
            return;
        }

        // patrol behavior (simple back-and-forth)
        if(mob.patrol){
            mob._patrolDir = mob._patrolDir || (Math.random()<0.5?-1:1);
            mob._patrolCenter = mob._patrolCenter || mob.x;
            mob.patrolRange = mob.patrolRange || 64;
            const now = Date.now();
            const wobble = Math.sin(now/300 + (mob._patrolPhase||0)) * 0.12;
            mob.x += mob._patrolDir * mob.speed * (1 + wobble);
            // reverse when exceeding range or hitting bounds
            if(mob.x < mob._patrolCenter - mob.patrolRange || mob.x > mob._patrolCenter + mob.patrolRange || mob.x < 8 || mob.x > viewWidth-8){ mob._patrolDir *= -1; }
            // animate mandible phase when moving
            mob._mandiblePhase = (mob._mandiblePhase || Math.random()*6) + 0.18;
            // update projectiles of patrolling mob
            if(mob.projectiles && mob.projectiles.length){ for(let i=0;i<mob.projectiles.length;i++){ const p = mob.projectiles[i]; p.x += p.dx; p.y += p.dy; } }
            return;
        }

        // segmented centipede movement handling
        if(mob && mob.segments && Array.isArray(mob.segments) && mob.segments.length){
            const segs = mob.segments;
            const head = segs[0];
            // target: player
            const tx = player.x || (viewWidth/2);
            const ty = player.y || (viewHeight/2);
            const dx = tx - head.x; const dy = ty - head.y; const dist = Math.hypot(dx,dy) || 0.0001;
            const speed = (mob.speed || 1) * (mob._speedMult || 1);
            head.vx = (head.vx||0) + (dx/dist) * speed * 0.3;
            head.vy = (head.vy||0) + (dy/dist) * speed * 0.3;
            if(head._impulse){ head.vx += head._impulse.x; head.vy += head._impulse.y; head._impulse = null; }
            head.x += head.vx; head.y += head.vy; head.vx *= 0.85; head.vy *= 0.85;

            for(let s = 1; s < segs.length; s++){
                const prev = segs[s-1]; const cur = segs[s];
                const desiredDist = (prev.radius || 6) + (cur.radius || 6) + 1;
                const vx = prev.x - cur.x; const vy = prev.y - cur.y; const d = Math.hypot(vx,vy) || 0.0001;
                const pull = Math.max(0, d - desiredDist);
                cur.x += (vx / d) * pull * 0.8; cur.y += (vy / d) * pull * 0.8;
                if(cur._impulse){ cur.x += cur._impulse.x; cur.y += cur._impulse.y; cur._impulse = null; }
            }
            // clamp to bounds
            for(const s of segs){ s.x = Math.max(0, Math.min(viewWidth, s.x)); s.y = Math.max(0, Math.min(viewHeight, s.y)); }
            return;
        }

        const t = (mob.type || mob.name || '').toString().toLowerCase();
        if(t === "hornet"){
            // Hornets maintain distance and shoot
            let dx = player.x - mob.x;
            let dy = player.y - mob.y;
            let dist = Math.hypot(dx,dy);
            let desiredDist = 200;
            if(dist>desiredDist){
                mob.x += (dx/dist)*mob.speed;
                mob.y += (dy/dist)*mob.speed;
            } else if(dist<desiredDist-50){
                mob.x -= (dx/dist)*mob.speed;
                mob.y -= (dy/dist)*mob.speed;
            }

            // Shooting cooldown (turn around briefly when firing)
            mob.shootCooldown = (mob.shootCooldown==null)?120:mob.shootCooldown - 1;
            if(mob.shootCooldown <= 0){
                // indicate a brief turn animation
                mob._turnUntil = Date.now() + 160;
                let angle = Math.atan2(player.y-mob.y, player.x-mob.x);
                mob.projectiles.push({x:mob.x,y:mob.y,dx:Math.cos(angle)*4,dy:Math.sin(angle)*4,radius:5,type:"Missile",damage:5});
                mob.shootCooldown = 120; // frames cooldown
            }
        } else {
            // species-specific chase/behavior
            let dx = player.x - mob.x;
            let dy = player.y - mob.y;
            let dist = Math.hypot(dx,dy);
            if(t === 'bee' || t === 'ladybug'){
                // Passive bees wander slowly until they become aggressive (player hit), then chase permanently
                if(mob._aggressive){
                    if(dist>0){ mob.x += (dx/dist)*mob.speed; mob.y += (dy/dist)*mob.speed; }
                } else {
                    mob._wanderDir = (typeof mob._wanderDir === 'number') ? mob._wanderDir : (Math.random()*Math.PI*2);
                    mob._wanderChangeAt = mob._wanderChangeAt || 0;
                    if(Date.now() > mob._wanderChangeAt){ mob._wanderDir += (Math.random()-0.5) * 1.2; mob._wanderChangeAt = Date.now() + 800 + Math.random()*1200; }
                    const step = Math.max(0.2, (mob.speed || 0.5) * 0.25);
                    mob.x += Math.cos(mob._wanderDir) * step;
                    mob.y += Math.sin(mob._wanderDir) * step;
                    // clamp to view bounds
                    mob.x = Math.max(8, Math.min(viewWidth-8, mob.x)); mob.y = Math.max(8, Math.min(viewHeight-8, mob.y));
                }
            } else if(t === 'spider'){
                // wander slowly, lunge occasionally
                if(!mob._lungeCd) mob._lungeCd = 60 + Math.floor(Math.random()*180);
                mob._lungeCd--;
                if(mob._lungeCd <= 0 && dist < 260){ mob.vx += (dx/dist) * 6; mob.vy += (dy/dist) * 6; mob._lungeCd = 160 + Math.floor(Math.random()*120); }
                // gentle friction movement
                mob.x += (mob.vx || 0) * 0.9; mob.y += (mob.vy || 0) * 0.9;
            } else if(t === 'ant'){
                // aggressive chaser with charge
                if(!mob._chargeCd) mob._chargeCd = 40 + Math.floor(Math.random()*120);
                mob._chargeCd--;
                if(mob._chargeCd <= 0 && dist < 220){ mob.vx += (dx/dist) * 10; mob.vy += (dy/dist) * 10; mob._chargeCd = 220; }
                if(dist>0){ mob.x += (dx/dist) * mob.speed * 1.4; mob.y += (dy/dist) * mob.speed * 1.4; }
                mob.x += (mob.vx || 0) * 0.85; mob.y += (mob.vy || 0) * 0.85;
            } else if(t === 'snail'){
                if(dist>0) { mob.x += (dx/dist) * mob.speed * 0.6; mob.y += (dy/dist) * mob.speed * 0.6; }
            } else {
                // default chase
                if(dist>0){ mob.x += (dx/dist)*mob.speed; mob.y += (dy/dist)*mob.speed; }
            }
        }

        // Move mob projectiles
        if(mob.projectiles && mob.projectiles.length){ for(let i=0;i<mob.projectiles.length;i++){ const p = mob.projectiles[i]; p.x += p.dx; p.y += p.dy; } }

        // apply velocity from external impulses (knockback) and damp it
        if(typeof mob.vx === 'number' && typeof mob.vy === 'number'){
            mob.x += mob.vx; mob.y += mob.vy;
            mob.vx *= 0.86; mob.vy *= 0.86;
            // small clamp so they don't drift infinitely
            if(Math.abs(mob.vx) < 0.01) mob.vx = 0;
            if(Math.abs(mob.vy) < 0.01) mob.vy = 0;
        }

        // Smooth facing animation: store a display angle that interpolates
        try{
            const playerAngle = Math.atan2((player.y || CENTER_Y) - (mob.y || 0), (player.x || CENTER_X) - (mob.x || 0));
            const tname = (mob.type || mob.name || '').toString().toLowerCase();
            let desired;
            // Bees (and ladybugs) should face the player only when aggressive;
            // when passive they should face their wander/movement direction instead.
            if(tname.includes('bee') || tname.includes('ladybug')){
                if(mob._aggressive){
                    desired = playerAngle;
                } else if(typeof mob._wanderDir === 'number'){
                    desired = mob._wanderDir;
                } else {
                    // fallback to current display angle or face away slightly for variety
                    desired = (typeof mob._displayAngle === 'number') ? mob._displayAngle : (playerAngle + Math.PI);
                }
            } else {
                // default behavior: face away unless currently turning to shoot
                desired = (mob._turnUntil && mob._turnUntil > Date.now()) ? playerAngle : (playerAngle + Math.PI);
            }

            // For bees and similar passive critters, snap display angle to wander
            // direction immediately when passive so the sprite orientation stays
            // aligned with movement (prevents laggy/backward-facing visuals).
            if((tname.includes('bee') || tname.includes('ladybug')) && !mob._aggressive && typeof mob._wanderDir === 'number'){
                mob._displayAngle = mob._wanderDir;
            } else {
                if(typeof mob._displayAngle !== 'number') mob._displayAngle = desired;
                let diff = desired - mob._displayAngle;
                while(diff > Math.PI) diff -= Math.PI * 2;
                while(diff < -Math.PI) diff += Math.PI * 2;
                const maxStep = (mob._turnUntil && mob._turnUntil > Date.now()) ? 0.14 : 0.05;
                const step = Math.max(-maxStep, Math.min(maxStep, diff));
                mob._displayAngle = mob._displayAngle + step;
            }
        }catch(e){}

    });

    // MOB ↔ MOB collision resolution (pairwise)
    for(let i=0;i<mobs.length;i++){
        for(let j=i+1;j<mobs.length;j++){
            const a = mobs[i];
            const b = mobs[j];
            const dx = b.x - a.x; const dy = b.y - a.y;
            const dist = Math.hypot(dx,dy);
            const minDist = (a.radius || 0) + (b.radius || 0);
            if(dist > 0 && dist < minDist){
                const overlap = minDist - dist;
                const nx = dx / dist; const ny = dy / dist;
                const am = a.mass || 1; const bm = b.mass || 1;
                const total = am + bm;
                // positional correction (separate them based on mass)
                const aMove = overlap * (bm / total) * 0.6;
                const bMove = overlap * (am / total) * 0.6;
                a.x -= nx * aMove; a.y -= ny * aMove;
                b.x += nx * bMove; b.y += ny * bMove;
                // convert overlap into velocity impulse
                const impulse = Math.max(0.6, overlap * 0.8);
                a.vx = (a.vx || 0) - nx * (impulse * (bm/total));
                a.vy = (a.vy || 0) - ny * (impulse * (bm/total));
                b.vx = (b.vx || 0) + nx * (impulse * (am/total));
                b.vy = (b.vy || 0) + ny * (impulse * (am/total));
            }
        }
    }
}

// Track mouse position for aiming
let mouseX = CENTER_X, mouseY = CENTER_Y;
canvas.addEventListener('mousemove', function(e){
    const r = canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left; mouseY = e.clientY - r.top;
});

// Attack: when player clicks on canvas, trigger on-attack petal effects
function performAttack(targetX, targetY){
    if(isDead) return;
    for(let i=0;i<player.equipped.length;i++){
        const slot = player.equipped[i];
        if(!slot) continue;
        const base = ITEM_TYPES[slot.type] || null;
        // define which items trigger on-attack
        const onAttackTypes = { Light: true, Missile: true, Stinger: true };
        if(!onAttackTypes[slot.type]) continue;
        // per-slot cooldown so multiple same-type equips can fire independently
        const now = Date.now();
        const cdKey = 'slot_' + i;
        const cooldown = base ? base.cooldown : 800;
        if(player.cooldowns[cdKey] && now - player.cooldowns[cdKey] < cooldown) continue;

        // compute petal position for this slot (use corresponding petal if exists)
        const petal = petals[i % petals.length];
        let sx = player.x, sy = player.y;
        if(petal){ sx = player.x + Math.cos(petal.angle) * player.petalsDistance; sy = player.y + Math.sin(petal.angle) * player.petalsDistance; }

        // spawn projectile towards target and expand corresponding petal
        const angle = Math.atan2(targetY - sy, targetX - sx);
        const damage = base ? base.damage : 1;
        projectiles.push({x: sx, y: sy, dx: Math.cos(angle)*6, dy: Math.sin(angle)*6, radius:6, type: slot.type, damage: damage});
        player.cooldowns[cdKey] = now;
        // animate petal outward briefly
        if(petal){ petal.expandUntil = Date.now() + 220; petal.expandExtra = 48; }
        // decrement stack but keep slot object (mark empty) so petal remains
        slot.stack = (slot.stack || 1) - 1;
        if(slot.stack <= 0){ slot.stack = 0; slot.empty = true; }
    }
    // refresh inventory UI
    if(window.renderInventory) window.renderInventory();
}

canvas.addEventListener('mousedown', function(e){
    if(e.button !== 0) return;
    // ensure clicks outside UI only (canvas captures anyway)
    const r = canvas.getBoundingClientRect();
    const tx = e.clientX - r.left; const ty = e.clientY - r.top;
    performAttack(tx, ty);
});

// --- COLLISIONS ---
function checkCollisions(){
    if(isDead) return;

    // clear per-frame debug flags
    player._debug = false;
    mobs.forEach(m=>{ m._debug = false; });

    for(let mi = mobs.length - 1; mi >= 0; mi--){
        const mob = mobs[mi];

        /* --- Player ↔ Mob collision (with i-frames) --- */
        try{
            let now = Date.now();
            // segmented mob: check against nearest segment
            if(mob && mob.segments && Array.isArray(mob.segments) && mob.segments.length){
                let nearest = null; let ni = -1; let nd = Infinity;
                for(let s=0;s<mob.segments.length;s++){ const seg = mob.segments[s]; const d = Math.hypot(player.x - seg.x, player.y - seg.y); if(d < nd){ nd = d; nearest = seg; ni = s; } }
                if(nearest && nd < player.radius + (nearest.radius || 6)){
                    mob._debug = true; player._debug = true;
                    const overlap = (player.radius + (nearest.radius || 6)) - nd;
                    if(nd > 0 && overlap > 0){
                        const nx = (player.x - nearest.x) / nd; const ny = (player.y - nearest.y) / nd;
                        const segMass = nearest.mass || (mob.mass? Math.max(1, (mob.mass / Math.max(1, mob.segments.length))) : 6);
                        const total = Math.max(0.0001, (player.mass || 1) + segMass);
                        const push = overlap * 0.6;
                        const pMove = push * ((segMass) / total); const mMove = push * ((player.mass || 1) / total);
                        player.x += nx * pMove; player.y += ny * pMove;
                        nearest.x -= nx * mMove; nearest.y -= ny * mMove;
                        player.vx = (player.vx || 0) + nx * ((segMass) / total) * 1.6; player.vy = (player.vy || 0) + ny * ((segMass) / total) * 1.6;
                        nearest._impulse = nearest._impulse || {x:0,y:0}; nearest._impulse.x -= nx * ((player.mass || 1) / total) * 1.6; nearest._impulse.y -= ny * ((player.mass || 1) / total) * 1.6;
                    }
                    if(now - player.lastHitTime > PLAYER_IFRAME_TIME){ const t = (mob.type || mob.name || '').toString().toLowerCase(); if(!player.godmode) player.health -= (t === 'bee' ? 1 : 0.5); player._hitFlash = Date.now(); if(window.COLLISION_LOGS) console.log('PLAYER HIT by', mob.name || mob.type, 'hp=', player.health); player.lastHitTime = now; }
                }
            } else {
                const distPM = Math.hypot(player.x - mob.x, player.y - mob.y);
                if(distPM < player.radius + mob.radius){
                    // mark debug flag so drawMobs can highlight
                    mob._debug = true; player._debug = true;
                    // apply separation / mass-based knockback regardless of i-frames so collisions push apart
                    const overlap = (player.radius + mob.radius) - distPM;
                    if(distPM > 0 && overlap > 0){
                        const nx = (player.x - mob.x) / distPM; const ny = (player.y - mob.y) / distPM;
                        const total = Math.max(0.0001, (player.mass || 1) + (mob.mass || 1)); const push = overlap * 0.6;
                        const pMove = push * ((mob.mass || 1) / total); const mMove = push * ((player.mass || 1) / total);
                        player.x += nx * pMove; player.y += ny * pMove; mob.x -= nx * mMove; mob.y -= ny * mMove;
                        player.vx = (player.vx || 0) + nx * ((mob.mass || 1) / total) * 1.6; player.vy = (player.vy || 0) + ny * ((mob.mass || 1) / total) * 1.6;
                        mob.vx = (mob.vx || 0) - nx * ((player.mass || 1) / total) * 1.6; mob.vy = (mob.vy || 0) - ny * ((player.mass || 1) / total) * 1.6;
                    }
                    if(now - player.lastHitTime > PLAYER_IFRAME_TIME){ const t = (mob.type || mob.name || '').toString().toLowerCase(); if(!player.godmode) player.health -= (t === 'bee') ? 1 : 0.5; player._hitFlash = Date.now(); if(window.COLLISION_LOGS) console.log('PLAYER HIT by', mob.name || mob.type, 'hp=', player.health, 'dist=', distPM.toFixed(1)); player.lastHitTime = now; }
                } else if(window.COLLISION_DEBUG && distPM < 300){ throttleLog('collision-near-'+(mob.name||mob.type), ()=> console.log('NEAR: mob=', mob.name||mob.type, 'dist=', distPM.toFixed(1), 'thresh=', (player.radius+mob.radius).toFixed(1)), 600); }
            }
        }catch(e){ }

        /* --- Petals ↔ Mob collision (cooldown based) --- */
        mob.lastPetalHit = mob.lastPetalHit || {};
        for(let pi = 0; pi < petals.length; pi++){
            const p = petals[pi];
            const px = player.x + Math.cos(p.angle) * player.petalsDistance;
            const py = player.y + Math.sin(p.angle) * player.petalsDistance;
            // segmented mobs: check each segment
            if(mob && mob.segments && Array.isArray(mob.segments) && mob.segments.length){
                for(let si = 0; si < mob.segments.length; si++){
                    const seg = mob.segments[si];
                    const distPetal = Math.hypot(px - seg.x, py - seg.y);
                    if(distPetal < (p.radius || 6) + (seg.radius || 6)){
                        const key = `petal_${pi}_seg_${si}`;
                        const now = Date.now();
                        if(!mob.lastPetalHit[key] || now - mob.lastPetalHit[key] > PETAL_HIT_COOLDOWN){
                            seg.hp = (seg.hp || seg.maxHp || 1) - 0.5; seg._hitFlash = Date.now();
                            if(window.COLLISION_LOGS) throttleLog('mob-petal-'+(mob.name||mob.type), ()=> console.log('MOB SEG HIT by petal', mob.name || mob.type, 'seg=', si, 'hp=', seg.hp), 80);
                            mob.lastPetalHit[key] = now;
                            if(seg.hp <= 0){
                                const wasHead = (si === 0);
                                mob.segments.splice(si,1);
                                if(wasHead){ try{ mob._headPromoteUntil = Date.now() + 600; if(mob.segments && mob.segments[0]){ mob.segments[0]._impulse = mob.segments[0]._impulse || {x:0,y:0}; mob.segments[0]._impulse.x += 2; } }catch(e){} }
                            }
                        }
                    }
                }
            } else {
                const distPetal = Math.hypot(px - mob.x, py - mob.y);
                if(distPetal < (p.radius || 6) + mob.radius){
                    const key = `petal_${pi}`;
                    const now = Date.now();
                    if(!mob.lastPetalHit[key] || now - mob.lastPetalHit[key] > PETAL_HIT_COOLDOWN){
                        mob.health -= 0.5;
                        mob._hitFlash = Date.now();
                        // bees become permanently aggressive when hit
                        try{ const tn = (mob.type || mob.name || '').toString().toLowerCase(); if(tn.includes('bee')) mob._aggressive = true; }catch(e){}
                        if(window.COLLISION_LOGS) throttleLog('mob-petal-'+(mob.name||mob.type), ()=> console.log('MOB HIT by petal', mob.name || mob.type, 'hp=', mob.health), 80);
                        mob.lastPetalHit[key] = now;
                    }
                }
            }
        }

        /* --- Mob projectiles ↔ Player --- */
        if(mob.projectiles){
            for(let pi = mob.projectiles.length - 1; pi >= 0; pi--){
                const p = mob.projectiles[pi];
                const d = Math.hypot(player.x - p.x, player.y - p.y);
                if(d < player.radius + (p.radius || 4)){
                    if(!player.godmode) player.health -= (p.damage || 1);
                    player._hitFlash = Date.now();
                    if(window.COLLISION_LOGS) throttleLog('player-proj-'+(p.type||''), ()=> console.log('PLAYER HIT by projectile', p.type || '', 'hp=', player.health), 250);
                    // apply projectile->player knockback
                    const pm = p.mass || 0.6;
                    const nx = (player.x - p.x) / Math.max(0.0001, d);
                    const ny = (player.y - p.y) / Math.max(0.0001, d);
                    player.vx = (player.vx || 0) + nx * (pm / player.mass) * 8;
                    player.vy = (player.vy || 0) + ny * (pm / player.mass) * 8;
                    mob.projectiles.splice(pi, 1);
                }
            }
        }

        /* --- Ant Burrow: spawn ants as it takes damage (every 15% damage) --- */
        try{
            const tname = (mob.name || mob.type || '').toString().toLowerCase();
            if(tname.indexOf('ant') >= 0 && tname.indexOf('burrow') >= 0){
                mob._lastHp = mob._lastHp || mob.maxHealth || 1;
                const dmg = Math.max(0, mob._lastHp - (mob.health || 0));
                if(dmg > 0){
                    mob._antAccum = (mob._antAccum || 0) + dmg;
                    const pct = (mob._antAccum || 0) / (mob.maxHealth || 1);
                    const spawnCount = Math.floor(pct / 0.15);
                    if(!mob._antSpawnedTicks) mob._antSpawnedTicks = 0;
                    while(spawnCount > mob._antSpawnedTicks){
                        // spawn 2 ants and 1 worker near the burrow
                        try{
                            const cfg = (window.ZEPHYRAX_CONFIG && window.ZEPHYRAX_CONFIG.mobs) ? window.ZEPHYRAX_CONFIG.mobs : null;
                            const antTpl = cfg ? cfg.find(x=> (x.id==='ant' || x.name.toLowerCase()==='worker ant' || x.name.toLowerCase()==='ant')) : null;
                            const workerTpl = cfg ? cfg.find(x=> x.id==='ant' || x.name.toLowerCase().includes('worker')) : antTpl;
                            for(let s=0;s<2;s++){
                                const ax = mob.x + (Math.random()*40 - 20);
                                const ay = mob.y + (Math.random()*40 - 20);
                                const rIdx = 0; const mult = 1;
                                const hp = antTpl ? Math.max(6, Math.round((antTpl.baseHP||30) * mult)) : 30;
                                const spd = antTpl ? (antTpl.baseSpeed || 1.6) : 1.2;
                                mobs.push({x:ax,y:ay,radius:Math.round(10),speed:spd,health:hp,maxHealth:hp,name:'Ant',type:'ant',projectiles:[],rarityIndex:0,rarityName:'Common',stationary:false, mass:10, vx:0, vy:0, spriteKey:'mandible', patrol:true, patrolRange:64, _patrolCenter: mob.x});
                            }
                            // one worker
                            const wx = mob.x + (Math.random()*40 - 20); const wy = mob.y + (Math.random()*40 - 20);
                            mobs.push({x:wx,y:wy,radius:Math.round(12),speed:(workerTpl?workerTpl.baseSpeed||1.2:1.0),health:(workerTpl?workerTpl.baseHP||40:40),maxHealth:(workerTpl?workerTpl.baseHP||40:40),name:'Worker Ant',type:'worker-ant',projectiles:[],rarityIndex:0,rarityName:'Common',stationary:false, mass:12, vx:0, vy:0});
                        }catch(e){}
                        mob._antSpawnedTicks++;
                    }
                }
                mob._lastHp = mob.health || 0;
            }
        }catch(e){}

        /* --- Mob death --- */
        if(mob.health <= 0){
            if(window.COLLISION_LOGS) throttleLog('mob-died-'+(mob.name||mob.type), ()=> console.log('MOB DIED', mob.name || mob.type), 500);
            // special ant-burrow death spawns
            try{
                const tname = (mob.name || mob.type || '').toString().toLowerCase();
                if(tname.indexOf('ant') >= 0 && tname.indexOf('burrow') >= 0){
                    // spawn 3 ants, 2 workers, 1 baby, 1 queen
                    const cfg = (window.ZEPHYRAX_CONFIG && window.ZEPHYRAX_CONFIG.mobs) ? window.ZEPHYRAX_CONFIG.mobs : null;
                    const antTpl = cfg ? cfg.find(x=> x.id==='ant' || x.name.toLowerCase()==='worker ant' || x.name.toLowerCase()==='ant') : null;
                    const workerTpl = cfg ? cfg.find(x=> x.id==='soldier-ant' || x.name.toLowerCase().includes('worker')) : antTpl;
                    const queenTpl = cfg ? cfg.find(x=> x.id==='queen-ant' || x.name.toLowerCase().includes('queen')) : null;
                    for(let i=0;i<3;i++){ mobs.push({x:mob.x + (Math.random()*80-40), y:mob.y + (Math.random()*80-40), radius:10, speed: antTpl?(antTpl.baseSpeed||1.6):1.2, health: antTpl?(antTpl.baseHP||30):30, maxHealth: antTpl?(antTpl.baseHP||30):30, name:'Ant', type:'ant', projectiles:[], rarityIndex:0, rarityName:'Common', stationary:false, mass:10, vx:0, vy:0, spriteKey:'mandible', patrol:true, patrolRange:64, _patrolCenter: mob.x}); }
                    for(let i=0;i<2;i++){ mobs.push({x:mob.x + (Math.random()*90-45), y:mob.y + (Math.random()*90-45), radius:12, speed: workerTpl?(workerTpl.baseSpeed||1.2):1.0, health: workerTpl?(workerTpl.baseHP||40):40, maxHealth: workerTpl?(workerTpl.baseHP||40):40, name:'Worker Ant', type:'worker-ant', projectiles:[], rarityIndex:0, rarityName:'Common',stationary:false, mass:12, vx:0, vy:0}); }
                    // baby
                    mobs.push({x:mob.x + 6, y:mob.y + 6, radius:8, speed:0.6, health:18, maxHealth:18, name:'Baby Ant', type:'baby-ant', projectiles:[], rarityIndex:0, rarityName:'Common',stationary:false, mass:6, vx:0, vy:0});
                    // queen
                    mobs.push({x:mob.x - 12, y:mob.y - 12, radius:22, speed:1.0, health:240, maxHealth:240, name:'Queen Ant', type:'queen-ant', projectiles:[], rarityIndex:2, rarityName:'Rare',stationary:false, mass:24, vx:0, vy:0});
                }
            }catch(e){}
            spawnMobDrops(mob);
            mobs.splice(mi, 1);
        }
    }

    /* --- Player projectiles ↔ Mobs (single-hit safe) --- */
    for(let pi = projectiles.length - 1; pi >= 0; pi--){
        const proj = projectiles[pi];
        let hit = false;

        for(let mi = mobs.length - 1; mi >= 0; mi--){
            const mob = mobs[mi];

            // segmented centipede: check per-segment collisions
            if(mob && mob.segments && Array.isArray(mob.segments) && mob.segments.length){
                for(let si = mob.segments.length - 1; si >= 0; si--){
                    const seg = mob.segments[si];
                    const d = Math.hypot(seg.x - proj.x, seg.y - proj.y);
                    if(d < (seg.radius || 6) + (proj.radius || 4)){
                        // damage this segment
                        seg.hp = (seg.hp || seg.maxHp || (proj.damage||1)) - (proj.damage || 1);
                        hit = true;
                        // small impulse to nearby segments
                        seg._impulse = seg._impulse || {x:0,y:0}; seg._impulse.x += (proj.dx||0)*0.5; seg._impulse.y += (proj.dy||0)*0.5;
                        // remove segment if dead
                        if(seg.hp <= 0){
                            const wasHead = (si === 0);
                            mob.segments.splice(si,1);
                            if(wasHead){ try{ mob._headPromoteUntil = Date.now() + 600; if(mob.segments && mob.segments[0]){ mob.segments[0]._impulse = mob.segments[0]._impulse || {x:0,y:0}; mob.segments[0]._impulse.x += 2; } }catch(e){} }
                        }
                        break;
                    }
                }
                // if no segments left, kill mob
                if(mob.segments.length === 0){ spawnMobDrops(mob); mobs.splice(mi,1); }
                if(hit) break;
                continue;
            }

            // normal mob collision
            const d = Math.hypot(mob.x - proj.x, mob.y - proj.y);
            if(d < mob.radius + (proj.radius || 4)){
                mob.health -= (proj.damage || 1);
                hit = true;

                    // apply projectile momentum to mob (knockback proportional to proj.mass)
                    const pm = proj.mass || 0.5;
                    const mm = mob.mass || 1;
                    const nx = (mob.x - proj.x) / Math.max(0.0001, d);
                    const ny = (mob.y - proj.y) / Math.max(0.0001, d);
                    mob.vx = (mob.vx || 0) + nx * (pm / mm) * 6;
                    mob.vy = (mob.vy || 0) + ny * (pm / mm) * 6;

                // when hit by a player projectile, bees become permanently aggressive
                try{ const tn = (mob.type || mob.name || '').toString().toLowerCase(); if(tn.includes('bee')) mob._aggressive = true; }catch(e){}
                if(mob.health <= 0){
                    spawnMobDrops(mob);
                    mobs.splice(mi, 1);
                }
                break;
            }
        }

        if(hit) projectiles.splice(pi, 1);
    }

    /* --- Drop pickup (true circular collision) --- */
    drops = drops.filter(drop => {
        const d = Math.hypot(player.x - drop.x, player.y - drop.y);
        if(d < player.radius + drop.radius){
            // when picking up a drop, add it to inventory and persist state
            addToInventory(drop.type, drop.rarity || 'Common', drop.stack || 1);
            try{ savePlayerState(); }catch(e){}
            return false;
        }
        return true;
    });

    /* --- Death check --- */
    if(player.health <= 0 && !isDead){
        isDead = true;
        onDeath();
    }

    // Only spawn the next wave if there isn't already a spawn interval pending.
    // This avoids repeatedly calling spawnWave every frame while mobs.length === 0
    // before the first spawned mob appears (which would rapidly advance waves).
    if(!isDead && mobs.length === 0 && !window._spawnInterval){
        spawnWave(currentWave++);
    }
}

// --- ITEM USAGE ---
document.addEventListener('keydown', e=>{
    if(e.key.toLowerCase()==='e'){
        if(isDead) return;
        // cycle through equipped slots so each press uses the next slot (rotation-friendly)
        const startIndex = nextEquipIndex % player.equipped.length;
        for(let offset=0; offset<player.equipped.length; offset++){
            const i = (startIndex + offset) % player.equipped.length;
            const slot = player.equipped[i];
            if(!slot) continue;
            // allow default behavior for unknown types
            const base = ITEM_TYPES[slot.type] || null;
            const now = Date.now();
            const cooldown = base ? base.cooldown : 900;
            if(!player.cooldowns[slot.type] || now - player.cooldowns[slot.type] >= cooldown){
                // compute firing position using petals angles - map equip index to a petal index
                const petalIndex = i % petals.length;
                let sx = player.x, sy = player.y;
                if(petals[petalIndex]){
                    sx = player.x + Math.cos(petals[petalIndex].angle) * player.petalsDistance;
                    sy = player.y + Math.sin(petals[petalIndex].angle) * player.petalsDistance;
                }
                if(slot.type === 'Rose' && base){
                    player.health = Math.min(player.maxHealth, player.health + base.heal);
                } else {
                    const angle = Math.atan2(0,1); // shoot to the right by default
                    const damage = base ? base.damage : (slot.rarity==='Rare'?4:(slot.rarity==='Epic'?8:(slot.rarity==='Legendary'?16:2)));
                    projectiles.push({x: sx, y: sy, dx: Math.cos(angle)*6, dy: Math.sin(angle)*6, radius:6, type: slot.type, damage: damage});
                }
                // consume one
                slot.stack = (slot.stack || 1) - 1;
                player.cooldowns[slot.type] = now;
                if(slot.stack <= 0){ slot.stack = 0; slot.empty = true; slot.type = null; }
                try{ savePlayerState(); }catch(e){}
                nextEquipIndex = i + 1;
                break;
            }
        }
    }
});

// Rendering helpers for UI modals
function renderInventory(){
    const grid = document.getElementById('invGrid');
    let slots = document.getElementById('equipSlots');
    if(!grid) return;
    // create equipSlots area if it doesn't exist (inventory layout changed)
    if(!slots){
        slots = document.createElement('div');
        slots.id = 'equipSlots';
        slots.style.display = 'flex';
        slots.style.flexWrap = 'wrap';
        slots.style.gap = '6px';
        slots.style.padding = '8px';
        slots.style.background = 'rgba(255,255,255,0.06)';
        slots.style.borderRadius = '6px';
        const invModal = document.getElementById('inventoryModal');
        if(invModal) invModal.appendChild(slots);
    }
    const query = (document.getElementById('invSearch')||{}).value || '';
    const sort = (document.getElementById('invSort')||{}).value || 'type';
    // simple copy of inventory sorted/filtered
    let items = player.inventory.slice();
    if(query) items = items.filter(it=>it.type.toLowerCase().includes(query.toLowerCase()));
    if(sort==='rarity') items.sort((a,b)=> (a.rarity||'')>=(b.rarity||'')?1:-1); else items.sort((a,b)=> a.type.localeCompare(b.type));

    grid.innerHTML='';
    if(items.length===0) grid.innerHTML='<div style="opacity:0.6">No items</div>';
    items.forEach((it,idx)=>{
        const d = document.createElement('div');
        d.style.display='inline-block'; d.style.width='56px'; d.style.height='56px'; d.style.margin='6px'; d.style.background='#fff'; d.style.border='2px solid #ccc'; d.style.borderRadius='6px'; d.style.position='relative'; d.style.cursor='pointer';
        d.dataset.idx = idx;
        // apply rarity color
        const rarity = (it.rarity||'Common');
        const rarityColors = { Common:'#d8f4d8', Unusual:'#fff7c2', Rare:'#2b4b9a', Epic:'#cdb3ff', Legendary:'#ffb3b3' };
        const rc = rarityColors[rarity] || '#fff';
        d.style.borderColor = rc;
        const def = (window.PETAL_DEFS && (window.PETAL_DEFS[it.type] || window.PETAL_DEFS[(it.type||'').toLowerCase()])) || null;
        const label = def && (def.name || def.id) ? (def.name || def.id) : it.type;
        const iconURL = getPetalIconURL(it.type, it.rarity||'Common', 36);
        d.innerHTML = `<img src="${iconURL}" style="width:34px;height:34px;display:block;margin:4px auto 0;border-radius:8px"/><div style=\"font-size:11px;text-align:center;margin-top:2px\">${label}</div><div style=\"position:absolute;right:4px;bottom:4px;font-weight:700;background:rgba(0,0,0,0.6);color:#fff;padding:2px 6px;border-radius:10px;\">${it.stack}x</div>`;
        d.draggable = true;
        d.title = (def && def.description) ? `${label} - ${def.description} (${it.rarity||'Common'}) x${it.stack}` : `${it.type} (${it.rarity||'Common'}) x${it.stack}`;
        d.dataset.type = it.type; d.dataset.rarity = it.rarity || 'Common';
        // color the icon background by rarity for better visual cue
        try{ const bg = RARITY_COLOR[it.rarity || 'Common'] || '#ddd'; const img = d.querySelector('img'); if(img) img.style.background = bg; }catch(e){}
        d.addEventListener('dragstart', (ev)=>{
            try{ ev.dataTransfer.setData('text/plain', JSON.stringify({type:it.type,rarity:it.rarity||'Common'})); }catch(e){}
        });
        d.addEventListener('click', (ev)=>{
            // equip item: remove one from inventory and put into first empty equip slot
            const globalIdx = player.inventory.indexOf(it);
            if(globalIdx===-1) return;
            // auto-place: prefer main row, if full put into swap row; if both full do nothing
            const emptyMain = player.equipped.findIndex(s=>!s);
            if(emptyMain !== -1){
                player.equipped[emptyMain] = {type:it.type,rarity:it.rarity,stack:1, empty:false};
                try{ applyOnEquip(emptyMain, false); }catch(e){}
            } else {
                const emptySwap = player.swap.findIndex(s=>!s);
                if(emptySwap !== -1){
                    player.swap[emptySwap] = {type:it.type,rarity:it.rarity,stack:1, empty:false};
                    try{ applyOnEquip(emptySwap, true); }catch(e){}
                } else {
                    // both rows full -> do nothing (no popup)
                    return;
                }
            }
            try{ savePlayerState(); }catch(e){}
            it.stack--; if(it.stack<=0) player.inventory.splice(globalIdx,1);
            refreshPetals();
            renderInventory();
            // reflect immediately in hotbar UI
            try{ updateHotbarUI(); }catch(e){}
            try{ if(typeof runEquipHooks === 'function') runEquipHooks(); }catch(e){}
        });
        grid.appendChild(d);
    });

    // render equipped slots (10 slots)
    slots.innerHTML = '';
    for(let si=0; si<10; si++){
        const s = player.equipped[si] || null;
        const sd = document.createElement('div'); sd.style.width='48px'; sd.style.height='48px'; sd.style.border='2px solid rgba(0,0,0,0.12)'; sd.style.display='flex'; sd.style.alignItems='center'; sd.style.justifyContent='center'; sd.style.background='rgba(255,255,255,0.06)'; sd.style.borderRadius='8px'; sd.style.cursor='pointer'; sd.style.margin='4px';
        if(s){
            const def = (window.PETAL_DEFS && (window.PETAL_DEFS[s.type] || window.PETAL_DEFS[(s.type||'').toLowerCase()])) || null;
            const label = def && (def.name||def.id) ? (def.name||def.id) : s.type;
            const icon = document.createElement('img'); icon.src = getPetalIconURL(s.type, s.rarity||'Common', 28); icon.style.width='28px'; icon.style.height='28px'; icon.style.display='block'; icon.style.margin='2px auto 0'; icon.style.borderRadius='6px';
            try{ icon.style.background = RARITY_COLOR[s.rarity||'Common'] || '#ddd'; }catch(e){}
            sd.appendChild(icon);
            const lbl = document.createElement('div'); lbl.style.fontSize='11px'; lbl.style.textAlign='center'; lbl.textContent = label; sd.appendChild(lbl);
            sd.title = (def && def.description) ? `${label} - ${def.description} (${s.rarity||'Common'}) x${s.stack||1}` : ((s.rarity||'Common') + ' x' + (s.stack||1));
            try{ sd.dataset.type = def && (def.id||def.name) ? (def.id||def.name) : s.type; sd.dataset.rarity = s.rarity || 'Common'; }catch(e){}
            sd.addEventListener('click', ()=>{ try{ applyOnUnequip(si, false); }catch(e){} addToInventory(s.type,s.rarity, (s.stack||1)); player.equipped[si] = null; try{ savePlayerState(); }catch(e){} refreshPetals(); renderInventory(); updateHotbarUI(); try{ if(typeof runEquipHooks === 'function') runEquipHooks(); }catch(e){} });
        } else { sd.textContent = ''; }
        slots.appendChild(sd);
    }
    // also render main equip area in the center of the start screen if present
    const main = document.getElementById('mainEquip');
    if(main){
        main.innerHTML = '';
        for(let si=0; si<10; si++){
            const s = player.equipped[si] || null;
            const md = document.createElement('div'); md.className='slot'; md.style.opacity = s? (s.empty? '0.35' : '1') : '0.35';
            md.style.width='52px'; md.style.height='52px'; md.dataset.slot = si;
            if(s){
                    const def = (window.PETAL_DEFS && (window.PETAL_DEFS[s.type] || window.PETAL_DEFS[(s.type||'').toLowerCase()])) || null;
                    const label = def && (def.name||def.id) ? (def.name||def.id) : s.type;
                    const icon = document.createElement('img'); icon.src = getPetalIconURL(s.type, s.rarity||'Common', 36); icon.style.width='34px'; icon.style.height='34px'; icon.style.display='block'; icon.style.margin='2px auto 0'; icon.style.borderRadius='6px';
                    try{ icon.style.background = RARITY_COLOR[s.rarity||'Common'] || '#ddd'; }catch(e){}
                    md.appendChild(icon);
                    const lbl = document.createElement('div'); lbl.style.fontSize='12px'; lbl.style.textAlign='center'; lbl.textContent = label; md.appendChild(lbl);
                    md.title = (def && def.description) ? `${label} - ${def.description} (${s.rarity||'Common'}) x${s.stack||1}` : ((s.rarity||'Common') + ' x' + (s.stack||1));
                    try{ md.dataset.type = def && (def.id||def.name) ? (def.id||def.name) : s.type; md.dataset.rarity = s.rarity || 'Common'; }catch(e){}
                    md.addEventListener('click', ()=>{ try{ applyOnUnequip(si, false); }catch(e){} addToInventory(s.type,s.rarity, (s.stack||1)); player.equipped[si] = null; try{ savePlayerState(); }catch(e){} refreshPetals(); renderInventory(); updateHotbarUI(); try{ if(typeof runEquipHooks === 'function') runEquipHooks(); }catch(e){} });
            } else { md.textContent = ''; }
            main.appendChild(md);
        }
    }
}

// Update the viewport hotbar DOM to reflect `player.equipped` and `player.swap`.
function updateHotbarUI(){
    const root = document.getElementById('HOTBAR_ROOT');
    if(!root) return;
    const main = root.querySelector('#hotbarMain');
    const swap = root.querySelector('#hotbarSwap');
    if(main){
        for(let i=0;i<10;i++){
            const el = main.children[i];
            const s = player.equipped[i];
            if(!el) continue;
            el.innerHTML = '';
            if(s && s.type && !s.empty){
                const def = (window.PETAL_DEFS && (window.PETAL_DEFS[s.type] || window.PETAL_DEFS[(s.type||'').toLowerCase()])) || null;
                const label = def && (def.name||def.id) ? (def.name||def.id) : s.type;
                    const icon = document.createElement('img'); icon.src = getPetalIconURL(s.type, s.rarity||'Common', 28); icon.style.width='28px'; icon.style.height='28px'; icon.style.display='block'; icon.style.margin='2px auto 0'; icon.style.borderRadius='6px';
                    try{ icon.style.background = RARITY_COLOR[s.rarity||'Common'] || '#ddd'; }catch(e){}
                    el.appendChild(icon);
                    const lbl = document.createElement('div'); lbl.style.fontSize='11px'; lbl.style.textAlign='center'; lbl.textContent = label; el.appendChild(lbl);
                    el.title = def && def.description ? `${label} - ${def.description}` : `${s.type} (${s.rarity||'Common'})`;
                    // expose data attributes for tooltip delegation
                    try{ if(def && (def.id || def.name)) el.dataset.type = def.id || def.name; else el.dataset.type = s.type; el.dataset.rarity = s.rarity || 'Common'; }catch(e){}
                // color by rarity when available
                try{ const rarityColors = { Common:'#d8f4d8', Unusual:'#fff7c2', Rare:'#2b4b9a', Epic:'#cdb3ff', Legendary:'#ffb3b3' }; el.style.borderColor = rarityColors[s.rarity||'Common'] || ''; }catch(e){}
            }
        }
    }
    if(swap){
        for(let i=0;i<10;i++){
            const el = swap.children[i];
            const s = player.swap[i];
            if(!el) continue;
            el.innerHTML = '';
            if(s && s.type && !s.empty){
                const def = (window.PETAL_DEFS && (window.PETAL_DEFS[s.type] || window.PETAL_DEFS[(s.type||'').toLowerCase()])) || null;
                const label = def && (def.name||def.id) ? (def.name||def.id) : s.type;
                const icon = document.createElement('img'); icon.src = getPetalIconURL(s.type, s.rarity||'Common', 24); icon.style.width='24px'; icon.style.height='24px'; icon.style.display='block'; icon.style.margin='2px auto 0'; icon.style.borderRadius='6px';
                try{ icon.style.background = RARITY_COLOR[s.rarity||'Common'] || '#ddd'; }catch(e){}
                el.appendChild(icon);
                const lbl = document.createElement('div'); lbl.style.fontSize='10px'; lbl.style.textAlign='center'; lbl.textContent = label; el.appendChild(lbl);
                el.title = def && def.description ? `${label} - ${def.description}` : `${s.type} (${s.rarity||'Common'})`;
                try{ if(def && (def.id || def.name)) el.dataset.type = def.id || def.name; else el.dataset.type = s.type; el.dataset.rarity = s.rarity || 'Common'; }catch(e){}
                try{ const rarityColors = { Common:'#d8f4d8', Unusual:'#fff7c2', Rare:'#2b4b9a', Epic:'#cdb3ff', Legendary:'#ffb3b3' }; el.style.borderColor = rarityColors[s.rarity||'Common'] || ''; }catch(e){}
            }
        }
    }
}

// Keybinds: pressing 1-9 or 0 will swap the main <-> swap slot at that index
document.addEventListener('keydown', function(ev){
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
    const key = ev.key;
    if(!key) return;
    let idx = null;
    if(key === '0') idx = 10; else if(/^[1-9]$/.test(key)) idx = parseInt(key,10);
    if(!idx) return;
    // 1-based to 0-based index
    const i = idx - 1;
    // swap main <-> swap
    const a = player.equipped[i];
    const b = player.swap[i];
    player.equipped[i] = b;
    player.swap[i] = a;
    try{ savePlayerState(); }catch(e){}
    refreshPetals(); updateHotbarUI(); if(window.renderInventory) window.renderInventory();
    try{ if(typeof runEquipHooks === 'function') runEquipHooks(); }catch(e){}
});

// Attach drag/drop & click handlers to the hotbar when it appears in the DOM.
function attachHotbarListeners(){
    const root = document.getElementById('HOTBAR_ROOT');
    if(!root) return;
    // ensure we only attach once
    if(root._listenersAttached) return; root._listenersAttached = true;

    root.addEventListener('dragover', function(ev){ ev.preventDefault(); });
    root.addEventListener('drop', function(ev){
        ev.preventDefault();
        try{
            const txt = ev.dataTransfer.getData('text/plain');
            if(!txt) return;
            const payload = JSON.parse(txt);
            const slot = ev.target.closest('.hotbar-slot');
            if(!slot) return;
            const isSwap = slot.hasAttribute('data-hot-swap');
            const idx = parseInt(isSwap ? slot.getAttribute('data-hot-swap') : slot.getAttribute('data-hot'), 10) - 1;
            if(Number.isNaN(idx) || idx < 0) return;

            // If dragging from another hotbar slot -> swap/move between slots
            if(payload && payload.fromHot){
                const srcIndex = payload.index;
                const srcIsSwap = !!payload.isSwap;
                if(typeof srcIndex !== 'number') return;
                // get references
                const srcArr = srcIsSwap ? player.swap : player.equipped;
                const dstArr = isSwap ? player.swap : player.equipped;
                // perform swap
                const tmp = dstArr[idx];
                dstArr[idx] = srcArr[srcIndex];
                srcArr[srcIndex] = tmp;
                try{ savePlayerState(); }catch(e){}
                refreshPetals(); updateHotbarUI(); if(window.renderInventory) window.renderInventory();
                try{ if(typeof runEquipHooks === 'function') runEquipHooks(); }catch(e){}
                return;
            }

            // Otherwise, payload is an inventory item -> equip into target
            const invIdx = player.inventory.findIndex(it=> it.type === payload.type && (it.rarity||'Common') === (payload.rarity||'Common'));
            if(invIdx === -1) return;
            if(isSwap){ player.swap[idx] = { type: payload.type, rarity: payload.rarity||'Common', stack: 1, empty:false }; }
            else { player.equipped[idx] = { type: payload.type, rarity: payload.rarity||'Common', stack: 1, empty:false }; }
            player.inventory[invIdx].stack--; if(player.inventory[invIdx].stack <= 0) player.inventory.splice(invIdx,1);
            try{ savePlayerState(); }catch(e){}
            try{ applyOnEquip(idx, isSwap); }catch(e){}
            refreshPetals(); updateHotbarUI(); if(window.renderInventory) window.renderInventory();
            try{ if(typeof runEquipHooks === 'function') runEquipHooks(); }catch(e){}
        }catch(e){}
    });

    // ensure each hotbar-slot is draggable and sends a source payload when dragged
    const slotEls = Array.from(root.querySelectorAll('.hotbar-slot'));
    slotEls.forEach(slot => {
        try{ slot.draggable = true; }catch(e){}
        slot.addEventListener('dragstart', function(ev){
            const isSwap = slot.hasAttribute('data-hot-swap');
            const idx = parseInt(isSwap ? slot.getAttribute('data-hot-swap') : slot.getAttribute('data-hot'), 10) - 1;
            if(Number.isNaN(idx) || idx < 0) return;
            const payload = { fromHot: true, index: idx, isSwap: !!isSwap };
            try{ ev.dataTransfer.setData('text/plain', JSON.stringify(payload)); }catch(e){}
        });
    });

    // click handler on hotbar slots: swap the clicked slot with its paired slot (main <-> swap)
    root.addEventListener('click', function(ev){
        const slot = ev.target.closest('.hotbar-slot');
        if(!slot) return;
        const isSwap = slot.hasAttribute('data-hot-swap');
        const idx = parseInt(isSwap ? slot.getAttribute('data-hot-swap') : slot.getAttribute('data-hot'), 10) - 1;
        if(Number.isNaN(idx) || idx < 0) return;

        // determine source and destination arrays
        const srcArr = isSwap ? player.swap : player.equipped;
        const dstArr = isSwap ? player.equipped : player.swap; // paired slot

        // perform swap/move: always swap values (can be null)
        const tmp = dstArr[idx];
        dstArr[idx] = srcArr[idx];
        srcArr[idx] = tmp;

        try{ savePlayerState(); }catch(e){}
        refreshPetals(); updateHotbarUI(); if(window.renderInventory) window.renderInventory();
        try{ if(typeof runEquipHooks === 'function') runEquipHooks(); }catch(e){}
    });
}

// poll for hotbar root and attach listeners (runs until attached)
const _hotbarPoll = setInterval(()=>{ try{ attachHotbarListeners(); updateHotbarUI(); if(document.getElementById('HOTBAR_ROOT') && document.getElementById('HOTBAR_ROOT')._listenersAttached){ clearInterval(_hotbarPoll); } }catch(e){} }, 200);

// craft UI removed: replaced by simple `#craftPanel` in index.html

// doCraftAction removed

// Update preview, chance display, and craft button enabled state
// updateCraftUI removed

// small transient toast inside craft modal
// showCraftToast removed

function renderSeen(){
    const out = document.getElementById('seenContent'); if(!out) return; out.innerHTML='';
    const keys = Object.keys(player.seenMobs||{});
    if(keys.length===0) out.innerHTML = '<div style="opacity:0.6">No mobs yet</div>';
    keys.forEach(k=>{
        const m = player.seenMobs[k];
        const el = document.createElement('div'); el.style.border='1px solid #ddd'; el.style.padding='6px'; el.style.borderRadius='6px'; el.style.background='#fff';
        el.innerHTML = `<div style="font-weight:700">${m.name}</div><div style="font-size:12px">Killed: ${m.count}</div>`;
        out.appendChild(el);
    });
}

// Inventory helpers used by crafting
function getInventoryCount(type, rarity){ rarity = rarity || 'Common'; let c = 0; player.inventory.forEach(it=>{ if(it.type===type && (it.rarity||'Common')===rarity) c += (it.stack||1); }); return c; }
function removeFromInventory(type, rarity, amount){ rarity = rarity || 'Common'; let toRemove = amount; for(let i=player.inventory.length-1;i>=0 && toRemove>0;i--){ const it = player.inventory[i]; if(it.type===type && (it.rarity||'Common')===rarity){ const take = Math.min(it.stack||1, toRemove); it.stack = (it.stack||1) - take; toRemove -= take; if(it.stack <= 0) player.inventory.splice(i,1); } } return amount - toRemove; }
function removeFromInventory(type, rarity, amount){ rarity = rarity || 'Common'; let toRemove = amount; for(let i=player.inventory.length-1;i>=0 && toRemove>0;i--){ const it = player.inventory[i]; if(it.type===type && (it.rarity||'Common')===rarity){ const take = Math.min(it.stack||1, toRemove); it.stack = (it.stack||1) - take; toRemove -= take; if(it.stack <= 0) player.inventory.splice(i,1); } } try{ savePlayerState(); }catch(e){} return amount - toRemove; }
function nextRarity(r){ const idx = RARITY_NAMES.indexOf(r||'Common'); if(idx<0) return null; return RARITY_NAMES[Math.min(RARITY_NAMES.length-1, idx+1)]; }

// expose inventory/seen renderers
window.renderInventory = renderInventory;
window.renderSeen = renderSeen;
// Toggle the simple craft panel (replaces previous craft modal)
window.toggleCraft = function(){ const el = document.getElementById('craftPanel'); if(!el) return; el.hidden = !el.hidden; };

function onDeath(){
    // show main screen so player can equip/unequip before restarting
    const ss = document.getElementById('startScreen'); if(ss) ss.style.display='flex';
    // hide canvas to show main menu clearly
    if(canvas) canvas.style.display = 'none';
    // allow opening inventory/craft/seen while dead (toggles already available)
    if(window.renderInventory) window.renderInventory();
    // show HUD when back on main/start screen
    try{ setHUDVisible(true); }catch(e){}
}

// spacebar / mouse hold to expand petals
document.addEventListener('keydown', e=>{ if(e.code === 'Space') spaceHeld = true; });
document.addEventListener('keyup', e=>{ if(e.code === 'Space') spaceHeld = false; });
document.addEventListener('mousedown', e=>{ if(e.button === 0) mouseHeld = true; });
document.addEventListener('mouseup', e=>{ if(e.button === 0) mouseHeld = false; });

// wire modal toggles to render
window.toggleInventory = function(){ const el=document.getElementById('inventoryModal'); if(!el) return; const vis = (el.style.display==='block'); if(!vis) renderInventory(); el.style.display = vis?'none':'block'; };
window.toggleCraft = function(){ const el=document.getElementById('craftModal'); if(!el) return; const vis = (el.style.display==='block'); if(!vis) renderCraft(); el.style.display = vis?'none':'block'; };
window.toggleSeen = function(){ const el=document.getElementById('seenModal'); if(!el) return; const vis = (el.style.display==='block'); if(!vis) renderSeen(); el.style.display = vis?'none':'block'; };

// Show/hide HUD (settings and quick buttons) when entering/exiting gameplay
function setHUDVisible(visible){
    const selectors = [
        '#settingsBtn','#settingsButton','#topSettingsBtn','.settings','.settings-btn','.gear-button',
        '#cornerButtons','#quickButtons','.quick-buttons','.quick-button','.quickBtn',
        '#inventoryButton','#craftButton','#seenButton','#btnX','#btnC','#btnV'
    ];
    const list = document.querySelectorAll(selectors.join(','));
    list.forEach(el=>{ try{ el.style.display = visible ? '' : 'none'; }catch(e){} });
}


// --- RESPAWN ---
document.addEventListener("keydown", e=>{
    if(isDead && e.key==="Enter"){
        try{
            // reuse existing start routine to fully restart the loop and UI
            if(typeof window.startGame === 'function'){
                window.startGame();
            } else {
                isDead=false;
                player.health=player.maxHealth;
                player.x=CENTER_X; player.y=CENTER_Y;
                mobs=[]; drops=[]; projectiles=[];
                spawnWave(currentWave);
                try{ gameLoop(); }catch(e){}
            }
        }catch(e){ console.warn('respawn failed', e); }
    }
});

// --- DRAW FUNCTIONS ---
function drawPlayer(){
    ctx.fillStyle = 'pink';
    ctx.beginPath(); ctx.arc(player.x, player.y, player.radius, 0, Math.PI*2); ctx.fill();
    if(showHitboxes){ ctx.strokeStyle='red'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(player.x,player.y,player.radius,0,Math.PI*2); ctx.stroke(); }
}
// draw player hit flash
const PLAYER_HIT_FLASH_MS = 300;
function drawPlayerHit(){
    if(player._hitFlash && Date.now() - player._hitFlash < PLAYER_HIT_FLASH_MS){
        ctx.strokeStyle = 'red'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(player.x,player.y,player.radius+4,0,Math.PI*2); ctx.stroke();
    }
}
function drawPetals(){
    // draw passive petals around the player (visual only, no DOM dependency)
    for(let i=0;i<petals.length;i++){
        const p = petals[i];
        const px = player.x + Math.cos(p.angle) * player.petalsDistance;
        const py = player.y + Math.sin(p.angle) * player.petalsDistance;
        ctx.save();
        ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.95; ctx.arc(px, py, p.radius || 6, 0, Math.PI*2); ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.stroke();
        ctx.restore();
    }
}
function drawMobs(){
    mobs.forEach(mob=>{
        // angle from mob to player for facing
        const angleToPlayer = Math.atan2((player.y || CENTER_Y) - (mob.y || 0), (player.x || CENTER_X) - (mob.x || 0)) || 0;
        // segmented centipede rendering (segments array)
        if(mob && mob.segments && Array.isArray(mob.segments) && mob.segments.length){
            const segs = mob.segments;
            // draw from tail to head for proper overlap
            for(let si = segs.length - 1; si >= 0; si--){
                const s = segs[si];
                const col = (si===0) ? '#7d5a3c' : (si%2===0 ? '#7d5a3c' : '#5a3b2a');
                ctx.save(); ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(s.x, s.y, s.radius, s.radius*0.78, 0, 0, Math.PI*2); ctx.fill();
                // segment border
                ctx.lineWidth = 1; ctx.strokeStyle = '#2b2b2b'; ctx.beginPath(); ctx.ellipse(s.x, s.y, s.radius, s.radius*0.78, 0, 0, Math.PI*2); ctx.stroke();
                // small damage flash
                if(s._impulse && Date.now() % 300 < 120){ ctx.fillStyle = 'rgba(255,120,120,0.25)'; ctx.beginPath(); ctx.ellipse(s.x, s.y, s.radius*1.05, s.radius*0.9, 0, 0, Math.PI*2); ctx.fill(); }
                ctx.restore();
            }
            // draw head name + rarity + healthbar above head
            const head = segs[0];
            // head promotion flash
            if(mob._headPromoteUntil && Date.now() < mob._headPromoteUntil){ ctx.save(); ctx.strokeStyle = 'rgba(255,200,80,0.95)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(head.x, head.y, head.radius*1.25, head.radius*1.0, 0, 0, Math.PI*2); ctx.stroke(); ctx.restore(); }
            const rarity = mob.rarityName || mob.rarity || 'Common';
            const rcolor = RARITY_COLOR[rarity] || '#000';
            const hpRatio = Math.max(0, Math.min(1, (head.hp || 0) / (head.maxHp || 1)));
            const barWidth = Math.max(44, Math.round((head.radius || 8) * 2.6));
            const barHeight = 8; const bx = Math.round(head.x - barWidth/2); const by = Math.round(head.y + head.radius + 8);
            ctx.beginPath(); roundRectPath(ctx, bx-1, by-1, barWidth+2, barHeight+2, 4); ctx.fillStyle = '#222'; ctx.fill(); ctx.strokeStyle='black'; ctx.lineWidth=1; ctx.stroke();
            ctx.beginPath(); roundRectPath(ctx, bx, by, Math.max(2, Math.round(barWidth * hpRatio)), barHeight, 4); ctx.fillStyle = '#3fc34f'; ctx.fill();
            ctx.font = '12px Arial'; ctx.textBaseline = 'middle'; const nameX = bx - 8; const nameY = by + Math.round(barHeight/2);
            ctx.textAlign = 'right'; ctx.lineWidth = 3; ctx.strokeStyle = contrastColor(RARITY_COLOR[rarity] || '#000'); ctx.strokeText(mob.name || 'Centipede', nameX, nameY);
            ctx.fillStyle = rcolor; ctx.fillText(mob.name || 'Centipede', nameX, nameY);
            const rarityX = bx + barWidth + 8; const rarityY = nameY; ctx.textAlign='left'; ctx.lineWidth=3; ctx.strokeStyle = contrastColor(RARITY_COLOR[rarity] || '#000'); ctx.strokeText(rarity, rarityX, rarityY); ctx.fillStyle = rcolor; ctx.fillText(rarity, rarityX, rarityY);
            // draw mob projectiles if any
            if(mob.projectiles && mob.projectiles.length){
                mob.projectiles.forEach(p=>{
                    if(p.type === 'Missile'){
                        const angle = Math.atan2(p.dy||0, p.dx||1);
                        const len = Math.max(8, (p.radius||4) * 2.2);
                        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle);
                        ctx.fillStyle = '#000';
                        ctx.beginPath(); ctx.moveTo(len, 0); ctx.lineTo(-len*0.45, -len*0.6); ctx.lineTo(-len*0.45, len*0.6); ctx.closePath(); ctx.fill();
                        ctx.restore();
                    } else {
                        ctx.fillStyle = '#f7d86b'; ctx.beginPath(); ctx.arc(p.x,p.y,p.radius,0,Math.PI*2); ctx.fill();
                    }
                });
            }
            return;
        }

        // sprite-based mobs (draw custom sprite and optional mandible animation)
        if(mob.spriteKey && window.MOB_SPRITES && window.MOB_SPRITES[mob.spriteKey] && window.MOB_SPRITES[mob.spriteKey].loaded){
            try{
                const s = window.MOB_SPRITES[mob.spriteKey];
                const drawW = mob.radius * 2;
                const drawH = drawW * (s.h / s.w);
                ctx.save();
                // use interpolated display angle when available for smooth facing
                const dispAngle = (typeof mob._displayAngle !== 'undefined') ? mob._displayAngle : angleToPlayer;
                const flip = Math.cos(dispAngle) < 0;
                ctx.translate(mob.x, mob.y); ctx.rotate(dispAngle);
                if(flip) ctx.scale(-1,1);
                ctx.drawImage(s.canvas, -drawW/2, -drawH/2, drawW, drawH);
                ctx.restore();

                // mandible animation for 'mandible' key (curvy, rounded mandibles that open when moving)
                if(mob.spriteKey === 'mandible'){
                    const phase = (mob._mandiblePhase || 0) + (Date.now()/160);
                    const open = Math.abs(Math.sin(phase)) * (Math.max(4, mob.radius*0.4));
                    const baseX = mob.x + (flip ? -mob.radius*0.48 : mob.radius*0.48);
                    const frontY = mob.y + (mob.radius*0.04);
                    const gap = Math.max(4, mob.radius * 0.2);
                    const mandibleLen = Math.max(8, mob.radius * 0.9);
                    const mandibleW = Math.max(3, mob.radius * 0.28);
                    // left mandible
                    const leftBase = baseX - gap;
                    const leftEnd = leftBase + (flip ? -mandibleLen - open : mandibleLen + open);
                    ctx.fillStyle = '#2b2b2b'; ctx.strokeStyle = '#111'; ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(leftBase, frontY - mandibleW);
                    ctx.quadraticCurveTo((leftBase + leftEnd) * 0.5, frontY - mandibleW - (open*0.18), leftEnd, frontY - mandibleW*0.25);
                    ctx.lineTo(leftEnd, frontY + mandibleW*0.25);
                    ctx.quadraticCurveTo((leftBase + leftEnd) * 0.5, frontY + mandibleW + (open*0.18), leftBase, frontY + mandibleW);
                    ctx.closePath(); ctx.fill(); ctx.stroke();
                    // right mandible
                    const rightBase = baseX + gap;
                    const rightEnd = rightBase + (flip ? -mandibleLen - open : mandibleLen + open);
                    ctx.beginPath();
                    ctx.moveTo(rightBase, frontY - mandibleW);
                    ctx.quadraticCurveTo((rightBase + rightEnd) * 0.5, frontY - mandibleW - (open*0.18), rightEnd, frontY - mandibleW*0.25);
                    ctx.lineTo(rightEnd, frontY + mandibleW*0.25);
                    ctx.quadraticCurveTo((rightBase + rightEnd) * 0.5, frontY + mandibleW + (open*0.18), rightBase, frontY + mandibleW);
                    ctx.closePath(); ctx.fill(); ctx.stroke();
                    return;
                } else {
                    // Generic sprite-based mob: draw HP/name/rarity above the sprite (use same block as centipede head)
                    const head = mob;
                    const rarity = mob.rarityName || mob.rarity || 'Common';
                    const rcolor = RARITY_COLOR[rarity] || '#000';
                    const hpRatio = Math.max(0, Math.min(1, (head.health || 0) / (head.maxHealth || 1)));
                    const barWidth = Math.max(44, Math.round((head.radius || 8) * 2.6));
                    const barHeight = 8; const bx = Math.round(head.x - barWidth/2); const by = Math.round(head.y + head.radius + 8);
                    ctx.beginPath(); roundRectPath(ctx, bx-1, by-1, barWidth+2, barHeight+2, 4); ctx.fillStyle = '#222'; ctx.fill(); ctx.strokeStyle='black'; ctx.lineWidth=1; ctx.stroke();
                    ctx.beginPath(); roundRectPath(ctx, bx, by, Math.max(2, Math.round(barWidth * hpRatio)), barHeight, 4); ctx.fillStyle = '#3fc34f'; ctx.fill();
                    ctx.font = '12px Arial'; ctx.textBaseline = 'middle'; const nameX = bx - 8; const nameY = by + Math.round(barHeight/2);
                    ctx.textAlign = 'right'; ctx.lineWidth = 3; ctx.strokeStyle = contrastColor(RARITY_COLOR[rarity] || '#000'); ctx.strokeText(mob.name || 'Mob', nameX, nameY);
                    ctx.fillStyle = rcolor; ctx.fillText(mob.name || 'Mob', nameX, nameY);
                    const rarityX = bx + barWidth + 8; const rarityY = nameY; ctx.textAlign='left'; ctx.lineWidth=3; ctx.strokeStyle = contrastColor(RARITY_COLOR[rarity] || '#000'); ctx.strokeText(rarity, rarityX, rarityY); ctx.fillStyle = rcolor; ctx.fillText(rarity, rarityX, rarityY);
                    // draw mob projectiles if any
                    if(mob.projectiles && mob.projectiles.length){
                        mob.projectiles.forEach(p=>{
                            if(p.type === 'Missile'){
                                const angle = Math.atan2(p.dy||0, p.dx||1);
                                const len = Math.max(8, (p.radius||4) * 2.2);
                                ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle);
                                ctx.fillStyle = '#000';
                                ctx.beginPath(); ctx.moveTo(len, 0); ctx.lineTo(-len*0.45, -len*0.6); ctx.lineTo(-len*0.45, len*0.6); ctx.closePath(); ctx.fill();
                                ctx.restore();
                            } else {
                                ctx.fillStyle = '#f7d86b'; ctx.beginPath(); ctx.arc(p.x,p.y,p.radius,0,Math.PI*2); ctx.fill();
                            }
                        });
                    }
                    return;
                }
            }catch(e){}
        }

        // body + species-specific visuals
        if((mob.type||'').toLowerCase() === 'hornet'){
                // Hornet behavior: face away by default, briefly turn to face player when shooting
                    try{
                        ctx.save();
                        ctx.translate(mob.x, mob.y);
                        const isTurning = mob._turnUntil && mob._turnUntil > Date.now();
                        const facingAngle = isTurning ? angleToPlayer : (angleToPlayer + Math.PI);
                        ctx.rotate(facingAngle);
                        const scale = Math.max(0.4, mob.radius / 12);
                        // Prefer sprite for hornet
                        if(window.MOB_SPRITES && window.MOB_SPRITES['hornet'] && window.MOB_SPRITES['hornet'].loaded){
                            const s = window.MOB_SPRITES['hornet'];
                            const drawW = mob.radius * 2;
                            const drawH = drawW * (s.h / s.w);
                            ctx.drawImage(s.canvas, -drawW/2, -drawH/2, drawW, drawH);
                        } else {
                            // Minimal fallback so something is visible while sprite loads
                            ctx.fillStyle = '#f6d365'; ctx.beginPath(); ctx.ellipse(0,0,mob.radius,mob.radius*0.8,0,0,Math.PI*2); ctx.fill();
                        }
                    }finally{ ctx.restore(); }
            // draw HP / name / rarity above
            const rarity = mob.rarityName || mob.rarity || 'Common';
            const rcolor = RARITY_COLOR[rarity] || '#000';
            const hpRatio = Math.max(0, Math.min(1, (mob.health || 0) / (mob.maxHealth || 1)));
            const barWidth = Math.max(44, Math.round((mob.radius || 8) * 2.6));
            const barHeight = 8; const bx = Math.round(mob.x - barWidth/2); const by = Math.round(mob.y + mob.radius + 8);
            ctx.beginPath(); roundRectPath(ctx, bx-1, by-1, barWidth+2, barHeight+2, 4); ctx.fillStyle = '#222'; ctx.fill(); ctx.strokeStyle='black'; ctx.lineWidth=1; ctx.stroke();
            ctx.beginPath(); roundRectPath(ctx, bx, by, Math.max(2, Math.round(barWidth * hpRatio)), barHeight, 4); ctx.fillStyle = '#3fc34f'; ctx.fill();
            ctx.font = '12px Arial'; ctx.textBaseline = 'middle'; const nameX = bx - 8; const nameY = by + Math.round(barHeight/2);
            ctx.textAlign = 'right'; ctx.lineWidth = 3; ctx.strokeStyle = contrastColor(RARITY_COLOR[rarity] || '#000'); ctx.strokeText(mob.name || 'Hornet', nameX, nameY);
            ctx.fillStyle = rcolor; ctx.fillText(mob.name || 'Hornet', nameX, nameY);
            const rarityX = bx + barWidth + 8; const rarityY = nameY; ctx.textAlign='left'; ctx.lineWidth=3; ctx.strokeStyle = contrastColor(RARITY_COLOR[rarity] || '#000'); ctx.strokeText(rarity, rarityX, rarityY); ctx.fillStyle = rcolor; ctx.fillText(rarity, rarityX, rarityY);
        } else {
            const t = (mob.type || mob.name || '').toString().toLowerCase();
            ctx.save();
            if(t.includes('ant') && (t.includes('baby') || t.includes('baby-ant'))){
                // Baby Ant: tiny segmented gray ant
                ctx.translate(mob.x, mob.y); ctx.rotate(angleToPlayer);
                ctx.fillStyle = '#777';
                for(let i=0;i<3;i++){ ctx.beginPath(); ctx.ellipse(-mob.radius + i*(mob.radius*0.8), 0, mob.radius*0.55, mob.radius*0.45, 0, 0, Math.PI*2); ctx.fill(); }
                ctx.strokeStyle = '#444'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(mob.radius*0.4, -mob.radius*0.6); ctx.quadraticCurveTo(mob.radius*0.9, -mob.radius*1.2, mob.radius*1.2, -mob.radius*1.6); ctx.stroke();
            } else if(t.includes('queen')){
                // Queen Ant: larger with pronounced abdomen
                ctx.translate(mob.x, mob.y); ctx.rotate(angleToPlayer);
                ctx.fillStyle = '#8b5e3c';
                ctx.beginPath(); ctx.ellipse(0, 0, mob.radius*1.6, mob.radius*1.2, 0, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#5a3b2a'; ctx.beginPath(); ctx.ellipse(-mob.radius*0.8, 0, mob.radius*1.1, mob.radius*0.9, 0, 0, Math.PI*2); ctx.fill();
            } else if(t.includes('soldier')){
                ctx.translate(mob.x, mob.y); ctx.rotate(angleToPlayer);
                ctx.fillStyle = '#6b4b3a'; ctx.beginPath(); ctx.ellipse(0,0,mob.radius,mob.radius*0.8,0,0,Math.PI*2); ctx.fill();
                ctx.fillStyle='#3b2b1f'; ctx.fillRect(-mob.radius*0.9, -mob.radius*0.2, mob.radius*0.8, mob.radius*0.4);
            } else if(t.includes('bee') && t.includes('bumble') ){ // bumblebee
                ctx.translate(mob.x, mob.y); ctx.rotate(angleToPlayer);
                // draw stripes first (clipped to body ellipse)
                ctx.save();
                ctx.beginPath(); ctx.ellipse(0,0,mob.radius*1.2,mob.radius*0.95,0,0,Math.PI*2); ctx.clip();
                ctx.fillStyle = '#211f1f';
                for(let i=-1;i<=1;i++){ ctx.beginPath(); ctx.ellipse(-mob.radius*0.15 + i*(mob.radius*0.45), 0, mob.radius*0.42, mob.radius*0.36, 0, 0, Math.PI*2); ctx.fill(); }
                ctx.restore();
                // soft radial outer layer drawn on top so stripes sit underneath
                const bg = ctx.createRadialGradient(0, -mob.radius*0.1, mob.radius*0.1, 0, 0, mob.radius*1.1);
                bg.addColorStop(0, '#fff3e6'); bg.addColorStop(0.4, '#ffd28a'); bg.addColorStop(1, 'rgba(255,184,107,0.92)'); ctx.fillStyle = bg;
                ctx.beginPath(); ctx.ellipse(0,0,mob.radius*1.2,mob.radius*0.95,0,0,Math.PI*2); ctx.fill();
                // subtle outer stroke
                ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0,0,mob.radius*1.2,mob.radius*0.95,0,0,Math.PI*2); ctx.stroke();
                // wing highlight
                ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.ellipse(-mob.radius*0.1, -mob.radius*0.9, mob.radius*0.6, mob.radius*0.3, 0, 0, Math.PI*2); ctx.fill();
            } else if(t.includes('bee')){
                // Prefer using a loaded PNG sprite for bees if available; otherwise use `drawbee`.
                    try{
                        const rot = (typeof mob._displayAngle === 'number') ? mob._displayAngle : angleToPlayer;
                        // Use the simplified sprite-based `drawbee` which handles its own loading
                        drawbee(ctx, mob.x, mob.y, mob.radius, rot);
                    }catch(e){
                    // fallback to previous inline rendering on error
                    ctx.translate(mob.x, mob.y); ctx.rotate(angleToPlayer);
                    ctx.save(); ctx.beginPath(); ctx.ellipse(0,0,mob.radius,mob.radius*0.8,0,0,Math.PI*2); ctx.clip();
                    ctx.fillStyle = '#1b1b1b'; for(let i=-1;i<=1;i++){ ctx.beginPath(); ctx.ellipse(-mob.radius*0.06 + i*(mob.radius*0.34),0,mob.radius*0.28,mob.radius*0.22,0,0,Math.PI*2); ctx.fill(); }
                    ctx.restore();
                    ctx.fillStyle = '#f7d86b'; ctx.beginPath(); ctx.ellipse(0,0,mob.radius,mob.radius*0.8,0,0,Math.PI*2); ctx.fill();
                    ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.ellipse(-mob.radius*0.25,-mob.radius*0.6,mob.radius*0.55,mob.radius*0.25,0,0,Math.PI*2); ctx.fill();
                }
            } else if(t.includes('centipede')){
                // draw segmented body along a small curve
                ctx.translate(mob.x, mob.y); ctx.rotate(angleToPlayer);
                const seg = Math.max(6, Math.floor((mob.radius*2)/4));
                for(let i=0;i<8;i++){ const ox = -mob.radius + i*(mob.radius*0.6); ctx.fillStyle = (i%2===0)?'#7d5a3c':'#5a3b2a'; ctx.beginPath(); ctx.ellipse(ox, 0, mob.radius*0.5, mob.radius*0.38, 0, 0, Math.PI*2); ctx.fill(); }
            } else if(t.includes('spider')){
                // round body with legs
                ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(mob.x, mob.y, mob.radius, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle='#111'; ctx.lineWidth=2; for(let i=0;i<8;i++){ const a = (Math.PI*2/8)*i; ctx.beginPath(); ctx.moveTo(mob.x + Math.cos(a)*mob.radius, mob.y + Math.sin(a)*mob.radius); ctx.lineTo(mob.x + Math.cos(a)*(mob.radius*1.8), mob.y + Math.sin(a)*(mob.radius*1.8)); ctx.stroke(); }
            } else if(t.includes('dandelion')){
                ctx.save(); ctx.translate(mob.x, mob.y);
                ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0,0,mob.radius,0,Math.PI*2); ctx.fill();
                ctx.strokeStyle='rgba(200,200,200,0.4)'; for(let i=0;i<14;i++){ ctx.beginPath(); const a = (Math.PI*2/14)*i; ctx.moveTo(0,0); ctx.lineTo(Math.cos(a)*(mob.radius*1.6), Math.sin(a)*(mob.radius*1.6)); ctx.stroke(); }
                ctx.restore();
            } else if(t.includes('rock')){
                ctx.fillStyle = '#9e9e9e'; ctx.beginPath(); ctx.ellipse(mob.x, mob.y, mob.radius*1.1, mob.radius*0.9, -0.2, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle='#7a7a7a'; ctx.lineWidth=2; ctx.beginPath(); ctx.ellipse(mob.x, mob.y, mob.radius*1.1, mob.radius*0.9, -0.2, 0, Math.PI*2); ctx.stroke();
            } else if(t.includes('snail')){
                // body and shell spiral
                ctx.translate(mob.x, mob.y);
                ctx.fillStyle='#b77'; ctx.beginPath(); ctx.ellipse(-mob.radius*0.4, 0, mob.radius*0.9, mob.radius*0.6, 0, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle='#9f6'; ctx.beginPath(); ctx.arc(mob.radius*0.5, 0, mob.radius*0.8, 0, Math.PI*2); ctx.fill();
            } else if(t.includes('ladybug')){
                ctx.translate(mob.x, mob.y);
                ctx.fillStyle = '#ff6b6b'; ctx.beginPath(); ctx.ellipse(0,0,mob.radius,mob.radius*0.8,0,0,Math.PI*2); ctx.fill();
                ctx.fillStyle='#111'; for(let i=0;i<3;i++){ ctx.beginPath(); ctx.arc(-mob.radius*0.2 + i*(mob.radius*0.35), 0, mob.radius*0.18, 0, Math.PI*2); ctx.fill(); }
            } else {
                // fallback simple circle
                ctx.fillStyle = '#ff6b6b'; ctx.beginPath(); ctx.arc(mob.x,mob.y,mob.radius,0,Math.PI*2); ctx.fill();
            }
            ctx.restore();
        }

        const rarity = mob.rarityName || mob.rarity || 'Common';
        const rcolor = RARITY_COLOR[rarity] || '#000';
        const hpRatio = Math.max(0, Math.min(1, (mob.health || 0) / (mob.maxHealth || 1)));
        const barWidth = Math.max(44, Math.round((mob.radius || 8) * 2.6));
        const barHeight = 8; const bx = Math.round(mob.x - barWidth/2); const by = Math.round(mob.y - mob.radius - 14);
        ctx.beginPath(); roundRectPath(ctx, bx-1, by-1, barWidth+2, barHeight+2, 4); ctx.fillStyle = '#222'; ctx.fill(); ctx.strokeStyle='black'; ctx.lineWidth=1; ctx.stroke();
        ctx.beginPath(); roundRectPath(ctx, bx, by, Math.max(2, Math.round(barWidth * hpRatio)), barHeight, 4); ctx.fillStyle = '#3fc34f'; ctx.fill();
        ctx.font = '12px Arial'; ctx.textBaseline = 'middle'; const nameX = bx - 8; const nameY = by + Math.round(barHeight/2);
        ctx.textAlign = 'right'; ctx.lineWidth = 3; ctx.strokeStyle = contrastColor(RARITY_COLOR[rarity] || '#000'); ctx.strokeText(mob.name || '', nameX, nameY);
        ctx.fillStyle = rcolor; ctx.fillText(mob.name || '', nameX, nameY);
        const rarityX = bx + barWidth + 8; const rarityY = nameY; ctx.textAlign='left'; ctx.lineWidth=3; ctx.strokeStyle = contrastColor(RARITY_COLOR[rarity] || '#000'); ctx.strokeText(rarity, rarityX, rarityY); ctx.fillStyle = rcolor; ctx.fillText(rarity, rarityX, rarityY);
        // draw mob projectiles if any
        if(mob.projectiles && mob.projectiles.length){
            mob.projectiles.forEach(p=>{
                if(p.type === 'Missile'){
                    const angle = Math.atan2(p.dy||0, p.dx||1);
                    const len = Math.max(8, (p.radius||4) * 2.2);
                    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle);
                    ctx.fillStyle = '#000';
                    ctx.beginPath(); ctx.moveTo(len, 0); ctx.lineTo(-len*0.45, -len*0.6); ctx.lineTo(-len*0.45, len*0.6); ctx.closePath(); ctx.fill();
                    ctx.restore();
                } else {
                    ctx.fillStyle = '#f7d86b'; ctx.beginPath(); ctx.arc(p.x,p.y,p.radius,0,Math.PI*2); ctx.fill();
                }
            });
        }
        // hit flash outline when recently damaged
        if(mob._hitFlash && Date.now() - mob._hitFlash < 300){ ctx.strokeStyle='red'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(mob.x,mob.y,mob.radius+3,0,Math.PI*2); ctx.stroke(); }
        // collision debug highlight
        if(mob._debug){ ctx.strokeStyle='magenta'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(mob.x,mob.y,mob.radius+6,0,Math.PI*2); ctx.stroke(); ctx.fillStyle='magenta'; ctx.font='12px monospace'; ctx.fillText('COLLIDE', mob.x, mob.y - mob.radius - 10); }
    });
}
function drawDrops(){
    drops.forEach(drop=>{
        try{
            const w = 48, h = 56;
            const x = Math.round(drop.x - w/2);
            const y = Math.round(drop.y - h/2);
            const bg = RARITY_COLOR[drop.rarity] || '#ddd';
            // box background
            ctx.save(); ctx.beginPath(); roundRectPath(ctx, x, y, w, h-14, 8); ctx.fillStyle = bg; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#333'; ctx.stroke();
            // draw petal icon if loaded (cached per-drop)
            if(drop._img && drop._imgLoaded){
                const imgW = w - 12; const imgH = Math.max(20, h - 34);
                ctx.drawImage(drop._img, x + 6, y + 6, imgW, imgH);
            } else if(drop.iconURL){
                // try lazy load once more
                if(!drop._img){ const img = new Image(); img.onload = ()=>{ drop._imgLoaded = true; drop._img = img; }; img.src = drop.iconURL; drop._img = img; }
                // placeholder circle
                ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.arc(x + w/2, y + (h-14)/2, Math.min(18, (w-12)/2), 0, Math.PI*2); ctx.fill();
            }
            // name under icon
            ctx.fillStyle = '#111'; ctx.font = '12px Arial'; ctx.textAlign = 'center'; ctx.fillText(drop.type, x + w/2, y + h - 6);
            if(showHitboxes){ ctx.strokeStyle='red'; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h-14); }
            ctx.restore();
        }catch(e){ /* ignore drawing errors */ }
    });
}
// Override drawUI: show biome title and wave bar centered
function drawUI(){
    const biome = window.currentBiome || 'Garden';
    ctx.save(); ctx.textAlign = 'center'; ctx.font = '28px Arial'; ctx.fillStyle = '#ffffff'; ctx.fillText(biome, CENTER_X, 36);
    const barW = 340; const barH = 18; const bx = CENTER_X - barW/2; const by = 56;
    ctx.beginPath(); roundRectPath(ctx, bx, by, barW, barH, 10); ctx.fillStyle = '#000'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#111'; ctx.stroke();
    // fill representing remaining spawn progress (inverse of mobs present)
    const expected = Math.max(1, 8 + Math.floor(currentWave * 1.6));
    const prog = Math.max(0, Math.min(1, 1 - (mobs.length / expected)));
    ctx.beginPath(); roundRectPath(ctx, bx+2, by+2, Math.max(6, (barW-4)* prog), barH-4, 8); ctx.fillStyle = '#7ee07a'; ctx.fill();
    ctx.font = '14px Arial'; ctx.fillStyle = '#fff'; ctx.fillText('Wave ' + currentWave, CENTER_X, by + barH/2 + 4);
    // HP left-top
    ctx.textAlign = 'left'; ctx.font = '14px Arial'; ctx.fillStyle = '#fff'; ctx.fillText('HP: '+Math.floor(player.health), 12, 22);
    ctx.restore();
}

// Debug overlay: shows counts, coordinates, and a crosshair for the player
function drawDebugOverlay(){
    if(typeof DEBUG_SHOW === 'undefined') DEBUG_SHOW = true;
    if(!DEBUG_SHOW) return;
    const pad = 8;
    const w = 260, h = 88;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); roundRectPath(ctx, pad-4, 30-12, w, h, 6);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('player: ' + player.x.toFixed(1) + ', ' + player.y.toFixed(1), pad, 40);
    ctx.fillText('view: ' + viewWidth.toFixed(0) + ' x ' + viewHeight.toFixed(0), pad, 58);
    ctx.fillText('mobs: ' + mobs.length + ' proj: ' + projectiles.length + ' drops: ' + drops.length, pad, 76);
    ctx.fillText('wave: ' + currentWave + (isDead? ' (DEAD)':'') , pad, 94);

    // draw crosshair at player position
    ctx.lineWidth = 2; ctx.strokeStyle = 'red'; ctx.beginPath();
    ctx.moveTo(player.x - 14, player.y - 14); ctx.lineTo(player.x + 14, player.y + 14);
    ctx.moveTo(player.x + 14, player.y - 14); ctx.lineTo(player.x - 14, player.y + 14);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(player.x, player.y, player.radius + 6, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
    // DOM overlay removed; keep diagnostics visible via console logs when needed
}

// Huge flashing center marker to guarantee the player is visible during debugging
function drawHugeCenterMarker(){
    if(typeof DEBUG_FORCE_CENTER === 'undefined' || !DEBUG_FORCE_CENTER) return;
    const t = Date.now();
    const on = Math.floor(t/300) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = on ? 0.95 : 0.45;
    ctx.fillStyle = 'rgba(255,255,0,0.9)';
    ctx.beginPath(); ctx.arc(CENTER_X, CENTER_Y, Math.max(32, Math.min(viewWidth, viewHeight) * 0.08), 0, Math.PI*2); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = 'black'; ctx.beginPath(); ctx.arc(CENTER_X, CENTER_Y, Math.max(36, Math.min(viewWidth, viewHeight) * 0.08 + 4), 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = 'black'; ctx.font = '18px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('PLAYER', CENTER_X, CENTER_Y);
    ctx.restore();
}

// --- DEATH OVERLAY ---
function drawDeathOverlay(){
    ctx.fillStyle="rgba(100,100,100,0.6)";
    ctx.fillRect(0,0,viewWidth,viewHeight);
    // Player dead face
    ctx.fillStyle="pink";
    ctx.beginPath(); ctx.arc(CENTER_X,CENTER_Y,player.radius,0,Math.PI*2); ctx.fill();
    ctx.fillStyle="black";
    ctx.font="20px Arial";
    ctx.fillText("x_x",CENTER_X-15,CENTER_Y-5);
    ctx.fillText("☹",CENTER_X-10,CENTER_Y+15);
    ctx.font="16px Arial";
    ctx.fillText("Press Enter to respawn",CENTER_X-80,CENTER_Y+50);
}

// --- GAME LOOP ---
function gameLoop(){
    ctx.fillStyle="#3CB043"; // green background
    ctx.fillRect(0,0,viewWidth,viewHeight);

    movePlayer(); moveMobs(); updatePetals(); updatePetalDistance(); updateProjectiles(); checkCollisions();
    applyPassiveEffects();
    drawPlayer(); drawPlayerHit(); drawPetals(); drawMobs(); drawDrops(); drawProjectiles(); drawUI();
    // debug overlay to help locate player and coordinate issues (non-intrusive)
    if(typeof DEBUG_SHOW !== 'undefined' && DEBUG_SHOW) drawDebugOverlay();

    if(isDead) drawDeathOverlay();

    if(!isDead){
        animationId = requestAnimationFrame(gameLoop);
    } else {
        animationId = null;
    }
}

// (toggle functions defined earlier wire rendering when opening)

// Start the game loop and spawn the first wave. Called from the start screen Play button.
window.startGame = function(){
    console.log('DEBUG startGame: begin');
    try{ window.currentBiome = 'Garden'; }catch(e){}
    // hide start screen if present
    try{
        const ss = document.getElementById('startScreen'); if(ss){ ss.style.display='none'; console.log('DEBUG startGame: hid start screen'); }
    }catch(e){ console.warn('startGame: could not hide start screen', e); }

    // show canvas (index.html will do this too, but double-safe)
    try{ canvas.style.display = 'block'; console.log('DEBUG startGame: canvas shown'); }catch(e){ console.warn('startGame: canvas show failed', e); }

    // attempt to lock page scroll and make canvas fill viewport, but don't fail initialization on error
    try{
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
        document.body.style.margin = '0';
        canvas.style.position = 'fixed'; canvas.style.left = '0'; canvas.style.top = '0';
        canvas.style.width = '100vw'; canvas.style.height = '100vh';
        console.log('DEBUG startGame: applied fullscreen CSS');
    }catch(e){ console.warn('startGame: fullscreen CSS failed', e); }

    // recalc canvas backing store to match new CSS size; fallback to window sizes if needed
    try{
        resizeCanvas();
        if(!viewWidth || !viewHeight){
            viewWidth = window.innerWidth || 800;
            viewHeight = window.innerHeight || 600;
            CENTER_X = Math.round(viewWidth/2); CENTER_Y = Math.round(viewHeight/2);
            console.warn('startGame: resizeCanvas produced zero view; using window.inner sizes', viewWidth, viewHeight);
        }
        console.log('DEBUG startGame: resizeCanvas ok view=', viewWidth, viewHeight, 'CENTER=', CENTER_X, CENTER_Y);
    }catch(e){ console.warn('startGame: resizeCanvas threw', e); viewWidth = window.innerWidth || 800; viewHeight = window.innerHeight || 600; CENTER_X = Math.round(viewWidth/2); CENTER_Y = Math.round(viewHeight/2); }

    // hide HUD (settings + quick buttons) while playing (best-effort)
    try{ setHUDVisible(false); }catch(e){ console.warn('startGame: setHUDVisible failed', e); }

    // populate demo inventory if empty for testing (non-blocking)
    try{
        if(player.inventory.length===0){
            addToInventory('Air','Common',30);
            addToInventory('Pollen','Common',12);
            addToInventory('Missile','Rare',3);
            addToInventory('Light','Rare',2);
            addToInventory('Stinger','Epic',1);
            console.log('DEBUG startGame: populated demo inventory');
        }
    }catch(e){ console.warn('startGame: populate inventory failed', e); }

    // reset player state for a new run
    try{
        isDead = false;
        player.health = player.maxHealth;
        player.x = CENTER_X; player.y = CENTER_Y;
        // ensure canvas is focusable and get keyboard input
        try{ canvas.tabIndex = canvas.tabIndex || 0; canvas.focus(); }catch(e){}
        mobs=[]; drops=[]; projectiles=[];
        nextEquipIndex = 0;
        refreshPetals();
        console.log('DEBUG startGame: player reset, arrays cleared');
    }catch(e){ console.warn('startGame: player reset failed', e); }

    // log canvas/debug info to console for diagnostics
    try{
        const rect = canvas.getBoundingClientRect();
        console.log('DEBUG startGame: DPR=', window.devicePixelRatio, 'canvas.width=', canvas.width, 'canvas.height=', canvas.height, 'rect=', rect);
    }catch(e){ console.log('DEBUG startGame: error reading canvas rect', e); }

    // ensure any previous animation frame is cancelled before starting
    try{ if(animationId) cancelAnimationFrame(animationId); animationId = null; }catch(e){ console.warn('startGame: cancelAnimationFrame failed', e); }

    // spawn wave and start loop; keep these as the last critical steps so UI failures won't block gameplay
    try{
        spawnWave(currentWave);
        console.log('DEBUG startGame: spawnWave called, mobs=', mobs.length);
    }catch(e){ console.error('startGame: spawnWave failed', e); mobs = []; }

    try{ if(window.renderInventory) window.renderInventory(); }catch(e){}

    try{
        gameLoop();
        console.log('DEBUG startGame: gameLoop started');
    }catch(e){ console.error('startGame: gameLoop failed to start', e); }
};

// (removed DOM debug overlay - diagnostics kept in console)

// --- RARITY SYSTEM ---
const RARITY_NAMES = [
    'Common','Unusual','Rare','Epic','Legendary','Mythical','Ultra','Super','Radiant','Mystitic','Runic','Seraphic','Umbral','Impracticality'
];
const RARITY_COLOR = {
    Common: '#bfeecb',       // Light Green
    Unusual: '#fff9c4',      // Light Yellow
    Rare: '#3b6cff',         // Blue
    Epic: '#d6b3ff',         // Light Purple
    Legendary: '#800000',    // Maroon
    Mythical: '#5fd6d1',     // Light Blue / Teal
    Ultra: '#ff4db8',        // Hot Pink
    Super: '#00c9a7',        // Cyan Green
    Radiant: '#ffd24d',      // Gold / Bright Yellow
    Mystitic: '#30e0d0',     // Turquoise
    Runic: '#2b2b7a',        // Deep Indigo
    Seraphic: '#ffffff',     // White / Pearl
    Umbral: '#000000',       // Black / Void
    Impracticality: null     // Shifting rainbow / cosmic handled separately
};

// Spawn probability table per rarity by wave ranges.
const RARITY_SPAWN_TABLE = [
    // Wave 1-3
    [50,25,12,6,3,2,1,0.5,0.3,0.2,0.1,0.05,0.01,0.01],
    // Wave 4-6
    [40,25,15,8,5,4,2,1,0.5,0.3,0.2,0.1,0.05,0.05],
    // Wave 7-9
    [30,20,20,10,8,6,3,2,1,0.5,0.3,0.2,0.1,0.1],
    // Wave 10+
    [20,15,20,10,10,8,5,4,2,1,0.5,0.3,0.2,0.2]
];

function getRarityDistributionForWave(wave){
    if(wave <= 3) return RARITY_SPAWN_TABLE[0].slice();
    if(wave <= 6) return RARITY_SPAWN_TABLE[1].slice();
    if(wave <= 9) return RARITY_SPAWN_TABLE[2].slice();
    return RARITY_SPAWN_TABLE[3].slice();
}

function pickRarityByWave(wave){
    const dist = getRarityDistributionForWave(wave);
    // normalize and weighted pick
    const total = dist.reduce((a,b)=>a+b,0);
    if(total <= 0) return 'Common';
    let r = Math.random() * total;
    for(let i=0;i<dist.length;i++){
        r -= dist[i];
        if(r <= 0) return RARITY_NAMES[i] || 'Common';
    }
    return RARITY_NAMES[RARITY_NAMES.length-1];
}

function hexToRgb(hex){
    if(!hex) return null;
    hex = hex.replace('#','');
    if(hex.length===3) hex = hex.split('').map(c=>c+c).join('');
    const bigint = parseInt(hex,16); return {r:(bigint>>16)&255, g:(bigint>>8)&255, b:bigint&255};
}
function luminanceOfHex(hex){ const rgb = hexToRgb(hex); if(!rgb) return 0; const r = rgb.r/255, g = rgb.g/255, b = rgb.b/255; return 0.2126*r + 0.7152*g + 0.0722*b; }
function contrastColor(hex){ const lum = luminanceOfHex(hex||'#000'); return (lum > 0.6) ? '#000' : '#fff'; }

// helper to build rounded rect path (stroke/fill externally)
function roundRectPath(ctx, x, y, width, height, radius){
    const r = Math.min(radius, width/2, height/2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

const RARITY_BASE_MULTIPLIER = 1.55; // exponential base for scaling; higher -> wider gaps between rarities
function rarityMultiplier(index){ return Math.pow(RARITY_BASE_MULTIPLIER, Math.max(0, index)); }

// --- SIMPLE CHAT SYSTEM (client-side) ---
// Creates a small chat overlay with message area and input. Press Enter to focus/send.
(function(){
    try{
        // build chat root
        const cr = document.createElement('div'); cr.id = 'chatRoot';
        cr.style.position = 'fixed'; cr.style.left = '12px'; cr.style.bottom = '12px'; cr.style.width = '360px'; cr.style.maxHeight = '40vh'; cr.style.zIndex = 99999; cr.style.display = 'flex'; cr.style.flexDirection = 'column'; cr.style.gap = '6px'; cr.style.fontFamily = 'Arial, sans-serif';
        cr.style.pointerEvents = 'auto';

        const msgs = document.createElement('div'); msgs.id = 'chatMessages'; msgs.style.background = 'rgba(8,8,12,0.6)'; msgs.style.color = '#fff'; msgs.style.padding = '8px'; msgs.style.borderRadius = '8px'; msgs.style.overflowY = 'auto'; msgs.style.flex = '1 1 auto'; msgs.style.maxHeight = '40vh'; msgs.style.fontSize = '13px'; msgs.style.boxShadow = '0 6px 18px rgba(0,0,0,0.5)';
        cr.appendChild(msgs);

        const inputWrap = document.createElement('div'); inputWrap.style.display = 'flex'; inputWrap.style.gap = '6px';
        const input = document.createElement('input'); input.id = 'chatInput'; input.type = 'text'; input.placeholder = 'Press Enter to chat — use $spawnmob or $setwave';
        input.style.flex = '1 1 auto'; input.style.padding = '8px 10px'; input.style.borderRadius = '6px'; input.style.border = '1px solid rgba(255,255,255,0.12)'; input.style.background = 'rgba(255,255,255,0.04)'; input.style.color = '#fff';
        const sendBtn = document.createElement('button'); sendBtn.textContent = 'Send'; sendBtn.style.padding = '8px 10px'; sendBtn.style.borderRadius = '6px'; sendBtn.style.border = 'none'; sendBtn.style.background = '#3b82f6'; sendBtn.style.color = '#fff';
        inputWrap.appendChild(input); inputWrap.appendChild(sendBtn);
        cr.appendChild(inputWrap);

        document.addEventListener('DOMContentLoaded', ()=>{ document.body.appendChild(cr); });
        if(document.body) document.body.appendChild(cr);

        function appendMsg(text, cls){
            try{
                const el = document.createElement('div'); el.style.marginBottom = '6px'; el.style.wordBreak = 'break-word';
                el.innerHTML = text;
                if(cls === 'system') el.style.opacity = '0.9';
                msgs.appendChild(el);
                msgs.scrollTop = msgs.scrollHeight;
            }catch(e){}
        }

        function spawnMobCommand(name, rarityArg){
            try{
                if(!name) { appendMsg('<em>spawnmob requires a name</em>','system'); return; }
                let rarityName = 'Common';
                if(typeof rarityArg === 'number'){ const i = Math.max(0, Math.min(RARITY_NAMES.length-1, rarityArg)); rarityName = RARITY_NAMES[i]; }
                else if(typeof rarityArg === 'string' && rarityArg.trim().length>0){ const maybe = rarityArg.trim(); if(/^[0-9]+$/.test(maybe)) rarityName = RARITY_NAMES[Math.max(0, Math.min(RARITY_NAMES.length-1, parseInt(maybe)))]; else rarityName = maybe; }

                const rarityIndex = Math.max(0, RARITY_NAMES.indexOf(rarityName));
                const mult = rarityMultiplier(rarityIndex);
                const x = Math.max(0, Math.min(viewWidth, player.x + (Math.random()*400 - 200)));
                const y = Math.max(0, Math.min(viewHeight, player.y + (Math.random()*400 - 200)));
                const radius = Math.max(8, Math.round(12 * (1 + rarityIndex*0.06)));
                const hp = Math.max(6, Math.round(30 * mult));
                const speed = Math.max(0.2, 1.2 - (rarityIndex*0.02));
                const sk = (name||'').toString().toLowerCase();
                mobs.push({ x, y, radius, speed, health: hp, maxHealth: hp, name: name, type: name, projectiles: [], shootCooldown: 0, spriteKey: sk, rarityIndex, rarityName, stationary: false, mass: Math.round(radius * (1 + rarityIndex*0.06)), vx:0, vy:0 });
                appendMsg(`<strong>Spawned</strong> ${name} (${rarityName}) near player`,'system');
            }catch(e){ appendMsg('<em>spawn failed</em>','system'); }
        }

        function setWaveCommand(n){
            try{
                const val = parseInt(n,10);
                if(isNaN(val) || val < 1){ appendMsg('<em>invalid wave number</em>','system'); return; }
                currentWave = val;
                spawnWave(currentWave);
                appendMsg(`<strong>Wave set to</strong> ${currentWave}`,'system');
            }catch(e){ appendMsg('<em>setwave failed</em>','system'); }
        }

        function handleChatLine(line){
            if(!line) return;
            const trimmed = line.trim();
            if(trimmed.length === 0) return;
            // commands start with $
            if(trimmed.startsWith('$')){
                const parts = trimmed.split(/\s+/);
                const cmd = parts[0].toLowerCase();
                if(cmd === '$spawnmob'){
                    if(parts.length < 3){ appendMsg('<em>Usage: $spawnmob &lt;name&gt; &lt;rarity-number&gt;</em>','system'); return; }
                    const name = parts[1]; const r = parts[2]; spawnMobCommand(name, r);
                    return;
                } else if(cmd === '$setwave'){
                    if(parts.length < 2){ appendMsg('<em>Usage: $setwave &lt;number&gt;</em>','system'); return; }
                    setWaveCommand(parts[1]); return;
                } else if(cmd === '$godmode'){
                    // toggle godmode
                    player.godmode = !player.godmode;
                    appendMsg(`<strong>Godmode</strong> ${player.godmode ? 'ENABLED' : 'DISABLED'}`,'system'); return;
                } else if(cmd === '$givepetal'){
                    if(parts.length < 3){ appendMsg('<em>Usage: $givepetal &lt;name&gt; &lt;rarity-number&gt;</em>','system'); return; }
                    const name = parts[1]; const r = parts[2];
                    let rarityName = 'Common';
                    if(/^[0-9]+$/.test(r)) rarityName = RARITY_NAMES[Math.max(0, Math.min(RARITY_NAMES.length-1, parseInt(r)))] || 'Common'; else if(r) rarityName = r;
                    addToInventory(name, rarityName, 1);
                    appendMsg(`<strong>Given</strong> ${name} (${rarityName})`,'system'); return;
                } else {
                    appendMsg(`<em>Unknown command:</em> ${cmd}`,'system'); return;
                }
            }
            // normal chat echo (client-only)
            appendMsg(`<strong>You:</strong> ${escapeHtml(trimmed)}`);
        }

        function escapeHtml(s){ return String(s).replace(/[&<>\"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":"&#39;"}[c]; }); }

        sendBtn.addEventListener('click', ()=>{ const v = input.value || ''; handleChatLine(v); input.value=''; input.focus(); });
        input.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); const v = input.value || ''; handleChatLine(v); input.value=''; input.blur(); } });

        // Pressing Enter anywhere should focus the chat input (unless typing in a field already)
        document.addEventListener('keydown', function(e){
            try{
                if(e.key === 'Enter'){
                    const active = document.activeElement;
                    if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
                    input.focus(); e.preventDefault();
                }
            }catch(err){}
        });

        // expose commands for external use
        window.chatCommands = { spawnMob: spawnMobCommand, setWave: setWaveCommand, givePetal: function(n,r){ try{ spawnMobCommand(n,r); }catch(e){} }, appendMsg };
        // small welcome
        appendMsg('<em>Chat initialized. Use <strong>$spawnmob &lt;name&gt; &lt;rarity-number&gt;</strong> or <strong>$setwave &lt;number&gt;</strong></em>','system');
    }catch(e){ console.warn('chat init failed', e); }
})();

// --- Simple crafting executor: combine 5 of same petal -> 1 of next rarity ---
function updateCraftUI(){
    try{
        const btn = document.getElementById('craftButton'); if(!btn) return;
        let can = false; for(const it of player.inventory){ if((it.stack||0) >= 5){ can = true; break; } }
        btn.disabled = !can;
    }catch(e){}
}
window.updateCraftUI = updateCraftUI;

function doCraftAction(){
    try{
        // find first craftable stack
        let idx = player.inventory.findIndex(it => (it.stack||0) >= 5);
        if(idx === -1){ if(window.chatCommands && window.chatCommands.appendMsg) window.chatCommands.appendMsg('<em>No craftable stacks (need 5)</em>','system'); return; }
        const it = player.inventory[idx]; const fromR = it.rarity || 'Common'; const next = nextRarity(fromR) || fromR;
        // remove 5
        removeFromInventory(it.type, fromR, 5);
        // add crafted upgraded petal
        addToInventory(it.type, next, 1);
        try{ savePlayerState(); }catch(e){}
        if(window.chatCommands && window.chatCommands.appendMsg) window.chatCommands.appendMsg(`<strong>Crafted</strong> 5x ${it.type} (${fromR}) → 1x ${it.type} (${next})`,'system');
        // refresh UI
        try{ if(typeof renderInventory === 'function') renderInventory(); }catch(e){}
        updateCraftUI();
    }catch(e){ console.warn('craft failed', e); }
}
window.doCraftAction = doCraftAction;
// wire craft button if present
try{ const cb = document.getElementById('craftButton'); if(cb){ cb.addEventListener('click', ()=> doCraftAction()); } }catch(e){}
// periodically refresh craft button state
setInterval(()=>{ try{ updateCraftUI(); }catch(e){} }, 800);

// --- Verbose logging wrapper (enable to trace runtime behavior) ---
(function(){
    try{
        window.VERBOSE_LOGGING = true; // toggle here to silence logs
        function logV(){ if(!window.VERBOSE_LOGGING) return; try{ console.log.apply(console, arguments); }catch(e){} }

        function tryGet(fnName){ try{ if(window[fnName] && typeof window[fnName] === 'function') return window[fnName]; const maybe = eval(fnName); if(typeof maybe === 'function') return maybe; }catch(e){} return null; }

        function wrap(fnName){
            try{
                const orig = tryGet(fnName);
                if(!orig) return logV('wrap: no function to wrap', fnName);
                window[fnName] = function(){
                    try{ logV('CALL', fnName, Array.prototype.slice.call(arguments)); }catch(e){}
                    try{
                        const res = orig.apply(this, arguments);
                        try{ logV('RET', fnName); }catch(e){}
                        return res;
                    }catch(err){ logV('ERR', fnName, err); throw err; }
                };
                logV('wrap: wrapped', fnName);
            }catch(e){ console.warn('wrap failed', fnName, e); }
        }

        // Wrap core systems
        ['loadMobSprite','processSpriteImage','spawnWave','spawnDrop','spawnMobDrops','updateProjectiles','drawProjectiles','moveMobs','drawMobs','checkCollisions','drawPlayer','drawPlayerHit','updatePetals','spawnMobDrops'].forEach(wrap);

        // Also wrap key event points that may be created later via window
        try{ if(window.startGame && typeof window.startGame === 'function'){ const s = window.startGame; window.startGame = function(){ logV('CALL startGame'); return s.apply(this, arguments); }; logV('wrap: wrapped startGame'); } }catch(e){}

        // Log asset load attempts (Image onload/onerror already log in code, but add a global handler)
        try{
            const _Img = Image;
            window.Image = function(){ const i = new _Img(); const origOnLoad = null; i.addEventListener('load', ()=>{ logV('Image loaded', i.src); }); i.addEventListener('error', ()=>{ logV('Image failed', i.src); }); return i; };
            // restore prototype so new Image() instanceof Image works
            window.Image.prototype = _Img.prototype;
            logV('Image constructor wrapped for load/error logging');
        }catch(e){ logV('Image wrap failed', e); }

        logV('Verbose logging initialized');
    }catch(e){ console.warn('Verbose logging init failed', e); }
})();
