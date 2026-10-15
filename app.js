(function(){
'use strict';
/* ---------- helpers ---------- */
var pad=function(n){return String(n).padStart(2,'0')};
var iso=function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
var todayISO=function(){return iso(new Date())};
var parseISO=function(s){var p=s.split('-').map(Number);return new Date(p[0],p[1]-1,p[2])};
var addDays=function(s,n){var d=parseISO(s);d.setDate(d.getDate()+n);return iso(d)};
var fmtDate=function(s,o){return parseISO(s).toLocaleDateString('en-AU',o||{weekday:'short',day:'numeric',month:'short'})};
var num=function(n){return Math.round(n).toLocaleString('en-AU')};
var r1=function(n){return Math.round(n*10)/10};
var esc=function(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
var uid=function(){return Math.random().toString(36).slice(2,9)};
var clone=function(o){return JSON.parse(JSON.stringify(o))};
var $=function(s,r){return (r||document).querySelector(s)};
var roundStep=function(x,s){return Math.round(Math.round(x/s)*s*100)/100};
var fmtKg=function(w){return (w%1===0?String(w):String(r1(w)))};
var fmtClock=function(ms){var s=Math.max(0,Math.floor(ms/1000));return Math.floor(s/60)+':'+pad(s%60)};

/* ---------- icons ---------- */
var IC={
  today:'<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/></svg>',
  food:'<svg viewBox="0 0 24 24"><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10"/></svg>',
  train:'<svg viewBox="0 0 24 24"><path d="M3 9v6M6 6v12M18 6v12M21 9v6M6 12h12"/></svg>',
  prog:'<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M2 20h20"/></svg>',
  gear:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>',
  check:'<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>'
};

/* ---------- program (from the printed 5-day plan) ---------- */
/* start = rough first-session load in kg for a 70 kg lifter; per-hand for dumbbells, per-side for cables. inc = smallest sensible jump. */
function X(id,name,sets,lo,hi,rest,inc,start,muscle,cue,o){return Object.assign({id:id,name:name,sets:sets,lo:lo,hi:hi,rest:rest,inc:inc,start:start,muscle:muscle,cue:cue},o||{})}
var PROGRAM={
  push:{name:'Push A',tag:'Chest, shoulders, triceps',cue:'Controlled lowering. When you hit the top of the rep range on every set, add weight.',ex:[
    X('incline-db','Incline Dumbbell Press',3,6,10,150,2,18,'Upper chest','Bench 15-30 degrees. Control the lowering, press up and slightly inward.'),
    X('machine-chest','Machine Chest Press',2,8,12,120,5,40,'Chest','Shoulder blades steady, full comfortable range, no bouncing.'),
    X('db-shoulder','Seated Dumbbell Shoulder Press',2,8,12,120,2,16,'Front and side delts','Ribs down. Press up without arching your lower back.'),
    X('lat-raise','Cable Lateral Raise',4,12,20,75,1.25,5,'Side delts','Lead with the elbow, raise to shoulder height, no shrugging.'),
    X('pec-deck','Pec Deck Fly',2,12,15,75,5,35,'Chest','Soft elbows. Stretch under control and squeeze.'),
    X('oh-tri','Overhead Cable Triceps Extension',2,10,15,75,2.5,20,'Triceps long head','Keep elbows fixed, no swinging your torso.'),
    X('pushdown','Rope Triceps Pushdown',2,10,15,75,2.5,25,'Triceps','Upper arms still. Extend fully without snapping.')]},
  pull:{name:'Pull A',tag:'Back width, rear delts, biceps',cue:'Think elbows to pockets on vertical pulls. Do not turn pulldowns into a lower-back swing.',ex:[
    X('pullup','Pull-up / Assisted Pull-up',2,6,10,150,2.5,0,'Lats and upper back','Weight is added kg (use a minus number for assisted). Start from a stretch, pull elbows to ribs.',{bw:true,assisted:true}),
    X('lat-pulldown','Normal Lat Pulldown',2,8,12,120,5,50,'Lats','Lean back slightly, bar to upper chest, no jerking.'),
    X('cs-row','Chest-Supported Row',3,8,12,120,5,40,'Mid-back and lats','Chest on the pad, drive elbows behind your body.'),
    X('rev-pec','Reverse Pec Deck',3,12,20,75,5,30,'Rear delts','Open arms wide, no shrugging or swinging.'),
    X('incline-curl','Incline Dumbbell Curl',2,8,12,75,2,8,'Biceps','Elbows stay behind the torso, full controlled extension.'),
    X('hammer','Hammer Curl',2,10,15,75,2,12,'Brachialis and forearms','Neutral grip, no swinging or leaning back.'),
    X('farmer','Farmer Carry',2,30,45,90,2,20,'Traps, grip, core','Reps box is seconds. Walk tall, ribs over pelvis.',{timed:true})]},
  legsA:{name:'Legs A',tag:'Quads, hamstrings, calves, abs',cue:'Your shifts already tax your legs. Keep clean depth and stop a set if form breaks. Drop one set per move if your legs feel flat.',ex:[
    X('hack','Hack Squat / Squat',3,6,10,150,5,60,'Quads and glutes','Brace, comfortable depth, push evenly through the feet.'),
    X('rdl','Romanian Deadlift',3,8,10,150,5,50,'Hamstrings and glutes','Hips back, knees soft, bar close, neutral spine.'),
    X('leg-press','Leg Press',2,10,15,120,10,100,'Quads and glutes','Lower as far as your pelvis stays stable. Do not lock knees hard.'),
    X('seat-curl','Seated Leg Curl',2,10,15,80,5,35,'Hamstrings','Hips down, control both directions.'),
    X('stand-calf','Standing Calf Raise',3,8,15,75,5,50,'Calves','Pause at the stretch and the top. No bouncing.'),
    X('cable-crunch','Cable Crunch',3,10,15,75,2.5,30,'Abs','Curl ribs toward pelvis. Do not just move at the hips.')]},
  upper:{name:'Upper B',tag:'Lats, delts, upper chest',cue:'The one-arm pulldown and dumbbell row work both arms. Count one set per side as one set here.',ex:[
    X('incline-machine','Incline Machine Chest Press',3,8,12,120,5,35,'Upper chest','Shoulder blades set, lower slowly.'),
    X('hk-pulldown','Half-Kneeling 1-Arm Lat Pulldown',3,10,15,90,2.5,15,'Lats, each side','Pull elbow to hip, ribs down, match both sides.'),
    X('db-row','Bench-Supported 1-Arm DB Row',3,8,12,105,2,24,'Lats and mid-back','Brace on the bench, pull elbow toward hip, no twisting.'),
    X('lat-raise','Cable Lateral Raise',4,12,20,75,1.25,5,'Side delts','Lead with the elbow, 1 second pause at the top.'),
    X('rev-pec','Reverse Pec Deck',2,12,20,75,5,30,'Rear delts','Sweep arms out, do not turn it into a row.'),
    X('preacher','Preacher Curl',2,8,12,75,2.5,20,'Biceps','Upper arm on the pad, control the bottom stretch.'),
    X('pushdown','Rope Triceps Pushdown',2,10,15,75,2.5,25,'Triceps','Upper arms quiet, full elbow extension.')]},
  lower:{name:'Lower B',tag:'Legs, lower back, core',cue:'Keep 45-degree back extensions controlled. No hyperextending for a bigger burn.',ex:[
    X('bulgarian','Bulgarian Split Squat',3,8,12,120,2,12,'Quads and glutes, per leg','Front foot stable, long enough stride, control the descent.'),
    X('leg-ext','Leg Extension',2,12,15,75,5,40,'Quads','Control the top and bottom, no swinging.'),
    X('lying-curl','Lying Leg Curl',3,10,15,80,5,30,'Hamstrings','Hips stay on the pad, slow lowering.'),
    X('hip-thrust','Hip Thrust',2,8,12,105,5,60,'Glutes','Chin slightly tucked, pause with hips level at the top.'),
    X('seat-calf','Seated Calf Raise',3,12,20,75,5,30,'Calves','Full range, 1 second pause at both ends.'),
    X('back-ext','45-Degree Back Extension',2,10,15,80,2.5,0,'Spinal erectors and glutes','Weight is added kg. Hinge at the hips, stop when trunk is in line with legs.',{bw:true}),
    X('knee-raise','Hanging Knee Raise',2,10,15,75,0,0,'Lower abs','Tilt pelvis upward, no swinging.',{bw:true}),
    X('pallof','Pallof Press',2,10,12,75,2.5,10,'Obliques and core, per side','Press straight out, resist the cable pulling you into rotation.')]}
};
var DAY_ORDER=['push','pull','legsA','upper','lower'];
var WEEKDAY={1:'push',2:'pull',3:'legsA',5:'upper',6:'lower'};
var EXLIST=(function(){var m={};DAY_ORDER.forEach(function(k){PROGRAM[k].ex.forEach(function(e){if(!m[e.id])m[e.id]=e})});return m})();

/* ---------- food library ---------- */
/* macros are per "per" units */
function F(id,name,unit,per,def,k,p,c,f){return {id:id,name:name,unit:unit,per:per,def:def,k:k,p:p,c:c,f:f}}
var FOODS=[
  F('yogurt','Greek-style yogurt','g',100,200,90,8,5,4),
  F('oats','Rolled oats','g',100,50,375,13,60,7),
  F('banana','Banana','each',1,1,105,1.3,27,0.4),
  F('bread','Wholemeal bread','slice',1,2,90,4,15,1.2),
  F('canned','Canned chicken breast (drained)','g',100,100,125,22,0.5,4),
  F('chicken','Chicken breast, cooked','g',100,170,165,31,0,3.6),
  F('rice','Rice, cooked','g',100,200,130,2.7,28,0.3),
  F('veg','Vegetables, cooked','g',100,150,35,2,6,0.4),
  F('oil','Olive oil','tsp',1,1,40,0,0,4.5),
  F('egg','Egg, whole','each',1,2,78,6.3,0.6,5.3),
  F('whey','Whey protein in water','scoop',1,1,120,24,3,1.5),
  F('wrap','Wholemeal wrap','each',1,1,170,6,28,3.5),
  F('milk','Milk','ml',100,250,62,3.4,4.8,3.3),
  F('milkcoffee','Milk coffee','cup',1,1,120,6,9,6.5),
  F('tuna','Tuna in springwater','g',100,95,110,25,0,1),
  F('apple','Apple','each',1,1,80,0.4,21,0.3),
  F('pb','Peanut butter','tbsp',1,1,95,4,3.5,8),
  F('rtd','Protein drink (ready to drink)','each',1,1,170,25,8,3)
];
var MEALS=['Breakfast','Lunch','Snack','Post-gym','Dinner'];
var TPL=[
  {id:'bf',meal:'Breakfast',name:'Yogurt, oats, banana',items:[['yogurt',200],['oats',50],['banana',1]]},
  {id:'lunch',meal:'Lunch',name:'Chicken sandwich',items:[['bread',2],['canned',100]]},
  {id:'wrap',meal:'Snack',name:'Chicken wrap',items:[['wrap',1],['chicken',100]]},
  {id:'eggs',meal:'Snack',name:'2 eggs',items:[['egg',2]]},
  {id:'topup',meal:'Snack',name:'Top-up: PB toast, banana, milk coffee',items:[['bread',2],['pb',1],['banana',1],['milkcoffee',1]]},
  {id:'whey',meal:'Post-gym',name:'Whey in water',items:[['whey',1]]},
  {id:'dinner',meal:'Dinner',name:'Chicken, rice, veg',items:[['chicken',170],['rice',200],['veg',150],['oil',1]]}
];

/* ---------- state + storage ---------- */
var LS='vshape-tracker-v1';
function defProfile(){return {targets:{kcal:2350,protein:160,steps:20000,water:3000},weights:{},customFoods:[],baseline:null,notifPermission:null}}
var S={profile:defProfile(),days:{},photos:{},active:null,locked:false,lockReason:null,lockedSchemaFound:null};
var ui={tab:'today',date:todayISO(),today:todayISO(),wd:null,sheet:null,drafts:{},timer:null,exSel:'incline-db',dirty:false,storageOk:true,storageMsg:null,hcDenied:false};
var installEvt=null;

function saveLocal(){
  if(S.locked)return;
  try{
    localStorage.setItem(LS,JSON.stringify({schema:VShapeCore.SCHEMA_VERSION,profile:S.profile,days:S.days,active:S.active||null}));
    ui.storageOk=true;
  }catch(e){
    ui.storageOk=false;
    ui.storageMsg=(e&&e.name==='QuotaExceededError')?'Storage is full. Export a backup, then free up space on your device.':'Could not save your last change ('+(e&&e.message||'unknown error')+').';
  }
}
function loadLocal(){
  var raw;
  try{raw=localStorage.getItem(LS)}catch(e){raw=null}
  if(!raw)return;
  var parsed;
  try{parsed=JSON.parse(raw)}catch(e){S.locked=true;S.lockReason='corrupt';return}
  var out=VShapeCore.migrateBlob(parsed);
  if(out.locked){S.locked=true;S.lockReason='newer-schema';S.lockedSchemaFound=out.schemaFound;return}
  if(out.migrated){
    var backedUp=false;
    try{localStorage.setItem(LS+'-pre-migration-backup-'+Date.now(),raw);backedUp=true}catch(e){backedUp=false}
    if(!backedUp){S.locked=true;S.lockReason='backup-failed';return}
    idbPutSafety(raw);
  }
  S.profile=Object.assign(defProfile(),out.profile||{});
  S.profile.targets=Object.assign(defProfile().targets,S.profile.targets||{});
  if(!S.profile.weights)S.profile.weights={};
  if(!S.profile.customFoods)S.profile.customFoods=[];
  S.days=out.days||{};
  Object.keys(S.days).forEach(function(d){VShapeCore.quarantineInvalidSets(S.days[d],EXLIST)});
  S.active=parsed.active||null;
  if(S.active){
    var ad=S.days[S.active.date],asess=ad&&VShapeCore.findSessionById(ad,S.active.id);
    if(!asess||!(asess.status==='active'||asess.status==='paused')){S.active=null}
    else{ui.tab='train';ui.date=S.active.date;ui.wd=asess.day}
  }
  if(out.migrated)saveLocal();
}
function ensureDay(d){
  if(!S.days[d])S.days[d]={date:d,food:[],steps:0,stepsSource:null,water:0,sessions:[],quarantine:{sets:[],food:[]}};
  var x=S.days[d];
  if(!x.food)x.food=[];
  if(!x.sessions)x.sessions=[];
  if(!x.quarantine)x.quarantine={sets:[],food:[]};
  return x;
}
function queueSave(){saveLocal()}
function saveDay(d){queueSave('day-'+d)}
function saveProfile(){queueSave('profile')}

/* ---------- sessions (bridges S/ui onto VShapeCore's pure session model) ---------- */
function sessionFor(date,dayKey){
  var day=S.days[date];
  if(!day||!day.sessions)return null;
  var list=day.sessions.filter(function(s){return s.day===dayKey});
  return list.length?list[list.length-1]:null;
}
function getOpenSessionAnywhere(){
  if(!S.active)return null;
  var day=S.days[S.active.date];if(!day)return null;
  var s=VShapeCore.findSessionById(day,S.active.id);
  return (s&&(s.status==='active'||s.status==='paused'))?s:null;
}
function startOrGetSession(date,dayKey){
  var existing=sessionFor(date,dayKey);
  if(existing)return {session:existing,created:false};
  var open=getOpenSessionAnywhere();
  if(open)return {blocked:true,blockingSession:open};
  var day=ensureDay(date),s=VShapeCore.newSession(dayKey,Date.now());
  day.sessions.push(s);
  S.active={date:date,id:s.id};
  return {session:s,created:true};
}
function currentExerciseLabel(session,P){
  if(!P||!P.ex.length)return '';
  for(var i=0;i<P.ex.length;i++){
    var e=P.ex[i],done=((session.log[e.id])||[]).filter(Boolean).length;
    if(done<e.sets)return e.name;
  }
  return P.ex[P.ex.length-1].name;
}

function syncText(){
  if(!ui.hcAt)return isNative()?'Not synced yet':'Saved on this device';
  var m=Math.round((Date.now()-ui.hcAt)/60000);
  return 'Synced '+(m<1?'just now':m<60?m+' min ago':Math.round(m/60)+' h ago');
}

/* ---------- Android Health Connect bridge (only active inside the Capacitor app) ---------- */
function isNative(){try{return !!(window.Capacitor&&Capacitor.isNativePlatform&&Capacitor.isNativePlatform())}catch(e){return false}}
function hcPlugin(){
  try{
    var C=window.Capacitor;if(!C)return null;
    return (C.Plugins&&C.Plugins.HealthConnect)||(C.registerPlugin&&C.registerPlugin('HealthConnect'))||null;
  }catch(e){return null}
}
function wnPlugin(){
  try{
    var C=window.Capacitor;if(!C)return null;
    return (C.Plugins&&C.Plugins.WorkoutNotification)||(C.registerPlugin&&C.registerPlugin('WorkoutNotification'))||null;
  }catch(e){return null}
}
var HC_TYPES=['Steps','Weight','ActiveCaloriesBurned','RestingHeartRate'];
function hcRead(hc,type,from,to){
  var all=[];
  function page(token){
    var o={type:type,timeRangeFilter:{type:'between',startTime:from,endTime:to},pageSize:1000};
    if(token)o.pageToken=token;
    return hc.readRecords(o).then(function(r){
      var recs=(r&&r.records)||(Array.isArray(r)?r:[]);
      all=all.concat(recs);
      return r&&r.pageToken?page(r.pageToken):all;
    });
  }
  return page(null);
}
function hcSync(days,quiet){
  var hc=hcPlugin();
  if(!isNative()||!hc){if(!quiet)toast('Health sync only works in the Android app');return Promise.resolve(false)}
  if(ui.hcBusy)return Promise.resolve(false);
  var checkFn=hc.checkHealthPermissions||hc.hasPermissions||null;
  if(quiet&&!checkFn)return Promise.resolve(false); /* never prompt on a silent sync; and we cannot confirm permission without checkAvailability's own prompt-free call here */
  ui.hcBusy=true;
  var to=new Date(),from=new Date();from.setDate(from.getDate()-(days||14));from.setHours(0,0,0,0);
  var perm={read:HC_TYPES,write:[]};
  var ensurePerm=quiet?Promise.resolve(checkFn.call(hc,perm)):Promise.resolve(hc.requestHealthPermissions(perm));
  return Promise.resolve(hc.checkAvailability()).then(function(a){
    var st=a&&(a.availability||a.status||a);
    if(st==='NotInstalled'||st==='NotSupported'){throw new Error('Install Health Connect from the Play Store first')}
    return ensurePerm;
  }).then(function(permRes){
    var state=VShapeCore.hcPermissionState(permRes);
    if(state==='denied'){ui.hcBusy=false;ui.hcDenied=true;if(!quiet){toast('Health Connect permission was not granted');render()}return false}
    if(state==='unknown'&&quiet){ui.hcBusy=false;return false}
    ui.hcDenied=false;
    return Promise.all(HC_TYPES.map(function(t){return hcRead(hc,t,from,to).catch(function(){return []})}));
  }).then(function(res){
    if(!res)return false;
    var steps=VShapeCore.mergeSteps(res[0]),active=VShapeCore.mergeActiveCalories(res[2]),rhr=VShapeCore.mergeRestingHR(res[3]),weights=VShapeCore.mergeWeights(res[1]);
    var nd=0;
    Object.keys(steps).forEach(function(d){
      var day=ensureDay(d),policy=VShapeCore.stepsApplyPolicy(day,steps[d]);
      if(policy.apply){day.steps=steps[d];day.stepsSource='phone';delete day.phoneSteps;nd++}
      else if(policy.offerPhoneValue){day.phoneSteps=policy.offerPhoneValue}
    });
    Object.keys(active).forEach(function(d){ensureDay(d).active=active[d]});
    Object.keys(rhr).forEach(function(d){ensureDay(d).rhr=rhr[d]});
    Object.keys(weights).forEach(function(d){
      var policy=VShapeCore.weightApplyPolicy(S.profile.weights[d]);
      if(policy.apply)S.profile.weights[d]=weights[d];
    });
    Object.keys(S.days).forEach(function(d){saveDay(d)});saveProfile();
    ui.hcAt=Date.now();ui.hcBusy=false;
    render();if(!quiet)toast(nd?'Synced '+nd+' days from Health Connect':'Connected. No new step data found');
    return true;
  }).catch(function(err){
    ui.hcBusy=false;
    toast((err&&err.message)?err.message:'Could not reach Health Connect');
    render();
    return false;
  });
}
var idbP=null;
function idb(){
  if(idbP)return idbP;
  idbP=new Promise(function(res,rej){
    var r=indexedDB.open('vshape',2);
    r.onupgradeneeded=function(){
      var db=r.result;
      if(!db.objectStoreNames.contains('photos'))db.createObjectStore('photos',{keyPath:'date'});
      if(!db.objectStoreNames.contains('safety'))db.createObjectStore('safety',{keyPath:'ts'});
    };
    r.onsuccess=function(){res(r.result)};
    r.onerror=function(){rej(r.error)};
  });
  return idbP;
}
function idbRun(store,mode,fn){
  return idb().then(function(db){return new Promise(function(res,rej){
    var tx=db.transaction(store,mode),req=fn(tx.objectStore(store));
    tx.oncomplete=function(){res(req&&req.result)};
    tx.onerror=function(){rej(tx.error)};
  })});
}
function idbPutP(p){if(!p)return Promise.resolve({ok:true});return idbRun('photos','readwrite',function(s){return s.put(p)}).then(function(){return {ok:true}}).catch(function(){return {ok:false}})}
function idbDelP(d){return idbRun('photos','readwrite',function(s){return s.delete(d)}).then(function(){return {ok:true}}).catch(function(){return {ok:false}})}
function idbPut(p){idbPutP(p).then(function(r){if(!r.ok)toast('Could not keep that photo on this device')})}
function idbDel(d){idbDelP(d)}
function idbPutSafety(raw){idbRun('safety','readwrite',function(s){return s.put({ts:Date.now(),raw:raw})}).catch(function(){})}
function loadPhotos(){
  idbRun('photos','readonly',function(s){return s.getAll()}).then(function(list){
    (list||[]).forEach(function(p){S.photos[p.date]=p});
    softRender();
  }).catch(function(){});
}
function isStandalone(){try{return window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true}catch(e){return false}}
function initPwa(){
  if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(function(){})}
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
}
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();installEvt=e;softRender()});
window.addEventListener('appinstalled',function(){installEvt=null;softRender()});

/* ---------- derived data ---------- */
function allFoods(){return FOODS.concat(S.profile.customFoods||[])}
function findFood(id){return allFoods().filter(function(f){return f.id===id})[0]}
function scale(f,q){var m=q/f.per;return {k:f.k*m,p:f.p*m,c:f.c*m,f:f.f*m}}
function totals(d){
  var f=(S.days[d]&&S.days[d].food)||[];
  return f.reduce(function(a,e){return {k:a.k+e.k,p:a.p+e.p,c:a.c+e.c,f:a.f+e.f}},{k:0,p:0,c:0,f:0});
}
function autoDay(d){var w=parseISO(d).getDay();return WEEKDAY[w]||'rest'}
function curWd(){
  if(ui.wd)return ui.wd;
  var day=S.days[ui.date];
  if(day&&day.sessions&&day.sessions.length){
    var open=VShapeCore.findOpenSession(day);
    if(open)return open.day;
    return day.sessions[day.sessions.length-1].day;
  }
  return autoDay(ui.date);
}
function history(exId,before){
  var out=[];
  Object.keys(S.days).sort().forEach(function(d){
    if(before&&d>=before)return;
    (S.days[d].sessions||[]).forEach(function(session){
      var a=session.log&&session.log[exId];
      if(a){var sets=a.filter(Boolean);if(sets.length)out.push({d:d,sets:sets})}
    });
  });
  return out;
}
function suggest(ex,date){return VShapeCore.suggestProgression(ex,history(ex.id,date))}
function weekBlocks(n){
  var t=todayISO(),out=[];
  var avg=function(a){return a.length?a.reduce(function(s,v){return s+v},0)/a.length:null};
  for(var b=0;b<n;b++){
    var end=addDays(t,-7*b),days=[],ws=[],ks=[],ps=[],ss=[],ses=0,i;
    for(i=6;i>=0;i--)days.push(addDays(end,-i));
    days.forEach(function(d){
      var w=S.profile.weights[d];if(w)ws.push(w);
      var x=S.days[d];
      if(x){
        var tt=totals(d);if(tt.k>0){ks.push(tt.k);ps.push(tt.p)}
        if(x.steps>0)ss.push(x.steps);
        if(gymDone(d))ses++;
      }
    });
    out.push({end:end,w:avg(ws),nw:ws.length,k:avg(ks),nk:ks.length,p:avg(ps),s:avg(ss),ses:ses});
  }
  return out;
}
function weeklyCheck(){
  var bl=weekBlocks(2),cur=bl[0],prev=bl[1],T=S.profile.targets;
  if(cur.nw<2||prev.nw<2)return null;
  var d=cur.w-prev.w,adj=0,txt;
  if(d>-0.2){
    if(cur.nk<4)txt='Weight is flat or rising, but fewer than 4 days of food are logged this week. Log every day before changing anything.';
    else if(Math.abs(cur.k-T.kcal)>250)txt='Weight is flat or rising and you averaged '+num(cur.k)+' kcal against a target of '+num(T.kcal)+'. Match the target for a week before changing it.';
    else if(T.kcal<=2050)txt='Weight is flat at '+num(T.kcal)+' kcal already. Add 2,000 steps a day or take a week at maintenance instead of cutting further.';
    else{adj=-150;txt='Weight is flat or rising while you are on target. Take 150 kcal off the daily target.'}
  }else if(d<-0.7){adj=150;txt='Down '+r1(-d)+' kg in a week, faster than 0.7. Eat 150 kcal more to protect your muscle.'}
  else txt='Down '+r1(-d)+' kg, right on pace. Keep the target as it is.';
  if(adj&&S.profile.adjOn&&S.profile.adjOn>addDays(todayISO(),-7)){adj=0;txt='You changed the target on '+fmtDate(S.profile.adjOn,{day:'numeric',month:'short'})+'. Give it a full week before the next change.'}
  return {cur:cur.w,prev:prev.w,d:d,txt:txt,adj:adj};
}

/* ---------- views ---------- */
function ring(val,tgt,color,label,sub){
  var p=Math.max(0,Math.min(val/tgt,1)),C=2*Math.PI*40,over=label==='Calories'&&val>tgt;
  return '<div><div class="ringc"><svg viewBox="0 0 100 100" role="img" aria-label="'+label+' '+num(val)+' of '+num(tgt)+'"><circle class="rt" cx="50" cy="50" r="40"/><circle class="rv" cx="50" cy="50" r="40" style="stroke:'+(over?'var(--warn)':color)+'" stroke-dasharray="'+(p*C).toFixed(1)+' '+C.toFixed(1)+'" transform="rotate(-90 50 50)"/></svg><div class="rc"><b>'+num(val)+'</b><small>'+sub+'</small></div></div><div class="rl"><b>'+label+'</b><span class="muted">of '+num(tgt)+'</span></div></div>';
}
function header(){
  var isT=ui.date===todayISO();
  return '<header class="top"><div class="bar"><div class="brand"><span class="mark"></span>V-SHAPE</div><span class="sync" id="sync">'+syncText()+'</span><button class="icon" data-act="settings" aria-label="Settings">'+IC.gear+'</button></div>'+
  '<div class="datenav"><button class="icon" data-act="dprev" aria-label="Previous day">&#8249;</button><button class="dlabel" data-act="dtoday" aria-label="Jump to today">'+(isT?'Today, ':'')+esc(fmtDate(ui.date))+'</button><button class="icon" data-act="dnext" aria-label="Next day"'+(isT?' disabled':'')+'>&#8250;</button></div></header>';
}
function setsDone(key,date){
  var P=PROGRAM[key];if(!P)return {done:0,total:0,vol:0};
  return VShapeCore.sessionSetsDone(sessionFor(date,key),P);
}
function gymDone(d){
  var x=S.days[d];
  return !!(x&&x.sessions&&x.sessions.some(function(s){return Object.keys(s.log||{}).some(function(id){return (s.log[id]||[]).some(Boolean)})}));
}
function hasActivity(d){var y=S.days[d];return !!(y&&((y.food&&y.food.length)||y.steps>0||gymDone(d)))}
function streak(){var n=0,d=todayISO();if(!hasActivity(d))d=addDays(d,-1);while(hasActivity(d)){n++;d=addDays(d,-1)}return n}
function greet(){var h=new Date().getHours();return h<5?'Late night':h<12?'Good morning':h<18?'Good afternoon':'Good evening'}
function heroHTML(){
  var n=streak(),T=S.profile.targets,tot=totals(todayISO()),pct=Math.round(Math.min(1,tot.p/T.protein)*100);
  return '<div class="hero"><div class="grow"><div class="hello">'+greet()+'</div><div class="muted small">'+(ui.date===todayISO()?'Protein is '+pct+'% of target':'Viewing '+esc(fmtDate(ui.date)))+'</div></div>'+
    '<div class="streak" title="Days in a row with anything logged">'+(n?'<b>'+n+'</b><span>day streak</span>':'<span>Log today to<br>start a streak</span>')+'</div></div>';
}
function weekStrip(){
  var T=S.profile.targets,days=lastDays(7);
  return '<div class="week" role="group" aria-label="Last 7 days">'+days.map(function(d){
    var x=S.days[d],score=0;
    if(x&&x.food&&x.food.length)score++;
    if(x&&x.steps>=T.steps)score++;
    if(gymDone(d))score++;
    var lab=parseISO(d).toLocaleDateString('en-AU',{weekday:'narrow'});
    return '<button class="wd s'+score+(d===ui.date?' sel':'')+'" data-act="gotod" data-d="'+d+'" aria-label="'+esc(fmtDate(d))+', '+score+' of 3 goals"><small>'+lab+'</small><i></i></button>';
  }).join('')+'</div><div class="muted small weekkey">Each day fills as you log food, hit your steps, and train.</div>';
}
function syncRow(){
  if(!isNative())return '';
  return '<button class="btn full" style="margin-top:10px" data-act="hcsync"'+(ui.hcBusy?' disabled':'')+'>'+(ui.hcBusy?'Syncing...':'Sync from Health Connect')+'</button>'+
    (ui.hcDenied?'<div class="muted small" style="margin-top:6px">Health Connect permission was not granted. You can still enter steps and weight by hand.</div>':'');
}
function healthCard(steps,d){
  var km=steps*0.00075,active=(d&&d.active)||Math.round(steps*0.045),est=!(d&&d.active);
  var wkStart=lastDays(7),sess=wkStart.filter(gymDone).length;
  var tiles=[['Distance',r1(km)+' km','estimated'],['Active',num(active)+' kcal',est?'estimated':'from phone'],['Resting HR',d&&d.rhr?d.rhr+' bpm':'&ndash;','from phone'],['Gym, 7 days',sess+' / 5','sessions']];
  return '<div class="card"><h3>Activity</h3><div class="tiles">'+tiles.map(function(t){return '<div class="tile"><small>'+t[0]+'</small><b>'+t[1]+'</b><span>'+t[2]+'</span></div>'}).join('')+'</div></div>';
}
function waterCard(d){
  var T=S.profile.targets,ml=(d&&d.water)||0,tg=T.water||3000,p=Math.min(100,ml/tg*100);
  return '<div class="card"><h3>Water</h3><div class="row"><div class="stepbig grow">'+r1(ml/1000)+'<span class="muted small"> / '+r1(tg/1000)+' L</span></div><button class="chip" data-act="wateradd" data-n="-250" aria-label="Remove a glass">-250</button><button class="chip on" data-act="wateradd" data-n="250" aria-label="Add a glass">+250 ml</button></div><div class="pb"><i style="width:'+p+'%;background:var(--water)"></i></div></div>';
}
function viewToday(){
  var T=S.profile.targets,d=S.days[ui.date],tot=totals(ui.date),steps=(d&&d.steps)||0;
  var remK=T.kcal-tot.k,remP=T.protein-tot.p;
  var rem=(remK>=0?num(remK)+' kcal left':num(-remK)+' kcal over')+' and '+(remP>0?num(remP)+' g protein to go':'protein target met');
  var key=curWd(),P=PROGRAM[key],sd=P?setsDone(key,ui.date):null;
  var wc=weeklyCheck(),wToday=S.profile.weights[ui.date];
  var train=P?'<div class="row"><div class="grow"><div class="num" style="font-size:26px;font-weight:700">'+esc(P.name)+'</div><div class="muted small">'+esc(P.tag)+'</div></div><div class="num" style="font-size:22px;font-weight:600">'+sd.done+'/'+sd.total+'<span class="muted small"> sets</span></div></div><button class="btn full" style="margin-top:12px" data-act="tab" data-tab="train">'+(sd.done?'Continue workout':'Open workout')+'</button>':'<div class="muted">Rest day. Normal work and walking are enough. You can still open a session from the Train tab.</div>';
  return installBanner()+heroHTML()+weekStrip()+'<div class="card"><div class="rings">'+ring(tot.k,T.kcal,'var(--accent)','Calories','kcal')+ring(tot.p,T.protein,'var(--protein)','Protein','g')+ring(steps,T.steps,'var(--steps)','Steps','steps')+'</div><div class="rem">'+rem+'</div><div class="muted small" style="margin-top:6px">Carbs '+num(tot.c)+' g &middot; Fat '+num(tot.f)+' g</div></div>'+
  '<div class="card"><h3>Steps</h3><div class="row"><div class="stepbig grow">'+num(steps)+'</div><button class="chip" data-act="stepadd" data-n="1000">+1,000</button><button class="chip" data-act="stepadd" data-n="-1000">-1,000</button></div>'+
  '<div class="inline" style="margin-top:10px"><input id="stepsIn" inputmode="numeric" placeholder="Type today\'s count from Samsung Health" aria-label="Steps"><button class="btn" data-act="stepset">Set</button></div>'+
  (d&&d.phoneSteps&&d.phoneSteps!==steps?'<button class="btn ghost sm" style="margin-top:8px" data-act="usephonestep" data-n="'+d.phoneSteps+'">Use phone value: '+num(d.phoneSteps)+'</button>':'')+
  syncRow()+'<button class="btn ghost full" style="margin-top:10px" data-act="importsteps">Import Samsung Health file</button>'+
  '<details><summary>How to get steps out of Samsung Health</summary><ol><li>Samsung Health, then Settings, then Download personal data.</li><li>Open the downloaded folder and find the file with step_daily_trend or pedometer_day_summary in its name (.csv).</li><li>Tap Import above and choose it. Every day in the file is filled in at once.</li></ol><p style="margin:8px 0 0">'+(isNative()?'Samsung Health writes to Health Connect, so the sync button above picks up steps from it.':'A web page cannot read Samsung Health live. Install the Android app build (see ANDROID.md) to sync steps automatically through Health Connect.')+'</p></details></div>'+
  healthCard(steps,d)+waterCard(d)+
  '<div class="card"><h3>Training</h3>'+train+'</div>'+
  '<div class="card"><h3>Weigh-in</h3><div class="inline"><input id="wIn" inputmode="decimal" placeholder="'+(wToday?wToday+' kg logged':'Morning weight in kg')+'" aria-label="Body weight in kg"><button class="btn" data-act="wlog">Log</button></div>'+
  (wc?'<div style="margin-top:10px"><span class="num" style="font-size:22px;font-weight:700">'+r1(wc.cur)+' kg</span> <span class="muted small">7-day average, '+(wc.d>0?'+':'')+r1(wc.d)+' kg vs the week before</span><div class="small" style="margin-top:4px">'+wc.txt+'</div>'+(wc.adj?'<button class="btn sm" style="margin-top:8px" data-act="applyadj">Set target to '+num(Math.max(1900,S.profile.targets.kcal+wc.adj))+' kcal</button>':'')+'</div>':'<div class="muted small" style="margin-top:10px">Weigh in 3 or more mornings a week, same conditions. After two weeks you get a calorie adjustment here.</div>')+'</div>';
}
function foodRow(e){
  return '<div class="ent"><div class="n">'+esc(e.name)+'<div class="muted small">'+(e.qty%1===0?e.qty:r1(e.qty))+' '+esc(e.unit)+' &middot; '+num(e.p)+' g protein</div></div><div class="k">'+num(e.k)+'</div><button class="icon" data-act="delfood" data-id="'+e.id+'" aria-label="Remove '+esc(e.name)+'">&times;</button></div>';
}
function tplK(t){return t.items.reduce(function(a,it){return a+scale(findFood(it[0]),it[1]).k},0)}
function viewFood(){
  var d=S.days[ui.date],T=S.profile.targets,tot=totals(ui.date),food=(d&&d.food)||[];
  var pk=Math.min(100,tot.k/T.kcal*100),pp=Math.min(100,tot.p/T.protein*100);
  var out='<div class="card"><div class="mac"><div><div class="muted small">Calories</div><b>'+num(tot.k)+'</b><span class="muted small"> / '+num(T.kcal)+'</span><div class="pb"><i style="width:'+pk+'%;background:'+(tot.k>T.kcal?'var(--warn)':'var(--accent)')+'"></i></div></div><div><div class="muted small">Protein</div><b>'+num(tot.p)+'</b><span class="muted small"> / '+num(T.protein)+' g</span><div class="pb"><i style="width:'+pp+'%;background:var(--protein)"></i></div></div></div><div class="muted small" style="margin-top:10px">Carbs '+num(tot.c)+' g &middot; Fat '+num(tot.f)+' g</div></div>';
  out+='<div class="card"><h3>Your usual meals</h3><div class="chips">'+TPL.map(function(t){return '<button class="chip" data-act="tpl" data-id="'+t.id+'"><b>'+t.meal+'</b> '+esc(t.name)+' &middot; '+num(tplK(t))+'</button>'}).join('')+'</div>';
  var y=S.days[addDays(ui.date,-1)];
  if(!food.length&&y&&y.food&&y.food.length)out+='<button class="btn ghost sm" style="margin-top:8px" data-act="copyy">Copy yesterday\'s food</button>';
  out+='</div>';
  MEALS.forEach(function(m){
    var es=food.filter(function(e){return (MEALS.indexOf(e.meal)<0?'Snack':e.meal)===m});
    var k=es.reduce(function(a,e){return a+e.k},0);
    out+='<div class="card meal"><div class="meal-h"><h3>'+m+(k?' <span class="muted num" style="font-weight:600">'+num(k)+' kcal</span>':'')+'</h3><button class="btn sm" data-act="addopen" data-meal="'+m+'">Add</button></div>'+(es.length?es.map(foodRow).join(''):'<div class="empty">Nothing logged.</div>')+'</div>';
  });
  return out;
}
function e1rm(ex,s){return VShapeCore.e1rm(ex,s)}
function isPR(ex,date,logged){return VShapeCore.isPR(ex,history(ex.id,date),logged)}
function lifecycleBar(session,P){
  if(!session)return '<div class="card lc"><button class="btn full" data-act="startworkout">Start workout</button></div>';
  var elapsed=VShapeCore.sessionElapsedMs(session,Date.now()),timeTxt=fmtClock(elapsed);
  if(session.status==='finished')return '<div class="card lc"><div class="row"><div class="grow muted small">Finished '+esc(P?P.name:'workout')+' &middot; '+timeTxt+' elapsed.</div><button class="btn ghost sm" data-act="startworkout">Start another</button></div></div>';
  var isPaused=session.status==='paused';
  return '<div class="card lc'+(isPaused?' paused':'')+'"><div class="row"><div class="grow"><b>'+(isPaused?'Workout paused':'Workout active')+'</b><div class="muted small">'+timeTxt+' elapsed</div></div>'+
    '<button class="btn sm" data-act="'+(isPaused?'resumeworkout':'pauseworkout')+'">'+(isPaused?'Resume':'Pause')+'</button>'+
    '<button class="btn ghost sm" style="margin-left:6px" data-act="finishworkout">Finish</button></div></div>';
}
function viewTrain(){
  var key=curWd(),pills='<div class="pills" role="group" aria-label="Workout day">'+DAY_ORDER.map(function(k){return '<button class="pill" data-act="wd" data-k="'+k+'" aria-pressed="'+(k===key)+'">'+esc(PROGRAM[k].name)+'</button>'}).join('')+'</div>';
  if(key==='rest')return pills+'<div class="card"><h3>Rest day</h3><p style="margin:0">Thursday and Sunday are for recovery. Normal work and walking are enough. Pick a session above if you want to train anyway.</p></div>';
  var P=PROGRAM[key],sd=setsDone(key,ui.date),session=sessionFor(ui.date,key),log=(session&&session.log)||{};
  var out=pills+lifecycleBar(session,P)+'<div class="card"><div class="row"><div class="grow"><div class="num" style="font-size:30px;font-weight:700;line-height:1.1">'+esc(P.name)+'</div><div class="muted small">'+esc(P.tag)+'</div></div><div style="text-align:right"><div class="num" style="font-size:24px;font-weight:700">'+sd.done+'/'+sd.total+'</div><div class="muted small">'+(sd.vol?num(sd.vol)+' kg volume':'sets done')+'</div></div></div><div class="cue">'+esc(P.cue)+'</div></div>';
  P.ex.forEach(function(ex){
    var sg=suggest(ex,ui.date),rows='',logged=log[ex.id]||[];
    for(var i=0;i<ex.sets;i++){
      var L=logged[i],dr=ui.drafts[ui.date+'|'+ex.id+'|'+i]||{};
      var prevLogged=null;for(var j=i-1;j>=0;j--){if(logged[j]){prevLogged=logged[j];break}}
      var w=L?L.w:(dr.w!==undefined?dr.w:fmtKg(prevLogged?prevLogged.w:sg.w));
      var r=L?L.r:(dr.r!==undefined?dr.r:sg.reps[i]);
      rows+='<div class="set'+(L?' done':'')+'" data-ex="'+ex.id+'" data-i="'+i+'"><span class="sn">'+(i+1)+'</span><div><label for="w-'+ex.id+i+'">'+(ex.bw?'+kg':'kg')+'</label><input id="w-'+ex.id+i+'" data-f="w" inputmode="decimal" value="'+esc(w)+'"'+(L?' disabled':'')+'></div><div><label for="r-'+ex.id+i+'">'+(ex.timed?'sec':'reps')+'</label><input id="r-'+ex.id+i+'" data-f="r" inputmode="numeric" value="'+esc(r)+'"'+(L?' disabled':'')+'></div><button class="ck" data-act="logset" aria-label="'+(L?'Undo':'Log')+' set '+(i+1)+' of '+esc(ex.name)+'">'+IC.check+'</button></div>';
    }
    var lastTxt=sg.last?'Last ('+fmtDate(sg.last.d,{day:'numeric',month:'short'})+'): '+sg.last.sets.map(function(s){return fmtKg(s.w)+' x '+s.r}).join(', '):'';
    out+='<div class="card ex"><div class="ex-h"><div class="grow"><h3>'+esc(ex.name)+'</h3><div class="muted small">'+esc(ex.muscle)+' &middot; rest '+(ex.rest>=120?Math.round(ex.rest/60*2)/2+' min':ex.rest+' s')+'</div></div><span class="rng">'+(isPR(ex,ui.date,logged)?'<b class="pr">PR</b> ':'')+ex.sets+' x '+ex.lo+'&ndash;'+ex.hi+(ex.timed?'s':'')+'</span></div>'+
    '<div class="sug">'+(lastTxt?'<div class="muted small">'+esc(lastTxt)+'</div>':'')+'<b>Today: '+(ex.bw&&sg.w===0?'bodyweight':fmtKg(sg.w)+' kg')+', aim '+sg.reps.join(' / ')+(ex.timed?' s':' reps')+'</b><div class="small">'+esc(sg.note)+'</div></div>'+rows+'<div class="cue">'+esc(ex.cue)+'</div></div>';
  });
  return out;
}

/* ---------- charts ---------- */
function niceMax(v){var p=Math.pow(10,Math.floor(Math.log10(v||1))),m=v/p,n=m<=1?1:m<=2?2:m<=2.5?2.5:m<=5?5:10;return n*p}
function kfmt(v){return v>=1000?(Math.round(v/100)/10)+'k':String(Math.round(v*10)/10)}
function barChart(vals,labels,target,fmt){
  if(!vals||!vals.length)return '<div class="empty">No data yet.</div>';
  var W=340,H=150,L=36,R=6,T=10,B=22,max=niceMax(Math.max(target||0,Math.max.apply(null,vals),1)*1.05),iw=W-L-R,ih=H-T-B,bw=iw/vals.length;
  var y=function(v){return T+ih-(v/max)*ih},s='<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Bar chart of the last '+vals.length+' days">';
  [0,max/2,max].forEach(function(t){s+='<line class="ax" x1="'+L+'" x2="'+(W-R)+'" y1="'+y(t)+'" y2="'+y(t)+'"/><text class="tx" x="'+(L-5)+'" y="'+(y(t)+3)+'" text-anchor="end">'+(fmt||kfmt)(t)+'</text>'});
  vals.forEach(function(v,i){var bx=L+i*bw+bw*0.15,by=y(v);s+='<rect x="'+bx.toFixed(1)+'" y="'+by.toFixed(1)+'" width="'+(bw*0.7).toFixed(1)+'" height="'+Math.max(0,T+ih-by).toFixed(1)+'" rx="2" fill="var(--accent)"'+(v===0?' opacity="0"':'')+'/>'});
  if(target)s+='<line class="tg" x1="'+L+'" x2="'+(W-R)+'" y1="'+y(target)+'" y2="'+y(target)+'"/><text class="tl" x="'+(W-R)+'" y="'+(y(target)-4)+'" text-anchor="end">target '+(fmt||kfmt)(target)+'</text>';
  [0,Math.floor((vals.length-1)/2),vals.length-1].forEach(function(i,k){s+='<text class="tx" x="'+(L+i*bw+bw/2)+'" y="'+(H-6)+'" text-anchor="'+(k===0?'start':k===2?'end':'middle')+'">'+fmtDate(labels[i],{day:'numeric',month:'short'})+'</text>'});
  return s+'</svg>';
}
function lineChart(pts,unit){
  if(!pts||!pts.length)return '<div class="empty">No data yet.</div>';
  var W=340,H=150,L=38,R=14,T=14,B=22,iw=W-L-R,ih=H-T-B;
  var ys=pts.map(function(p){return p.v}),mn=Math.min.apply(null,ys),mx=Math.max.apply(null,ys),pd=Math.max((mx-mn)*0.2,mx*0.02,0.5);
  mn=Math.max(0,mn-pd);mx=mx+pd;
  var t0=parseISO(pts[0].d).getTime(),t1=parseISO(pts[pts.length-1].d).getTime(),span=Math.max(t1-t0,1);
  var x=function(p){return pts.length===1?L+iw/2:L+(parseISO(p.d).getTime()-t0)/span*iw},y=function(v){return T+ih-(v-mn)/(mx-mn)*ih};
  var s='<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Line chart">';
  [mn,(mn+mx)/2,mx].forEach(function(t){s+='<line class="ax" x1="'+L+'" x2="'+(W-R)+'" y1="'+y(t)+'" y2="'+y(t)+'"/><text class="tx" x="'+(L-5)+'" y="'+(y(t)+3)+'" text-anchor="end">'+r1(t)+'</text>'});
  s+='<polyline class="ln" points="'+pts.map(function(p){return x(p).toFixed(1)+','+y(p.v).toFixed(1)}).join(' ')+'"/>';
  pts.forEach(function(p,i){s+='<circle class="dot" cx="'+x(p).toFixed(1)+'" cy="'+y(p.v).toFixed(1)+'" r="'+(i===pts.length-1?4:3)+'"/>'});
  var lp=pts[pts.length-1];s+='<text class="vl" x="'+x(lp).toFixed(1)+'" y="'+(y(lp.v)-9).toFixed(1)+'" text-anchor="end">'+r1(lp.v)+' '+unit+'</text>';
  if(pts.length>1){s+='<text class="tx" x="'+L+'" y="'+(H-6)+'">'+fmtDate(pts[0].d,{day:'numeric',month:'short'})+'</text><text class="tx" x="'+(W-R)+'" y="'+(H-6)+'" text-anchor="end">'+fmtDate(lp.d,{day:'numeric',month:'short'})+'</text>'}
  else s+='<text class="tx" x="'+(W/2)+'" y="'+(H-6)+'" text-anchor="middle">'+fmtDate(lp.d,{day:'numeric',month:'short'})+'</text>';
  return s+'</svg>';
}
function lastDays(n){var a=[],t=todayISO();for(var i=n-1;i>=0;i--)a.push(addDays(t,-i));return a}
function viewProgress(){
  var T=S.profile.targets,days=lastDays(14),steps=days.map(function(d){return (S.days[d]&&S.days[d].steps)||0}),kc=days.map(function(d){return Math.round(totals(d).k)});
  var stepDays=steps.filter(Boolean),kDays=days.filter(function(d){return totals(d).k>0});
  var avgS=stepDays.length?stepDays.reduce(function(a,b){return a+b},0)/stepDays.length:0;
  var avgK=kDays.length?kDays.reduce(function(a,d){return a+totals(d).k},0)/kDays.length:0,avgP=kDays.length?kDays.reduce(function(a,d){return a+totals(d).p},0)/kDays.length:0;
  var wd=Object.keys(S.profile.weights).sort().map(function(d){return {d:d,v:S.profile.weights[d]}}).slice(-60);
  var out=viewWeekly()+'<div class="card"><h3>Body weight</h3>'+(wd.length?lineChart(wd,'kg'):'<div class="empty">Log a weigh-in on the Today tab to start the trend.</div>')+'</div>';
  var bl=S.profile.baseline;
  if(bl&&(bl.weight!=null||bl.bodyFatPct!=null||bl.label)){
    out+='<div class="card"><h3>Where you started</h3><div class="small">'+(bl.label?esc(bl.label)+': ':'')+(bl.weight!=null?bl.weight+' kg':'')+(bl.bodyFatPct!=null?(bl.weight!=null?', ':'')+bl.bodyFatPct+'% body fat':'')+'</div></div>';
  }
  out+=viewPhotos();
  out+='<div class="card"><h3>Steps, last 14 days</h3>'+barChart(steps,days,T.steps)+'<div class="stat"><div><b>'+num(avgS)+'</b><div class="muted small">average on logged days</div></div><div><b>'+steps.filter(function(s){return s>=T.steps}).length+'</b><div class="muted small">days on target</div></div></div></div>';
  out+='<div class="card"><h3>Calories, last 14 days</h3>'+barChart(kc,days,T.kcal)+'<div class="stat"><div><b>'+num(avgK)+'</b><div class="muted small">average kcal logged</div></div><div><b>'+num(avgP)+' g</b><div class="muted small">average protein</div></div></div></div>';
  var opts=Object.keys(EXLIST).map(function(id){var n=history(id).length;return '<option value="'+id+'"'+(id===ui.exSel?' selected':'')+'>'+esc(EXLIST[id].name)+(n?' ('+n+')':'')+'</option>'}).join('');
  var ex=EXLIST[ui.exSel]||EXLIST['incline-db'],h=history(ex.id),pts=h.map(function(s){
    var v;if(ex.timed)v=Math.max.apply(null,s.sets.map(function(x){return x.r}));
    else if(ex.bw&&s.sets.every(function(x){return !x.w}))v=Math.max.apply(null,s.sets.map(function(x){return x.r}));
    else v=Math.max.apply(null,s.sets.map(function(x){return x.w*(1+x.r/30)}));
    return {d:s.d,v:v}});
  var unit=ex.timed||(ex.bw&&h.length&&h.every(function(s){return s.sets.every(function(x){return !x.w})}))?(ex.timed?'s':'reps'):'kg';
  out+='<div class="card"><h3>Strength</h3><select id="exsel" aria-label="Exercise">'+opts+'</select><div style="margin-top:10px">'+(pts.length?lineChart(pts,unit):'<div class="empty">No sets logged for this exercise yet.</div>')+'</div>'+(pts.length?'<div class="muted small">'+(unit==='kg'?'Estimated one-rep max from your best set each session.':'Best set each session.')+'</div>':'')+'</div>';
  return out;
}

/* ---------- weekly check-in + photos ---------- */
function viewWeekly(){
  var T=S.profile.targets,bl=weekBlocks(6),wc=weeklyCheck(),last=-1;
  bl.forEach(function(b,i){if(b.nw||b.nk||b.s||b.ses)last=i});
  var rows=bl.slice(0,last+1).map(function(b,i){
    var pv=bl[i+1],ch=(b.nw>=2&&pv&&pv.nw>=2)?b.w-pv.w:null;
    var cls=ch===null?'':(ch<=-0.2&&ch>=-0.7?'good':'bad');
    return '<tr><td>'+esc(fmtDate(b.end,{day:'numeric',month:'short'}))+'</td><td>'+(b.w?r1(b.w):'&ndash;')+'</td><td class="'+cls+'">'+(ch===null?'&ndash;':(ch>0?'+':'')+r1(ch))+'</td><td>'+(b.k?num(b.k):'&ndash;')+'</td><td>'+(b.p?num(b.p):'&ndash;')+'</td><td>'+(b.s?num(b.s):'&ndash;')+'</td><td>'+b.ses+'/5</td></tr>';
  }).join('');
  return '<div class="card"><h3>Weekly check-in</h3><div class="small muted">Goal pace is 0.3 to 0.5 kg lost per week. Each row covers the 7 days ending on that date.</div>'+
    (wc?'<div class="prev"><b>'+esc(wc.txt)+'</b></div>'+(wc.adj?'<button class="btn full" data-act="applyadj">Set target to '+num(Math.max(1900,T.kcal+wc.adj))+' kcal</button>':''):'<div class="prev">Weigh in at least twice in each of the last two weeks and the app will tell you whether to change your calories.</div>')+
    (rows?'<div class="wk"><table><thead><tr><th>Week to</th><th>kg</th><th>Change</th><th>kcal</th><th>Protein</th><th>Steps</th><th>Gym</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'')+
    '<details><summary>Phase guide</summary><ol><li>Weeks 1 and 2: hit '+num(T.kcal)+' kcal and '+T.protein+' g protein, steps on shifts, 5 gym days. This sets your baseline.</li><li>Weeks 3 to 8: change calories once a week at most, by 150 kcal, using the check above.</li><li>Once your abs are visible: eat about 2,600 kcal for two weeks to hold the look, then reassess.</li><li>If your lifts fall for two weeks and you feel flat, eat about 2,600 kcal for 5 to 7 days, then resume.</li></ol></details></div>';
}
function viewPhotos(){
  var keys=Object.keys(S.photos).sort(),o='<div class="card"><h3>Progress photos</h3>';
  function cap(k){var p=S.photos[k];return esc(fmtDate(k,{day:'numeric',month:'short'}))+(p.w?' &middot; '+p.w+' kg':'')}
  if(!keys.length)o+='<div class="small muted">Take one front photo each week: same spot, same light, same distance, relaxed. Photos show changes the scale misses. They are resized small and kept with your logs.</div>';
  else{
    if(keys.length>1){var a=keys[0],b=keys[keys.length-1];o+='<div class="cmp"><figure><img alt="First progress photo" src="'+esc(S.photos[a].img)+'"><figcaption>'+cap(a)+'<br><span class="muted">First</span></figcaption></figure><figure><img alt="Latest progress photo" src="'+esc(S.photos[b].img)+'"><figcaption>'+cap(b)+'<br><span class="muted">Latest</span></figcaption></figure></div>'}
    o+='<div class="thumbs">'+keys.slice().reverse().map(function(k){return '<button data-act="openphoto" data-d="'+k+'" aria-label="Open photo from '+k+'"><img alt="" src="'+esc(S.photos[k].img)+'"><span>'+esc(fmtDate(k,{day:'numeric',month:'short'}))+'</span></button>'}).join('')+'</div>';
  }
  return o+'<button class="btn full" style="margin-top:12px" data-act="addphoto">Add photo for '+esc(fmtDate(ui.date,{day:'numeric',month:'short'}))+'</button></div>';
}
function photoHTML(){
  var s=ui.sheet,p=S.photos[s.d];
  var head='<div class="sh-h"><h3>'+esc(fmtDate(s.d,{weekday:'long',day:'numeric',month:'long'}))+'</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>';
  if(!p)return head;
  var w=S.profile.weights[s.d];
  return head+'<img class="bigph" alt="Progress photo from '+esc(s.d)+'" src="'+esc(p.img)+'">'+(w?'<div class="muted small" style="margin-top:8px">Logged weight that day: '+w+' kg</div>':'')+
    (s.confirm?'<div class="two" style="margin-top:12px"><button class="btn ghost" data-act="closesheet">Keep</button><button class="btn" style="background:var(--warn);color:var(--accent-ink)" data-act="delphoto2">Delete photo</button></div>':'<button class="btn ghost full" style="margin-top:12px" data-act="delphoto">Delete photo</button>');
}
function savePhoto(d){idbPut(S.photos[d])}
function deletePhotoRemote(d){idbDel(d)}
function shrink(file,cb){
  var url=URL.createObjectURL(file),im=new Image();
  im.onload=function(){
    var sc=Math.min(1,720/Math.max(im.width,im.height)),w=Math.round(im.width*sc),h=Math.round(im.height*sc),c=document.createElement('canvas');
    c.width=w;c.height=h;c.getContext('2d').drawImage(im,0,0,w,h);URL.revokeObjectURL(url);
    var q=0.75,out=c.toDataURL('image/jpeg',q);
    while(out.length>170000&&q>0.4){q-=0.1;out=c.toDataURL('image/jpeg',q)}
    cb(out.length>240000?null:out);
  };
  im.onerror=function(){URL.revokeObjectURL(url);cb(null)};
  im.src=url;
}

/* ---------- native workout notification bridge ---------- */
function pushNotificationState(){
  var plugin=wnPlugin();if(!plugin||!isNative())return;
  var s=getOpenSessionAnywhere();
  if(!VShapeCore.shouldShowNotification(s)){if(plugin.hide)Promise.resolve(plugin.hide()).catch(function(){});return}
  var P=PROGRAM[s.day],sd=VShapeCore.sessionSetsDone(s,P);
  var payload={
    sessionId:s.id,title:P?P.name:'Workout',status:s.status,
    startedAtEpochMs:s.startedAt,pausedMs:s.pausedMs||0,
    elapsedMs:VShapeCore.sessionElapsedMs(s,Date.now()),
    setsDone:sd.done,setsTotal:sd.total,
    exerciseName:currentExerciseLabel(s,P),
    restActive:!!s.rest,restPaused:s.rest?!!s.rest.paused:false,
    restDeadlineEpochMs:(s.rest&&!s.rest.paused)?s.rest.deadline:null,
    restRemainingMs:s.rest?VShapeCore.restRemainingMs(s,Date.now()):null
  };
  if(plugin.show)Promise.resolve(plugin.show(payload)).catch(function(){});
}
function reconcileNativeActions(){
  var plugin=wnPlugin();if(!plugin||!isNative())return Promise.resolve();
  return Promise.resolve(plugin.getPendingActions()).then(function(res){
    var actions=(res&&res.actions)||[];
    if(!actions.length)return;
    var session=getOpenSessionAnywhere();
    var r=VShapeCore.reconcileActions(session,actions,Date.now());
    if(r.applied.length&&S.active){saveDay(S.active.date);render()}
    if(plugin.clearPendingActions)return Promise.resolve(plugin.clearPendingActions({upTo:session?session.lastAppliedSeq:0})).catch(function(){});
  }).catch(function(){});
}

/* ---------- render ---------- */
var TABS=[['today','Today','today'],['food','Food','food'],['train','Train','train'],['progress','Progress','prog']];
function render(){
  if(S.locked){
    var msg=S.lockReason==='newer-schema'?'Your saved data on this device is from a newer version of V-Shape ('+(S.lockedSchemaFound||'?')+') than this one. Nothing has been changed.'
      :S.lockReason==='corrupt'?'Your saved data could not be read. Nothing has been changed. If you have a backup file, restore it after a fresh install.'
      :'We could not safely keep a copy of your data before upgrading it, so nothing was changed. Free up storage space, or export a backup from your previous app version, then reopen V-Shape.';
    $('#app').innerHTML='<header class="top"><div class="bar"><div class="brand"><span class="mark"></span>V-SHAPE</div></div></header><div class="card"><h3>Your data is safe but locked</h3><p class="muted small">'+esc(msg)+'</p></div>';
    $('#nav').innerHTML='';
    return;
  }
  var v=ui.tab==='today'?viewToday():ui.tab==='food'?viewFood():ui.tab==='train'?viewTrain():viewProgress();
  var banner=ui.storageOk===false?'<div class="card banner warn"><b>Could not save your last change.</b><div class="muted small">'+esc(ui.storageMsg||'Your device storage may be full.')+'</div></div>':'';
  $('#app').innerHTML=header()+banner+v;
  $('#nav').innerHTML=TABS.map(function(t){return '<button data-act="tab" data-tab="'+t[0]+'"'+(ui.tab===t[0]?' aria-current="page"':'')+'>'+IC[t[2]]+t[1]+'</button>'}).join('');
  ui.dirty=false;
  pushNotificationState();
}
function softRender(){
  var a=document.activeElement;
  if(a&&(a.tagName==='INPUT'||a.tagName==='SELECT'||a.tagName==='TEXTAREA')){ui.dirty=true;return}
  render();
}
document.addEventListener('focusout',function(){setTimeout(function(){var a=document.activeElement;if(ui.dirty&&!(a&&(a.tagName==='INPUT'||a.tagName==='SELECT')))render()},50)});

/* ---------- sheets ---------- */
function openSheet(s){ui.sheet=s;drawSheet()}
function closeSheet(){ui.sheet=null;$('#sheet-root').innerHTML=''}
function drawSheet(){
  var s=ui.sheet;if(!s){closeSheet();return}
  var body='';
  if(s.type==='add')body=addHTML();
  else if(s.type==='custom')body=customHTML();
  else if(s.type==='settings')body=settingsHTML();
  else if(s.type==='photo')body=photoHTML();
  else if(s.type==='import')body=importHTML();
  else if(s.type==='finish')body=finishHTML();
  $('#sheet-root').innerHTML='<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true">'+body+'</div></div>';
  if(s.type==='add'&&s.sel)updatePreview();
}
function foodList(){
  var q=(ui.sheet.q||'').toLowerCase().trim();
  var list=allFoods().filter(function(f){return !q||f.name.toLowerCase().indexOf(q)>=0});
  return list.map(function(f){return '<button class="frow" data-act="pickfood" data-id="'+f.id+'"><span>'+esc(f.name)+'</span><span class="m">per '+f.per+' '+esc(f.unit)+' &middot; '+num(f.k)+' kcal &middot; '+r1(f.p)+' g protein</span></button>'}).join('')+'<button class="frow" data-act="newfood"><span><b>Create a custom food</b></span><span class="m">Use it for your own yogurt tub or a restaurant meal</span></button>';
}
function addHTML(){
  var s=ui.sheet;
  if(s.sel){var f=findFood(s.sel);
    return '<div class="sh-h"><button class="icon" data-act="addback" aria-label="Back">&#8249;</button><h3>'+esc(f.name)+'</h3></div><label class="fld" for="fqty">Amount ('+esc(f.unit)+')<input id="fqty" inputmode="decimal" value="'+f.def+'"></label><div class="prev" id="fprev"></div><button class="btn full" data-act="addfood">Add to '+esc(s.meal)+'</button>';}
  return '<div class="sh-h"><h3>Add to '+esc(s.meal)+'</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div><input id="fq" type="search" placeholder="Search foods" aria-label="Search foods" value="'+esc(s.q||'')+'"><div id="flist" style="margin-top:8px">'+foodList()+'</div>';
}
function updatePreview(){
  var s=ui.sheet,f=findFood(s.sel),q=parseFloat(($('#fqty')||{}).value)||0,m=scale(f,q);
  var el=$('#fprev');if(el)el.textContent=num(m.k)+' kcal, '+r1(m.p)+' g protein, '+r1(m.c)+' g carbs, '+r1(m.f)+' g fat';
}
function customHTML(){
  return '<div class="sh-h"><button class="icon" data-act="addback" aria-label="Back">&#8249;</button><h3>Custom food</h3></div><label class="fld" for="cf-name">Name<input id="cf-name" placeholder="e.g. Chobani Greek yogurt"></label><div class="two"><label class="fld" for="cf-unit">Unit<select id="cf-unit"><option>g</option><option>ml</option><option>each</option><option>serve</option><option>slice</option></select></label><label class="fld" for="cf-per">Nutrition is per<input id="cf-per" inputmode="decimal" value="100"></label></div><div class="two"><label class="fld" for="cf-k">Calories<input id="cf-k" inputmode="decimal"></label><label class="fld" for="cf-p">Protein (g)<input id="cf-p" inputmode="decimal"></label><label class="fld" for="cf-c">Carbs (g)<input id="cf-c" inputmode="decimal"></label><label class="fld" for="cf-f">Fat (g)<input id="cf-f" inputmode="decimal"></label></div><button class="btn full" style="margin-top:14px" data-act="savefood">Save food</button>';
}
function installBanner(){
  if(!installEvt||isStandalone())return '';
  return '<div class="card banner"><div class="grow"><b>Install V-Shape</b><div class="muted small">Opens full screen from your home screen and works offline.</div></div><button class="btn sm" data-act="installapp">Install</button></div>';
}
function settingsHTML(){
  var T=S.profile.targets,bl=S.profile.baseline||{};
  return '<div class="sh-h"><h3>Settings</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>'+
  '<div class="two"><label class="fld" for="t-k">Calories<input id="t-k" inputmode="numeric" value="'+T.kcal+'"></label><label class="fld" for="t-p">Protein (g)<input id="t-p" inputmode="numeric" value="'+T.protein+'"></label></div>'+
  '<div class="two"><label class="fld" for="t-s">Steps<input id="t-s" inputmode="numeric" value="'+T.steps+'"></label><label class="fld" for="t-w">Water (ml)<input id="t-w" inputmode="numeric" value="'+(T.water||3000)+'"></label></div><button class="btn full" style="margin-top:14px" data-act="savesettings">Save targets</button>'+
  '<h4 class="sh4">Baseline measurements (optional)</h4><p class="muted small" style="margin:0 0 10px">Used only for the "where you started" card on Progress. Leave blank if you have not had a scan.</p>'+
  '<div class="two"><label class="fld" for="b-w">Weight (kg)<input id="b-w" inputmode="decimal" value="'+(bl.weight!=null?bl.weight:'')+'"></label><label class="fld" for="b-bf">Body fat %<input id="b-bf" inputmode="decimal" value="'+(bl.bodyFatPct!=null?bl.bodyFatPct:'')+'"></label></div>'+
  '<label class="fld" for="b-date">Scan date or label<input id="b-date" placeholder="e.g. 17 Sep scan" value="'+esc(bl.label||'')+'"></label>'+
  '<button class="btn ghost full" style="margin-top:8px" data-act="savebaseline">Save baseline</button>'+
  (isNative()?'<h4 class="sh4">Workout notifications</h4><p class="muted small" style="margin:0 0 10px">'+(S.profile.notifPermission==='granted'?'On. You will see your active workout in the notification shade.':S.profile.notifPermission==='denied'?'Off. The workout still tracks fine inside the app.':'Not set up yet.')+'</p><button class="btn ghost full" data-act="requestworkoutnotif">'+(S.profile.notifPermission==='granted'?'Check permission again':'Enable workout notifications')+'</button>':'')+
  '<h4 class="sh4">Your data</h4><p class="muted small" style="margin:0 0 10px">Everything is stored on this phone only. Export a backup now and then, and always before you clear browser data or change phones.</p>'+
  '<div class="two"><button class="btn ghost" data-act="exportdata">Export backup</button><button class="btn ghost" data-act="importdata">Restore backup</button></div>'+
  '<button class="btn ghost full" style="margin-top:8px" data-act="recoversafety">Recover saved copies</button>'+
  (isStandalone()?'':'<h4 class="sh4">Install</h4><p class="muted small" style="margin:0">'+(installEvt?'<button class="btn full" data-act="installapp">Install app</button>':'In Chrome or Samsung Internet, open the menu and choose Add to Home screen or Install app.')+'</p>');
}
function importHTML(){
  var s=ui.sheet;
  return '<div class="sh-h"><h3>Restore backup</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div><div class="prev">This file has '+s.nd+' logged days and '+s.np+' photos.'+(s.dropped?' '+s.dropped+' photo(s) could not be verified and will be skipped.':'')+' Restoring replaces everything currently on this device.</div><div class="two"><button class="btn ghost" data-act="closesheet">Cancel</button><button class="btn" data-act="doimport">Replace my data</button></div>';
}
function finishHTML(){
  return '<div class="sh-h"><h3>Finish workout?</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div><div class="prev">Your logged sets are kept either way, and you can still add more afterwards.</div><div class="two"><button class="btn ghost" data-act="closesheet">Keep going</button><button class="btn" data-act="finishworkout2">Finish workout</button></div>';
}
/* ---------- rest timer (durable deadline, stored on the active session) ---------- */
var tick=null,toastT=null;
function toast(m){var el=$('#toast');el.textContent=m;el.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){el.hidden=true},2400)}
function drawTimer(){
  var el=$('#timer'),s=getOpenSessionAnywhere(),rest=s&&s.rest;
  if(!rest){el.hidden=true;el.className='';return}
  el.hidden=false;el.className=rest.paused?'paused':'';
  el.innerHTML='<span class="tlab">Rest</span><span class="tval" id="tval"></span><span class="tsub">'+esc(rest.label)+'</span>'+
    '<button class="icon" data-act="pauserest" aria-label="'+(rest.paused?'Resume rest':'Pause rest')+'">'+(rest.paused?'&#9654;':'&#10073;&#10073;')+'</button>'+
    '<button class="icon" data-act="tstop" aria-label="Skip rest">&times;</button>';
  tickFn();
}
function kickTimer(){drawTimer();if(!tick)tick=setInterval(tickFn,500)}
function resumeTickIfNeeded(){var s=getOpenSessionAnywhere();if(s&&s.rest){drawTimer();if(!tick)tick=setInterval(tickFn,500)}}
function tickFn(){
  var s=getOpenSessionAnywhere(),rest=s&&s.rest;
  if(!rest){clearInterval(tick);tick=null;return}
  var left=VShapeCore.restRemainingMs(s,Date.now()),v=$('#tval');
  if(left<=0&&!rest.done){
    rest.done=true;$('#timer').className='go';
    try{navigator.vibrate&&navigator.vibrate(200)}catch(e){}
    setTimeout(function(){var s2=getOpenSessionAnywhere();if(s2&&s2.rest&&s2.rest.done){VShapeCore.skipRest(s2);if(S.active)saveDay(S.active.date);drawTimer()}},7000);
  }
  if(v)v.textContent=rest.done?'Go':fmtClock(left);
}

/* ---------- actions ---------- */
function addEntry(day,meal,f,qty){
  var m=scale(f,qty);
  ensureDay(day).food.push({id:uid(),meal:meal,name:f.name,qty:qty,unit:f.unit,k:r1(m.k),p:r1(m.p),c:r1(m.c),f:r1(m.f)});
}
var A={
  tab:function(t){ui.tab=t.dataset.tab;render();window.scrollTo(0,0)},
  dprev:function(){ui.date=addDays(ui.date,-1);ui.wd=null;render()},
  dnext:function(){if(ui.date<todayISO()){ui.date=addDays(ui.date,1);ui.wd=null;render()}},
  dtoday:function(){ui.date=todayISO();ui.wd=null;render()},
  stepadd:function(t){var d=ensureDay(ui.date);d.steps=Math.max(0,(d.steps||0)+Number(t.dataset.n));d.stepsSource='manual';saveDay(ui.date);render()},
  stepset:function(){
    var v=VShapeCore.sanitizeStepCount(($('#stepsIn')||{}).value);
    if(v==null){toast('Enter a step count from 0 to 100,000');return}
    var d=ensureDay(ui.date);d.steps=v;d.stepsSource='manual';delete d.phoneSteps;saveDay(ui.date);render();
  },
  usephonestep:function(t){var d=ensureDay(ui.date);d.steps=Number(t.dataset.n);d.stepsSource='phone';delete d.phoneSteps;saveDay(ui.date);render()},
  importsteps:function(){$('#csvIn').click()},
  hcsync:function(){ui.hcBusy||hcSync(30,false)},
  wateradd:function(t){var d=ensureDay(ui.date);d.water=Math.max(0,(d.water||0)+Number(t.dataset.n));saveDay(ui.date);try{navigator.vibrate&&navigator.vibrate(10)}catch(e){}render()},
  gotod:function(t){ui.date=t.dataset.d;ui.wd=null;render()},
  wlog:function(){
    var v=VShapeCore.sanitizeBodyWeightKg(String(($('#wIn')||{}).value).replace(',','.'));
    if(v==null){toast('Enter your weight in kg');return}
    S.profile.weights[ui.date]=v;saveProfile();render();toast('Weight logged');
  },
  settings:function(){openSheet({type:'settings'})},
  savesettings:function(){
    var k=parseInt($('#t-k').value,10),p=parseInt($('#t-p').value,10),s=parseInt($('#t-s').value,10),w=parseInt($('#t-w').value,10);
    if(!(k>800&&k<6000&&p>20&&p<400&&s>0&&s<60000&&w>=500&&w<=10000)){toast('Check the numbers');return}
    S.profile.targets={kcal:k,protein:p,steps:s,water:w};saveProfile();closeSheet();render();toast('Targets saved');
  },
  savebaseline:function(){
    var w=parseFloat($('#b-w').value),bf=parseFloat($('#b-bf').value),lbl=$('#b-date').value.trim();
    var hasAny=!isNaN(w)||!isNaN(bf)||lbl;
    S.profile.baseline=hasAny?{weight:isNaN(w)?null:w,bodyFatPct:isNaN(bf)?null:bf,label:lbl||null}:null;
    saveProfile();render();toast('Baseline saved');
  },
  requestworkoutnotif:function(){
    var plugin=wnPlugin();
    if(!plugin){toast('Workout notifications need the Android app');return}
    Promise.resolve(plugin.requestPermission?plugin.requestPermission():{status:'unknown'}).then(function(res){
      S.profile.notifPermission=(res&&res.status)||'unknown';saveProfile();render();
      toast(S.profile.notifPermission==='granted'?'Workout notifications are on':'Notifications are off. The workout still tracks fine in the app.');
    }).catch(function(){toast('Could not reach the notification permission')});
  },
  closesheet:function(){closeSheet()},
  scrim:function(t,e){if(e.target===t)closeSheet()},
  addopen:function(t){openSheet({type:'add',meal:t.dataset.meal,q:'',sel:null})},
  pickfood:function(t){ui.sheet.sel=t.dataset.id;drawSheet();var q=$('#fqty');if(q){q.focus();q.select()}},
  addback:function(){ui.sheet=Object.assign(ui.sheet,{type:'add',sel:null});drawSheet()},
  addfood:function(){
    var s=ui.sheet,f=findFood(s.sel),q=parseFloat($('#fqty').value);
    if(!(q>0)){toast('Enter an amount');return}
    addEntry(ui.date,s.meal,f,q);saveDay(ui.date);closeSheet();render();toast('Added '+f.name);
  },
  newfood:function(){ui.sheet.type='custom';drawSheet()},
  savefood:function(){
    var n=$('#cf-name').value.trim(),per=parseFloat($('#cf-per').value),k=parseFloat($('#cf-k').value),p=parseFloat($('#cf-p').value)||0,c=parseFloat($('#cf-c').value)||0,f=parseFloat($('#cf-f').value)||0;
    if(!n||!(per>0)||!(k>=0)||isNaN(k)){toast('Add a name, amount and calories');return}
    var food=F('c-'+uid(),n,$('#cf-unit').value,per,per,k,p,c,f);
    S.profile.customFoods.push(food);saveProfile();
    ui.sheet.type='add';ui.sheet.sel=food.id;drawSheet();
  },
  delfood:function(t){var d=ensureDay(ui.date);d.food=d.food.filter(function(e){return e.id!==t.dataset.id});saveDay(ui.date);render()},
  tpl:function(t){
    var tp=TPL.filter(function(x){return x.id===t.dataset.id})[0];
    tp.items.forEach(function(it){addEntry(ui.date,tp.meal,findFood(it[0]),it[1])});
    saveDay(ui.date);render();toast('Added '+tp.name);
  },
  copyy:function(){
    var y=S.days[addDays(ui.date,-1)];if(!y)return;
    var d=ensureDay(ui.date);
    y.food.forEach(function(e){var c=clone(e);c.id=uid();d.food.push(c)});
    saveDay(ui.date);render();toast('Copied yesterday');
  },
  wd:function(t){ui.wd=t.dataset.k;render()},
  startworkout:function(){
    var r=startOrGetSession(ui.date,curWd());
    if(r.blocked){toast('Finish or pause your current workout first');return}
    saveDay(ui.date);render();
  },
  pauseworkout:function(){
    var s=getOpenSessionAnywhere();if(!s)return;
    VShapeCore.pauseSession(s,Date.now());saveDay(S.active.date);render();
  },
  resumeworkout:function(){
    var s=getOpenSessionAnywhere();if(!s)return;
    VShapeCore.resumeSession(s,Date.now());saveDay(S.active.date);render();
  },
  finishworkout:function(){openSheet({type:'finish'})},
  finishworkout2:function(){
    var s=getOpenSessionAnywhere();if(!s){closeSheet();return}
    VShapeCore.finishSession(s,Date.now());
    var d=S.active.date;S.active=null;
    saveDay(d);closeSheet();render();toast('Workout finished');drawTimer();
  },
  pauserest:function(){
    var s=getOpenSessionAnywhere();if(!s||!s.rest)return;
    if(s.rest.paused)VShapeCore.resumeRest(s,Date.now());else VShapeCore.pauseRest(s,Date.now());
    if(S.active)saveDay(S.active.date);drawTimer();
  },
  logset:function(t){
    var row=t.closest('.set'),exId=row.dataset.ex,i=Number(row.dataset.i),ex=EXLIST[exId];
    var r=startOrGetSession(ui.date,curWd());
    if(r.blocked){toast('Finish or pause your current workout first');return}
    var session=r.session,arr=session.log[exId]||[];
    if(arr[i]){
      VShapeCore.undoSetInSession(session,exId,i);
    }else{
      var wv=parseFloat(String(row.querySelector('[data-f=w]').value).replace(',','.')),rv=parseFloat(row.querySelector('[data-f=r]').value);
      if(isNaN(wv))wv=0;
      if(!(rv>0)){toast('Enter the reps you did');return}
      var res=VShapeCore.logSetIntoSession(session,ex,i,{w:wv,r:Math.round(rv)});
      if(!res.ok){toast('Enter a valid weight and whole number of reps');return}
      delete ui.drafts[ui.date+'|'+exId+'|'+i];
      VShapeCore.startRest(session,ex,Date.now());
      kickTimer();
      try{navigator.vibrate&&navigator.vibrate(15)}catch(e){}
    }
    saveDay(ui.date);render();
  },
  tstop:function(){
    var s=getOpenSessionAnywhere();if(s)VShapeCore.skipRest(s);
    if(S.active)saveDay(S.active.date);
    drawTimer();
  },
  exportdata:function(){
    var out={app:'vshape-tracker',v:2,schema:VShapeCore.SCHEMA_VERSION,exportedAt:new Date().toISOString(),profile:S.profile,days:S.days,photos:S.photos};
    var blob=new Blob([JSON.stringify(out)],{type:'application/json'}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download='vshape-backup-'+todayISO()+'.json';
    document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
    toast('Backup saved to your downloads');
  },
  importdata:function(){$('#backupIn').click()},
  doimport:function(){
    var p=ui.sheet&&ui.sheet.pending;if(!p)return;
    var newPhotos=p.photos||{};
    Promise.all(Object.keys(newPhotos).map(function(k){return idbPutP(newPhotos[k])})).then(function(results){
      if(results.some(function(r){return !r.ok})){toast('Could not restore all photos; nothing was changed.');return}
      var oldKeys=Object.keys(S.photos),newKeys=Object.keys(newPhotos);
      var toDelete=oldKeys.filter(function(k){return newKeys.indexOf(k)<0});
      return Promise.all(toDelete.map(idbDelP)).then(function(){
        var out=VShapeCore.migrateBlob({schema:p.schema,profile:p.profile,days:p.days});
        if(out.locked){toast('That backup is from a newer app version and cannot be restored here.');return}
        S.profile=Object.assign(defProfile(),out.profile||{});
        S.profile.targets=Object.assign(defProfile().targets,S.profile.targets||{});
        if(!S.profile.weights)S.profile.weights={};
        if(!S.profile.customFoods)S.profile.customFoods=[];
        S.days=out.days||{};
        Object.keys(S.days).forEach(function(d){VShapeCore.quarantineInvalidSets(S.days[d],EXLIST)});
        S.photos=newPhotos;S.active=null;
        saveLocal();closeSheet();render();toast('Backup restored');
      });
    }).catch(function(){toast('Restore failed; your existing data was kept.')});
  },
  recoversafety:function(){
    var found=[];
    try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(LS+'-pre-migration-backup-')===0)found.push(k)}}catch(e){}
    if(!found.length){toast('No saved copies were found on this device');return}
    found.sort();
    var combined={app:'vshape-tracker-safety-export',copies:found.map(function(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}})};
    var blob=new Blob([JSON.stringify(combined)],{type:'application/json'}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download='vshape-safety-copies-'+todayISO()+'.json';
    document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
    toast('Downloaded '+found.length+' saved copy(ies)');
  },
  installapp:function(){
    if(!installEvt)return;
    var e=installEvt;installEvt=null;e.prompt();closeSheet();render();
  },
  applyadj:function(){
    var wc=weeklyCheck();if(!wc||!wc.adj)return;
    S.profile.targets.kcal=Math.max(1900,S.profile.targets.kcal+wc.adj);S.profile.adjOn=todayISO();
    saveProfile();render();toast('Calorie target is now '+num(S.profile.targets.kcal));
  },
  addphoto:function(){$('#photoIn').click()},
  openphoto:function(t){openSheet({type:'photo',d:t.dataset.d})},
  delphoto:function(){ui.sheet.confirm=true;drawSheet()},
  delphoto2:function(){
    var d=ui.sheet.d;delete S.photos[d];deletePhotoRemote(d);closeSheet();render();toast('Photo deleted');
  }
};
document.addEventListener('click',function(e){
  var t=e.target.closest('[data-act]');if(!t)return;
  var f=A[t.dataset.act];if(f)f(t,e);
});
document.addEventListener('input',function(e){
  var t=e.target;
  if(t.dataset&&t.dataset.f){var row=t.closest('.set');if(row){var k=ui.date+'|'+row.dataset.ex+'|'+row.dataset.i,dr=ui.drafts[k]||(ui.drafts[k]={});dr[t.dataset.f]=t.value}}
  if(t.id==='fq'&&ui.sheet){ui.sheet.q=t.value;$('#flist').innerHTML=foodList()}
  if(t.id==='fqty')updatePreview();
});
document.addEventListener('change',function(e){
  if(e.target.id==='exsel'){ui.exSel=e.target.value;render()}
});

/* ---------- Samsung Health import ---------- */
function parseCSVLine(line){
  var out=[],cur='',q=false;
  for(var i=0;i<line.length;i++){var c=line[i];
    if(q){if(c==='"'){if(line[i+1]==='"'){cur+='"';i++}else q=false}else cur+=c}
    else if(c==='"')q=true;else if(c===','){out.push(cur);cur=''}else cur+=c}
  out.push(cur);return out;
}
function dateFromCell(v){
  v=String(v).trim().replace(/^"|"$/g,'');
  if(/^\d{10,13}$/.test(v)){var ms=v.length===10?Number(v)*1000:Number(v),d=new Date(ms);return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate())}
  var m=v.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return m[1]+'-'+m[2]+'-'+m[3];
  m=v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);if(m)return m[3]+'-'+pad(+m[2])+'-'+pad(+m[1]);
  return null;
}
function importSteps(text){
  var lines=text.replace(/\r/g,'').split('\n').filter(function(l){return l.trim()});
  var hi=-1,cols;
  for(var i=0;i<Math.min(lines.length,6);i++){
    var c=parseCSVLine(lines[i]).map(function(x){return x.trim().toLowerCase().split('.').pop()});
    if((c.indexOf('day_time')>=0||c.indexOf('date')>=0||c.indexOf('day')>=0)&&(c.indexOf('step_count')>=0||c.indexOf('count')>=0||c.indexOf('steps')>=0||c.indexOf('step')>=0)){hi=i;cols=c;break}
  }
  if(hi<0)return {error:'Could not find day and step columns in that file.'};
  var di=['day_time','date','day'].map(function(n){return cols.indexOf(n)}).filter(function(n){return n>=0})[0];
  var si=['step_count','count','steps','step'].map(function(n){return cols.indexOf(n)}).filter(function(n){return n>=0})[0];
  var best={};
  for(var j=hi+1;j<lines.length;j++){
    var r=parseCSVLine(lines[j]),d=dateFromCell(r[di]),n=parseFloat(r[si]);
    if(!d||isNaN(n)||n<0||n>100000)continue;
    if(best[d]===undefined||n>best[d])best[d]=Math.round(n);
  }
  var keys=Object.keys(best);
  if(!keys.length)return {error:'No step rows were found in that file.'};
  keys.forEach(function(d){var day=ensureDay(d);day.steps=best[d];day.stepsSource='import';saveDay(d)});
  keys.sort();
  return {count:keys.length,from:keys[0],to:keys[keys.length-1]};
}
$('#csvIn').addEventListener('change',function(e){
  var f=e.target.files&&e.target.files[0];if(!f)return;
  var rd=new FileReader();
  rd.onload=function(){
    var r=importSteps(String(rd.result));
    if(r.error)toast(r.error);
    else{render();toast('Imported '+r.count+' days of steps')}
    e.target.value='';
  };
  rd.onerror=function(){toast('Could not read that file')};
  rd.readAsText(f);
});

$('#photoIn').addEventListener('change',function(e){
  var f=e.target.files&&e.target.files[0];if(!f)return;
  var d=ui.date;
  shrink(f,function(img){
    e.target.value='';
    if(!img||!VShapeCore.isValidPhotoDataUri(img)){toast('Could not use that photo. Try another one.');return}
    S.photos[d]={date:d,img:img,w:S.profile.weights[d]||null,t:Date.now()};
    savePhoto(d);render();
    toast('Photo saved for '+fmtDate(d,{day:'numeric',month:'short'}));
  });
});

$('#backupIn').addEventListener('change',function(e){
  var f=e.target.files&&e.target.files[0];if(!f)return;
  var rd=new FileReader();
  rd.onload=function(){
    e.target.value='';
    var pr=VShapeCore.parseBackupJSON(String(rd.result));
    if(!pr.ok){toast('That is not a valid V-Shape backup file');return}
    var o=pr.data,cleanPhotos={},dropped=0;
    Object.keys(o.photos||{}).forEach(function(k){
      var p=o.photos[k];
      if(p&&VShapeCore.isValidPhotoDataUri(p.img))cleanPhotos[k]=p;else dropped++;
    });
    openSheet({type:'import',pending:{profile:o.profile,days:o.days,photos:cleanPhotos,schema:o.schema},nd:Object.keys(o.days).length,np:Object.keys(cleanPhotos).length,dropped:dropped});
  };
  rd.onerror=function(){toast('Could not read that file')};
  rd.readAsText(f);
});

/* ---------- start ---------- */
loadLocal();
render();
loadPhotos();
initPwa();
resumeTickIfNeeded();
if(isNative()&&!S.locked)setTimeout(function(){hcSync(7,true);reconcileNativeActions()},800);
document.addEventListener('visibilitychange',function(){
  if(document.hidden||S.locked)return;
  if(isNative()){
    reconcileNativeActions();
    if(!ui.hcAt||Date.now()-ui.hcAt>10*60000)hcSync(3,true);
  }
  var t=todayISO();
  if(t!==ui.today){if(ui.date===ui.today)ui.date=t;ui.today=t;ui.wd=null;softRender()}
});
})();
