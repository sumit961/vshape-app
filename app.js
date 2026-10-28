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
var toggleInArray=function(arr,id){var i=arr.indexOf(id);if(i>=0)arr.splice(i,1);else arr.push(id);return arr};
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

/* ---------- default plan (from the printed 5-day plan) ---------- */
/* start = rough first-session load in kg for a 70 kg lifter; per-hand for dumbbells, per-side for cables. inc = smallest sensible jump.
   This is only the SEED data for the default plan created on first install (or on migration from a
   version of the app that had no plans at all). Once seeded, S.plans is the live source of truth and
   this object is never read again - the plan builder edits S.plans, not this. */
function X(id,name,sets,lo,hi,rest,inc,start,muscle,cue,o){return Object.assign({id:id,name:name,sets:sets,lo:lo,hi:hi,rest:rest,inc:inc,start:start,muscle:muscle,cue:cue},o||{})}
var DEFAULT_PROGRAM={
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
var DEFAULT_DAY_ORDER=['push','pull','legsA','upper','lower'];
var DEFAULT_WEEKDAY={1:'push',2:'pull',3:'legsA',5:'upper',6:'lower'}; // Mon push, Tue pull, Wed legs, Thu rest, Fri upper, Sat lower, Sun rest
function buildDefaultPlan(){
  var plan=VShapeCore.newPlan('Default 5-Day Split',0);
  DEFAULT_DAY_ORDER.forEach(function(k){
    var src=DEFAULT_PROGRAM[k];
    var t=VShapeCore.newTemplate(src.name,0);
    // The seeded default plan's template ids MUST stay equal to the old
    // literal program keys ('push'/'pull'/...), not a freshly generated id:
    // every session created before plans (or before the weekday-schedule
    // rework) existed has session.day set to one of these literal keys, and
    // openSessionFor/lastSessionFor match sessions by exact id equality. A
    // random id here would silently orphan every pre-existing finished
    // session from the Train tab's per-day lookup (it would still exist in
    // storage and still count in history/PR/volume, which don't filter by
    // this id - but it would wrongly look "not logged" the moment you
    // revisited that date in Train).
    t.id=k;
    t.tag=src.tag;t.cue=src.cue;
    t.ex=src.ex.map(function(e){return Object.assign({},e)});
    VShapeCore.addTemplateToPlan(plan,t);
  });
  Object.keys(DEFAULT_WEEKDAY).forEach(function(wd){
    VShapeCore.setWeekdayTemplates(plan,Number(wd),[DEFAULT_WEEKDAY[wd]]);
  });
  return plan;
}

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

/* ---------- fitness profile & onboarding reference lists (Phase 3A) ---------- */
function L(id,label,desc){return {id:id,label:label,desc:desc||''}}
var GOALS=[L('fat_loss','Fat loss'),L('muscle_gain','Muscle gain'),L('body_recomp','Body recomposition'),
  L('strength','Strength'),L('endurance','Endurance'),L('athletic_performance','Athletic performance'),
  L('general_fitness','General fitness'),L('mobility','Mobility'),L('weight_maintenance','Weight maintenance'),
  L('conditioning','Improved conditioning')];
var EQUIPMENT=['Barbell','Dumbbells','Kettlebells','Cable machine','Resistance bands','Pull-up bar','Bench',
  'Squat rack','Smith machine','Leg press machine','Lat pulldown machine','Rowing machine','Treadmill',
  'Stationary bike','Suspension trainer (TRX)','Medicine ball','Bodyweight only'].map(function(n){return L(slug(n),n)});
var MUSCLE_GROUPS=['Chest','Back','Shoulders','Biceps','Triceps','Forearms','Quads','Hamstrings','Glutes',
  'Calves','Abs / core','Full body'].map(function(n){return L(slug(n),n)});
var SPLITS=[L('ppl','Push / Pull / Legs'),L('upper_lower','Upper / Lower'),L('full_body','Full body'),
  L('body_part','Body-part split'),L('auto','Recommend one for me'),L('custom',"Fully custom (I'll build it myself)")];
var ACTIVITY_LEVELS=[L('sedentary','Sedentary','Little to no exercise, desk job'),
  L('light','Lightly active','Light exercise 1-3 days a week'),
  L('moderate','Moderately active','Moderate exercise 3-5 days a week'),
  L('active','Active','Hard exercise 6-7 days a week'),
  L('very_active','Very active','Physical job or training twice a day')];
var EXPERIENCE_LEVELS=[L('beginner','Beginner','New to structured training, or under 6 months'),
  L('intermediate','Intermediate','6 months to 2 years of consistent training'),
  L('advanced','Advanced','2+ years of consistent, structured training')];
var GENDERS=[L('male','Male'),L('female','Female'),L('other','Other'),L('prefer_not_to_say','Prefer not to say')];
var DURATIONS=[15,30,45,60,75,90];
var FREQ_OPTIONS=[0,1,2,3,4,5,6,7];
var DAYS_PER_WEEK_OPTIONS=[2,3,4,5,6,7];
function slug(s){return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')}

/* ---------- state + storage ---------- */
var LS='vshape-tracker-v1';
function defProfile(){return {targets:{kcal:2350,protein:160,steps:20000,water:3000},weights:{},customFoods:[],baseline:null,notifPermission:null,fitness:VShapeCore.defaultFitnessProfile(),nutritionAdvanced:null,appearance:VShapeThemes.normalize(null),plateCalc:VShapeCore.defaultPlateCalc()}}
var S={profile:defProfile(),days:{},photos:{},plans:null,activePlanId:null,active:null,locked:false,lockReason:null,lockedSchemaFound:null,library:VShapeCore.defaultLibrary()};
var foodMount=null,themeWatcher=null,appearanceMount=null;
var ui={tab:'today',date:todayISO(),today:todayISO(),wd:null,sheet:null,drafts:{},timer:null,exSel:'incline-db',dirty:false,storageOk:true,storageMsg:null,hcDenied:false,lastNotifError:null,trainPicker:false};
var installEvt=null;

function saveLocal(){
  if(S.locked)return;
  try{
    localStorage.setItem(LS,JSON.stringify({schema:VShapeCore.SCHEMA_VERSION,profile:S.profile,days:S.days,active:S.active||null,plans:S.plans,activePlanId:S.activePlanId,library:S.library}));
    ui.storageOk=true;
  }catch(e){
    ui.storageOk=false;
    ui.storageMsg=(e&&e.name==='QuotaExceededError')?'Storage is full. Export a backup, then free up space on your device.':'Could not save your last change ('+(e&&e.message||'unknown error')+').';
  }
}
/* A fresh install, or data upgraded from a version with no plans concept yet,
   needs a starting plan: seed the built-in default so the Train tab always
   has something to show. Never runs once S.plans already has at least one
   plan - it only fills a genuine gap. */
function ensurePlans(plansIn,activeIn){
  var plans=(plansIn&&plansIn.length)?plansIn:null;
  var activePlanId=activeIn||null;
  var shapeMigrated=false;
  if(!plans){var p=buildDefaultPlan();plans=[p];activePlanId=p.id;}
  else{
    // Upgrade any plan still on the pre-weekday-schedule shape (days:[...],
    // no templates/schedule) in place; a plan already current is untouched.
    plans.forEach(function(pl){
      if(!pl.templates){VShapeCore.migratePlanShape(pl);shapeMigrated=true}
    });
  }
  if(!VShapeCore.findPlan(plans,activePlanId))activePlanId=plans[0].id;
  return {plans:plans,activePlanId:activePlanId,shapeMigrated:shapeMigrated};
}
/* Sessions created before plans existed have no exSnapshot; backfill one from
   whatever exercise ids they actually logged, using the plan we just seeded
   (which is built from the same program the app always used), so quarantine
   checks, the strength chart and volume analytics all have something to work
   with immediately instead of silently dropping old history. */
function backfillSessionSnapshots(){
  var flat=flatExerciseLookup();
  Object.keys(S.days).forEach(function(d){
    (S.days[d].sessions||[]).forEach(function(session){
      if(session.exSnapshot&&session.exSnapshot.length)return;
      var snap=[];
      Object.keys(session.log||{}).forEach(function(exId){var e=flat[exId];if(e)snap.push(Object.assign({},e))});
      session.exSnapshot=snap;
    });
  });
}
/* Migrates/validates S.profile.nutritionAdvanced and S.profile.appearance in place (additive,
   same convention as mergeFitnessProfile/mergeLibrary). `seedLegacy` is true only on the very
   first migration (no nutritionAdvanced existed yet); every later boot re-validates/clones the
   already-migrated state with no legacy import, since there is nothing left in `S.profile.
   customFoods`/the old food log that hasn't already been captured. On a thrown/corrupt state the
   raw value is left completely untouched (never discarded or replaced with fresh defaults) and
   ui.nutritionCorrupt flags the Food tab to show a recovery message instead of mounting. */
function migrateNutritionAndAppearance(seedLegacy){
  var legacy=seedLegacy?{foods:FOODS.concat((S.profile.customFoods||[]).map(function(f){return Object.assign({},f,{custom:true})})),days:S.days,targets:S.profile.targets}:undefined;
  try{
    S.profile.nutritionAdvanced=VShapeNutrition.migrate(S.profile.nutritionAdvanced,legacy);
    ui.nutritionCorrupt=false;
  }catch(e){
    ui.nutritionCorrupt=true;
  }
  S.profile.appearance=VShapeThemes.normalize(S.profile.appearance);
}
function loadLocal(){
  var raw;
  try{raw=localStorage.getItem(LS)}catch(e){raw=null}
  if(!raw){
    var pr0=ensurePlans(null,null);S.plans=pr0.plans;S.activePlanId=pr0.activePlanId;
    migrateNutritionAndAppearance(true);
    return;
  }
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
  S.profile.fitness=VShapeCore.mergeFitnessProfile(S.profile.fitness);
  S.profile.plateCalc=VShapeCore.mergePlateCalc(S.profile.plateCalc);
  S.library=VShapeCore.mergeLibrary(out.library);
  S.days=out.days||{};
  migrateNutritionAndAppearance(!out.profile||!out.profile.nutritionAdvanced);
  var plansHadNone=!(out.plans&&out.plans.length);
  var pr=ensurePlans(out.plans,out.activePlanId);
  S.plans=pr.plans;S.activePlanId=pr.activePlanId;
  var plansShapeMigrated=pr.shapeMigrated;
  backfillSessionSnapshots();
  var flat=flatExerciseLookup();
  Object.keys(S.days).forEach(function(d){VShapeCore.quarantineInvalidSets(S.days[d],flat)});
  S.active=parsed.active||null;
  if(S.active){
    var ad=S.days[S.active.date],asess=ad&&VShapeCore.findSessionById(ad,S.active.id);
    if(!asess||!(asess.status==='active'||asess.status==='paused')){S.active=null}
    else{ui.tab='train';ui.date=S.active.date;ui.wd=asess.day}
  }
  if(out.migrated||plansHadNone||plansShapeMigrated)saveLocal();
}
function ensureDay(d){
  if(!S.days[d])S.days[d]={date:d,food:[],steps:0,stepsSource:null,water:0,sessions:[],quarantine:{sets:[],food:[]},override:null};
  var x=S.days[d];
  if(!x.food)x.food=[];
  if(!x.sessions)x.sessions=[];
  if(!x.quarantine)x.quarantine={sets:[],food:[]};
  if(x.override===undefined)x.override=null;
  return x;
}
function queueSave(){saveLocal()}
function saveDay(d){queueSave('day-'+d)}
function saveProfile(){queueSave('profile')}

/* ---------- plans (bridges S.plans onto VShapeCore's pure plan model) ---------- */
// Vocabulary: a Plan has a fixed Mon..Sun `schedule` (weekday -> template
// id(s)) and a pool of reusable, named `templates` (e.g. "Push A",
// "Chest & Triceps"). Scheduling is a mapping, not a property of the
// template, so the same template can be assigned to several weekdays
// without duplicating its exercises.
function activePlan(){return VShapeCore.findPlan(S.plans,S.activePlanId)}
function templateById(templateId){var p=activePlan();return p?VShapeCore.findTemplate(p,templateId):null}
function planTemplates(){var p=activePlan();return p?p.templates:[]}
/* The active plan's weekly session target for the "x / n" gym counters (0 = no fixed target). */
function weeklyGymTarget(){return VShapeCore.scheduledTrainingDays(activePlan())}
function gymFrac(done,sep){var n=weeklyGymTarget();return done+(n?sep+n:'')}
/* Resolves what weekday `d` (an ISO date string) means for the active plan:
   'rest' (nothing scheduled), a template id (exactly one option), or
   'choose' (more than one template scheduled - the UI must ask, never
   silently pick the first). */
function autoDay(d){
  var wd=parseISO(d).getDay(),r=VShapeCore.resolveWeekday(activePlan(),wd);
  var day=S.days[d];
  r=VShapeCore.applyDayOverride(r,day&&day.override);
  return r.kind==='template'?r.templateId:r.kind;
}
function chooseOptionsFor(d){
  var wd=parseISO(d).getDay(),r=VShapeCore.resolveWeekday(activePlan(),wd);
  return r.kind==='choose'?r.options:[];
}
/* Flat id->exercise map across every current plan's every template. Used
   only as a fallback (quarantine validation on legacy data, the plan
   picker, the strength chart) - anything about an already-started or
   already-finished session always prefers that session's own frozen
   exSnapshot instead, so editing a plan later never rewrites history. */
function flatExerciseLookup(){
  var m={};
  (S.plans||[]).forEach(function(p){(p.templates||[]).forEach(function(t){(t.ex||[]).forEach(function(e){if(!m[e.id])m[e.id]=e})})});
  return m;
}
/* Every exercise id the user has ever trained, for the strength-chart picker
   and the plan-builder's "pick an existing exercise" list: live plans first,
   then anything only history remembers (e.g. an exercise since removed from
   every plan). */
function allKnownExercises(){
  var m=flatExerciseLookup();
  Object.keys(S.days).forEach(function(d){
    (S.days[d].sessions||[]).forEach(function(session){
      (session.exSnapshot||[]).forEach(function(e){if(!m[e.id])m[e.id]=e});
    });
  });
  return m;
}
function sessionDayView(session){
  return {id:session.dayId||null,name:session.dayName||'Workout',tag:session.dayTag||'',cue:session.dayCue||'',ex:session.exSnapshot||[]};
}

/* ---------- sessions (bridges S/ui onto VShapeCore's pure session model) ---------- */
/* openSessionFor/lastSessionFor never return the same thing once a session is
   finished: a finished session must not be silently reused or edited by a
   later workout of the same program day. */
function openSessionFor(date,dayKey){
  var day=S.days[date];
  return day?VShapeCore.findOpenSessionForDay(day,dayKey):null;
}
function lastSessionFor(date,dayKey){
  var day=S.days[date];
  return day?VShapeCore.findLastSessionForDay(day,dayKey):null;
}
function getOpenSessionAnywhere(){
  if(!S.active)return null;
  var day=S.days[S.active.date];if(!day)return null;
  var s=VShapeCore.findSessionById(day,S.active.id);
  return (s&&(s.status==='active'||s.status==='paused'))?s:null;
}
/* The day actually being trained right now: an open session pins to what it
   snapshotted at start, so a plan edit mid-workout can't shift sets/targets
   under the lifter's feet; otherwise it's whatever the active plan currently
   says this day looks like. */
function trainDayView(date,dayKey){
  if(dayKey==='rest'||dayKey==='choose')return null;
  // displaySessionFor (open, else last/finished) - not just openSessionFor - so re-viewing a
  // day right after finishing it still shows that session's own frozen exSnapshot, exactly
  // like history()/PR/volume already do, instead of silently switching to whatever the LIVE
  // plan template currently looks like (which could have since been edited).
  var session=displaySessionFor(date,dayKey);
  return session?sessionDayView(session):templateById(dayKey);
}
function startOrGetSession(date,dayKey){
  var day=ensureDay(date);
  var decision=VShapeCore.decideSessionStart(day,dayKey,getOpenSessionAnywhere());
  if(decision.action==='reuse')return {session:decision.session,created:false};
  if(decision.action==='blocked')return {blocked:true,blockingSession:decision.blockingSession};
  var liveDay=templateById(dayKey);
  var s=VShapeCore.newSession(dayKey,Date.now(),null,{
    planId:S.activePlanId,dayId:dayKey,
    dayName:liveDay?liveDay.name:null,dayTag:liveDay?liveDay.tag:null,dayCue:liveDay?liveDay.cue:null,
    exSnapshot:liveDay?clone(liveDay.ex):[]
  });
  day.sessions.push(s);
  S.active={date:date,id:s.id};
  return {session:s,created:true};
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
  /* Everything that touches the plugin runs inside the promise chain (not before it), so (a) a
     synchronous plugin error lands in the .catch below and clears hcBusy instead of leaving sync
     stuck "busy" for the rest of the session, and (b) the permission dialog is only requested once
     we know Health Connect is actually installed. */
  return Promise.resolve().then(function(){return hc.checkAvailability()}).then(function(a){
    var st=a&&(a.availability||a.status||a);
    if(st==='NotInstalled'||st==='NotSupported'){throw new Error('Install Health Connect from the Play Store first')}
    return quiet?checkFn.call(hc,perm):hc.requestHealthPermissions(perm);
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
    saveLocal(); /* one write: saveLocal serialises the whole state, so per-day saves were N full writes */
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
/* Non-destructive diagnostic snapshot for a data-loss/notification-sync report: structural
   counts and ids only, never the user's actual food/weight/photo content. Reads whatever
   local/native storage currently holds without touching any of it. */
/* Four distinct categories a data-loss/sync report needs to tell apart, so "it's gone" can be
   answered precisely instead of guessed at:
   - present: a logged, non-null entry at that exact set index - nothing wrong.
   - pending: an exercise's set index with nothing logged there yet. Normal/expected while the
     session is still active/paused; flagged separately (incompleteOnFinish) if the session is
     already finished, since that combination is the one worth a second look.
   - hidden/quarantined: moved OUT of session.log by quarantineInvalidSets because it failed
     validateSet (e.g. after a plan edit changed an exercise's rules) - never deleted, listed
     here with its original value and the exact reason it was pulled.
   - pending-native: committed on-device by the notification but not yet reconciled into this
     session.log/localStorage at all - see report.native.journal.queue/nativeCommits. */
function diagDay(d,day){
  return {
    date:d,
    override:day.override||null,
    sessionCount:(day.sessions||[]).length,
    sessions:(day.sessions||[]).map(function(s){
      var sets=[];
      Object.keys(s.log||{}).forEach(function(exId){
        (s.log[exId]||[]).forEach(function(entry,i){if(entry)sets.push({exId:exId,index:i,w:entry.w,r:entry.r})});
      });
      var exercises=(s.exSnapshot||[]).map(function(e){
        var logged=(s.log&&s.log[e.id])||[],loggedIndexes=[],pendingIndexes=[];
        for(var j=0;j<e.sets;j++){if(logged[j])loggedIndexes.push(j);else pendingIndexes.push(j)}
        return {exId:e.id,name:e.name,expectedSets:e.sets,loggedIndexes:loggedIndexes,pendingIndexes:pendingIndexes,
          incompleteOnFinish:s.status==='finished'&&pendingIndexes.length>0};
      });
      return {id:s.id,day:s.day,dayId:s.dayId,status:s.status,startedAt:s.startedAt,finishedAt:s.finishedAt,lastAppliedSeq:s.lastAppliedSeq||0,
        exSnapshotCount:(s.exSnapshot||[]).length,setCount:sets.length,sets:sets,exercises:exercises};
    }),
    quarantine:((day.quarantine&&day.quarantine.sets)||[]).map(function(q){return {sessionId:q.sessionId,exId:q.exId,index:q.index,value:q.value,reason:q.reason}})
  };
}
function buildDiagnosticReport(){
  var report={
    app:'vshape-tracker-diagnostics',exportedAt:new Date().toISOString(),
    currentSchemaVersion:VShapeCore.SCHEMA_VERSION,
    live:{locked:S.locked,lockReason:S.lockReason,lockedSchemaFound:S.lockedSchemaFound,
      dayCount:Object.keys(S.days).length,
      days:Object.keys(S.days).sort().map(function(d){return diagDay(d,S.days[d])}),
      planCount:(S.plans||[]).length,activePlanId:S.activePlanId,
      active:S.active||null,storageOk:ui.storageOk,storageMsg:ui.storageMsg},
    storageKeys:[],idbSafetyCopies:0,native:null
  };
  try{
    for(var i=0;i<localStorage.length;i++){
      var k=localStorage.key(i);if(!k)continue;
      var raw=null;try{raw=localStorage.getItem(k)}catch(e){}
      var parsed=null,readable=true;try{parsed=raw?JSON.parse(raw):null}catch(e){readable=false}
      report.storageKeys.push({key:k,bytes:raw?raw.length:0,readable:readable,schema:parsed&&parsed.schema!==undefined?parsed.schema:null});
    }
  }catch(e){}
  return idbRun('safety','readonly',function(s){return s.getAll()}).then(function(list){report.idbSafetyCopies=(list||[]).length}).catch(function(){}).then(function(){
    var plugin=wnPlugin();
    if(!plugin||!isNative()||!plugin.getDiagnostics)return report;
    return Promise.resolve(plugin.getDiagnostics()).then(function(res){
      report.native=res||null;
      var j=res&&res.journal;
      if(j){report.native.pendingNativeActionCount=(j.queue||[]).length;report.native.pendingNativeCommitCount=(j.nativeCommits||[]).length;}
      return report;
    }).catch(function(){return report});
  });
}
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
// Null-safe: a legacy-projected entry from the advanced nutrition engine can carry an explicit
// null for an unknown nutrient (never a guessed zero at the source). Treated as 0 here only for
// this rollup sum - never displayed as a confident number anywhere nutrition data is shown on
// its own (the mounted nutrition UI has its own completeness-aware totals for that).
function totals(d){
  var f=(S.days[d]&&S.days[d].food)||[];
  return f.reduce(function(a,e){return {k:a.k+(e.k||0),p:a.p+(e.p||0),c:a.c+(e.c||0),f:a.f+(e.f||0)}},{k:0,p:0,c:0,f:0});
}
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
/* Reads whatever session is relevant to show for this date/key: the open one if there is
   one, otherwise the last (typically just-finished) one - never silently falls back to "no
   session" just because the only session for today happens to already be finished. This is
   what keeps the sets-done count (and the exercise rows in viewTrain) showing the real
   logged data right after finishing a workout, instead of reading an empty {} log from a
   lookup that deliberately excludes finished sessions. */
function displaySessionFor(date,key){return openSessionFor(date,key)||lastSessionFor(date,key)}
function setsDone(key,date){
  var P=trainDayView(date,key);if(!P)return {done:0,total:0,vol:0};
  return VShapeCore.sessionSetsDone(displaySessionFor(date,key),P);
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
  var tiles=[['Distance',r1(km)+' km','estimated'],['Active',num(active)+' kcal',est?'estimated':'from phone'],['Resting HR',d&&d.rhr?d.rhr+' bpm':'&ndash;','from phone'],['Gym, 7 days',gymFrac(sess,' / '),'sessions']];
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
  var key=curWd(),P=trainDayView(ui.date,key),sd=P?setsDone(key,ui.date):null;
  var wc=weeklyCheck(),wToday=S.profile.weights[ui.date];
  var train=P?'<div class="row"><div class="grow"><div class="num" style="font-size:26px;font-weight:700">'+esc(P.name)+'</div><div class="muted small">'+esc(P.tag)+'</div></div><div class="num" style="font-size:22px;font-weight:600">'+sd.done+'/'+sd.total+'<span class="muted small"> sets</span></div></div><button class="btn full" style="margin-top:12px" data-act="tab" data-tab="train">'+(sd.done?'Continue workout':'Open workout')+'</button>':
    key==='choose'?'<div class="muted">More than one workout is scheduled today.</div><button class="btn full" style="margin-top:12px" data-act="tab" data-tab="train">Choose on the Train tab</button>':
    '<div class="muted">Rest day. Normal work and walking are enough. You can still open a session from the Train tab.</div>';
  return installBanner()+backupBanner()+heroHTML()+weekStrip()+'<div class="card"><div class="rings">'+ring(tot.k,T.kcal,'var(--accent)','Calories','kcal')+ring(tot.p,T.protein,'var(--protein)','Protein','g')+ring(steps,T.steps,'var(--steps)','Steps','steps')+'</div><div class="rem">'+rem+'</div><div class="muted small" style="margin-top:6px">Carbs '+num(tot.c)+' g &middot; Fat '+num(tot.f)+' g</div></div>'+
  '<div class="card"><h3>Steps</h3><div class="row"><div class="stepbig grow">'+num(steps)+'</div><button class="chip" data-act="stepadd" data-n="1000">+1,000</button><button class="chip" data-act="stepadd" data-n="-1000">-1,000</button></div>'+
  '<div class="inline" style="margin-top:10px"><input id="stepsIn" inputmode="numeric" placeholder="Type today\'s count from Samsung Health" aria-label="Steps"><button class="btn" data-act="stepset">Set</button></div>'+
  (d&&d.phoneSteps&&d.phoneSteps!==steps?'<button class="btn ghost sm" style="margin-top:8px" data-act="usephonestep" data-n="'+d.phoneSteps+'">Use phone value: '+num(d.phoneSteps)+'</button>':'')+
  syncRow()+'<button class="btn ghost full" style="margin-top:10px" data-act="importsteps">Import Samsung Health file</button>'+
  '<details><summary>How to get steps out of Samsung Health</summary><ol><li>Samsung Health, then Settings, then Download personal data.</li><li>Open the downloaded folder and find the file with step_daily_trend or pedometer_day_summary in its name (.csv).</li><li>Tap Import above and choose it. Every day in the file is filled in at once.</li></ol><p style="margin:8px 0 0">'+(isNative()?'Samsung Health writes to Health Connect, so the sync button above picks up steps from it.':'A web page cannot read Samsung Health live. Install the Android app build (see ANDROID.md) to sync steps automatically through Health Connect.')+'</p></details></div>'+
  healthCard(steps,d)+waterCard(d)+
  '<div class="card"><h3>Training</h3>'+train+'</div>'+
  '<div class="card"><h3>Weigh-in</h3><div class="inline"><input id="wIn" inputmode="decimal" placeholder="'+(wToday?esc(wToday)+' kg logged':'Morning weight in kg')+'" aria-label="Body weight in kg"><button class="btn" data-act="wlog">Log</button></div>'+
  (wc?'<div style="margin-top:10px"><span class="num" style="font-size:22px;font-weight:700">'+r1(wc.cur)+' kg</span> <span class="muted small">7-day average, '+(wc.d>0?'+':'')+r1(wc.d)+' kg vs the week before</span><div class="small" style="margin-top:4px">'+wc.txt+'</div>'+(wc.adj?'<button class="btn sm" style="margin-top:8px" data-act="applyadj">Set target to '+num(Math.max(1900,S.profile.targets.kcal+wc.adj))+' kcal</button>':'')+'</div>':'<div class="muted small" style="margin-top:10px">Weigh in 3 or more mornings a week, same conditions. After two weeks you get a calorie adjustment here.</div>')+'</div>';
}
// The Food tab is now entirely owned by VShapeNutritionUI, mounted against this placeholder by
// ensureFoodMount() (called from render(), right after this string replaces #app's innerHTML).
function viewFood(){
  return '<div id="food-root"></div>';
}
function e1rm(ex,s){return VShapeCore.e1rm(ex,s)}
function isPR(ex,date,logged){return VShapeCore.isPR(ex,history(ex.id,date),logged)}
function lifecycleBar(openSession,lastSession,P){
  if(!openSession){
    var day=S.days[ui.date],ov=day&&day.override;
    var ovNote=ov?'<div class="row" style="margin-top:8px"><div class="grow muted small">Training instead of your scheduled rest day.</div><button class="btn ghost sm" data-act="undooverride">Undo</button></div>':'';
    if(lastSession&&lastSession.status==='finished'){
      var doneTxt=fmtClock(VShapeCore.sessionElapsedMs(lastSession,Date.now()));
      return '<div class="card lc"><div class="row"><div class="grow muted small">Finished '+esc(lastSession.dayName||(P?P.name:'workout'))+' &middot; '+doneTxt+' elapsed.</div><button class="btn ghost sm" data-act="startworkout">Start another</button></div></div>';
    }
    return '<div class="card lc"><button class="btn full" data-act="startworkout">Start workout</button>'+
      '<div class="two" style="margin-top:8px"><button class="btn ghost sm" data-act="resttoday">Rest today</button><button class="btn ghost sm" data-act="skipworkout">Skip workout</button></div>'+ovNote+'</div>';
  }
  var session=openSession;
  var elapsed=VShapeCore.sessionElapsedMs(session,Date.now()),timeTxt=fmtClock(elapsed);
  var isPaused=session.status==='paused';
  return '<div class="card lc'+(isPaused?' paused':'')+'"><div class="row"><div class="grow"><b>'+(isPaused?'Workout paused':'Workout active')+'</b><div class="muted small">'+timeTxt+' elapsed</div></div>'+
    '<button class="btn sm" data-act="'+(isPaused?'resumeworkout':'pauseworkout')+'">'+(isPaused?'Resume':'Pause')+'</button>'+
    '<button class="btn ghost sm" style="margin-left:6px" data-act="finishworkout">Finish</button></div></div>';
}
function chooseCard(){
  var opts=chooseOptionsFor(ui.date).map(templateById).filter(Boolean);
  if(!opts.length)return '';
  return '<div class="card"><h3>More than one workout is scheduled today</h3><div class="pills" role="group" aria-label="Pick today\'s workout">'+
    opts.map(function(t){return '<button class="pill" data-act="wd" data-k="'+esc(t.id)+'">'+esc(t.name)+'</button>'}).join('')+'</div></div>';
}
/* "Skip Rest & Train" on a scheduled rest day: unlike chooseCard (which only ever offers the
   weekday's own ambiguous options), this offers every template in the active plan, since
   nothing at all is scheduled for this date to narrow it down. Picking one stores a
   date-specific override (never a session, never a weekday schedule change) and lands on
   that workout's normal Start-workout card. */
function trainPickerHTML(){
  var opts=planTemplates();
  if(!opts.length)return '';
  return '<div class="card"><h3>Train anyway: pick a workout</h3><div class="pills" role="group" aria-label="Pick a workout">'+
    opts.map(function(t){return '<button class="pill" data-act="traininstead" data-k="'+esc(t.id)+'">'+esc(t.name)+'</button>'}).join('')+
    '</div><button class="btn ghost sm" style="margin-top:10px" data-act="skiprestclose">Cancel</button></div>';
}
function viewTrain(){
  var key=curWd(),trainable=planTemplates();
  var pills='<div class="pills" role="group" aria-label="Workout">'+trainable.map(function(t){return '<button class="pill" data-act="wd" data-k="'+esc(t.id)+'" aria-pressed="'+(t.id===key)+'">'+esc(t.name)+'</button>'}).join('')+'<button class="pill" data-act="genstart" aria-pressed="false">+ Generate</button></div>';
  if(key==='rest'){
    var day=S.days[ui.date],ov=day&&day.override;
    var note=ov?'<p class="muted small" style="margin:10px 0 0">'+(ov.reason==='skip'?'Workout skipped for today.':'Marked as rest today.')+' <button class="btn ghost sm" data-act="undooverride">Undo</button></p>':
      '<div class="two" style="margin-top:12px"><button class="btn ghost" data-act="resttoday">Rest today</button><button class="btn" data-act="skiprestopen">Skip rest &amp; train</button></div>';
    var picker=ui.trainPicker?trainPickerHTML():'';
    // No `pills` here, deliberately: the quick-pick pills set the ephemeral ui.wd, which
    // bypasses the override system entirely (no Undo, no persisted date-specific decision)
    // and would silently keep showing a workout on this date instead of Rest Day on every
    // later render until an unrelated date-navigation action happened to clear ui.wd. The
    // only way to train on a rest day is the deliberate, undoable "Skip rest & train" flow.
    return '<div class="card"><h3>Rest day</h3><p style="margin:0">Normal work and walking are enough.</p>'+note+'</div>'+picker;
  }
  if(key==='choose'){
    return pills+chooseCard();
  }
  var P=trainDayView(ui.date,key);
  if(!P)return pills+'<div class="card"><h3>No workout</h3><p style="margin:0">This workout is no longer in your active plan. Pick one above.</p></div>';
  var openSession=openSessionFor(ui.date,key),displaySession=displaySessionFor(ui.date,key);
  var sd=setsDone(key,ui.date),log=(displaySession&&displaySession.log)||{};
  // Read-only whenever there is no OPEN session to log into (i.e. we're only showing a
  // finished one): sets render disabled with their real values and no Log/Undo button, so
  // viewing a just-finished workout can never look like it reset the data, and tapping an
  // old row can never surprise-create a brand-new session (startOrGetSession always creates
  // fresh once the prior one is finished - see decideSessionStart).
  var readOnly=!openSession&&!!displaySession;
  var out=pills+lifecycleBar(openSession,lastSessionFor(ui.date,key),P)+'<div class="card"><div class="row">'+'<div class="grow"><div class="num" style="font-size:30px;font-weight:700;line-height:1.1">'+esc(P.name)+'</div><div class="muted small">'+esc(P.tag)+'</div></div><div style="text-align:right"><div class="num" style="font-size:24px;font-weight:700">'+sd.done+'/'+sd.total+'</div><div class="muted small">'+(sd.vol?num(sd.vol)+' kg volume':'sets done')+'</div></div></div><div class="cue">'+esc(P.cue)+'</div></div>';
  P.ex.forEach(function(ex){
    var sg=suggest(ex,ui.date),rows='',logged=log[ex.id]||[];
    for(var i=0;i<ex.sets;i++){
      var L=logged[i],dr=ui.drafts[ui.date+'|'+ex.id+'|'+i]||{};
      var prevLogged=null;for(var j=i-1;j>=0;j--){if(logged[j]){prevLogged=logged[j];break}}
      var w=L?L.w:(readOnly?'':(dr.w!==undefined?dr.w:fmtKg(prevLogged?prevLogged.w:sg.w)));
      var r=L?L.r:(readOnly?'':(dr.r!==undefined?dr.r:sg.reps[i]));
      var disabled=(L||readOnly)?' disabled':'';
      rows+='<div class="set'+(L?' done':'')+'" data-ex="'+esc(ex.id)+'" data-i="'+i+'"><span class="sn">'+(i+1)+'</span><div><label for="w-'+esc(ex.id)+i+'">'+(ex.bw?'+kg':'kg')+'</label><input id="w-'+esc(ex.id)+i+'" data-f="w" inputmode="decimal" value="'+esc(w)+'"'+disabled+'></div><div><label for="r-'+esc(ex.id)+i+'">'+(ex.timed?'sec':'reps')+'</label><input id="r-'+esc(ex.id)+i+'" data-f="r" inputmode="numeric" value="'+esc(r)+'"'+disabled+'></div>'+(readOnly?'':'<button class="ck" data-act="logset" aria-label="'+(L?'Undo':'Log')+' set '+(i+1)+' of '+esc(ex.name)+'">'+IC.check+'</button>')+'</div>';
    }
    var lastTxt=sg.last?'Last ('+fmtDate(sg.last.d,{day:'numeric',month:'short'})+'): '+sg.last.sets.map(function(s){return fmtKg(s.w)+' x '+s.r}).join(', '):'';
    var showPlateCalc=!ex.bw&&!ex.assisted;
    out+='<div class="card ex"><div class="ex-h"><div class="grow"><h3>'+esc(ex.name)+'</h3><div class="muted small">'+esc(ex.muscle)+' &middot; rest '+(ex.rest>=120?Math.round(ex.rest/60*2)/2+' min':ex.rest+' s')+'</div></div><span class="rng">'+(isPR(ex,ui.date,logged)?'<b class="pr">PR</b> ':'')+ex.sets+' x '+ex.lo+'&ndash;'+ex.hi+(ex.timed?'s':'')+'</span></div>'+
    '<div class="sug">'+(lastTxt?'<div class="muted small">'+esc(lastTxt)+'</div>':'')+'<b>Today: '+(ex.bw&&sg.w===0?'bodyweight':fmtKg(sg.w)+' kg')+', aim '+sg.reps.join(' / ')+(ex.timed?' s':' reps')+'</b>'+(showPlateCalc?' <button class="btn ghost sm" data-act="platecalc" data-ex="'+esc(ex.id)+'" style="margin-left:6px">Plate calculator</button>':'')+'<div class="small">'+esc(sg.note)+'</div></div>'+rows+'<div class="cue">'+esc(ex.cue)+'</div></div>';
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
  var lo=mn-pd;mn=mn>=0?Math.max(0,lo):lo;mx=mx+pd; /* only floor the axis at zero when the data itself is non-negative (assisted loads are below zero) */
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
function sessionsInRange(fromD,toD){
  var out=[];
  Object.keys(S.days).forEach(function(d){
    if(d<fromD||d>toD)return;
    (S.days[d].sessions||[]).forEach(function(s){out.push(s)});
  });
  return out;
}
function allSessionsFlat(){
  var out=[];
  Object.keys(S.days).forEach(function(d){(S.days[d].sessions||[]).forEach(function(s){out.push(s)})});
  return out;
}
/* Turns a generator preview (Phase 3B) into a real plan using the exact same builders the
   manual plan editor uses (createPlan/newTemplate/addExerciseToTemplate/addTemplateToPlan/
   setWeekdayTemplates), so a saved generated plan is structurally identical to a hand-built
   one. Never touches S.activePlanId - saving a generated plan must never silently replace
   whatever the user is already training (requirement: never auto-replace an existing plan). */
function materializeDraftPlan(draft,planName){
  var p=VShapeCore.createPlan(S.plans,planName,Date.now());
  var templateIds=[];
  draft.days.forEach(function(d){
    var tpl=VShapeCore.newTemplate(d.name,Date.now());
    tpl.tag=d.tag||'';
    d.exercises.forEach(function(e){VShapeCore.addExerciseToTemplate(tpl,Object.assign({},e))});
    VShapeCore.addTemplateToPlan(p,tpl);
    templateIds.push(tpl.id);
  });
  p.flexible=!!draft.flexible;
  if(!draft.flexible){
    (draft.weekdayAssignment||[]).forEach(function(wd,i){
      if(wd!=null&&templateIds[i])VShapeCore.setWeekdayTemplates(p,wd,[templateIds[i]]);
    });
  }
  saveLocal();
  return p;
}
function weeklyVolumeCard(){
  var days=lastDays(7),vol=VShapeCore.weeklyVolumeByMuscle(sessionsInRange(days[0],days[days.length-1]));
  var entries=Object.keys(vol).map(function(m){return {m:m,v:vol[m]}}).sort(function(a,b){return b.v-a.v});
  if(!entries.length)return '<div class="card"><h3>Training volume, last 7 days</h3><div class="empty">Log some sets this week to see volume by muscle group.</div></div>';
  var max=entries[0].v;
  return '<div class="card"><h3>Training volume, last 7 days</h3>'+entries.map(function(e){
    var pct=Math.max(4,Math.round(e.v/max*100));
    return '<div class="volrow"><div class="row"><span class="grow">'+esc(e.m)+'</span><b class="num">'+num(e.v)+' kg</b></div><div class="pb"><i style="width:'+pct+'%;background:var(--accent)"></i></div></div>';
  }).join('')+'</div>';
}
function strengthCaption(ex,unit){
  if(unit!=='kg')return 'Best set each session.';
  return ex.assisted?'Least-assisted set each session. Below zero means assisted.':'Estimated one-rep max from your best set each session.';
}
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
  out+=weeklyVolumeCard();
  var exlist=allKnownExercises(),exIds=Object.keys(exlist);
  var opts=exIds.map(function(id){var n=history(id).length;return '<option value="'+esc(id)+'"'+(id===ui.exSel?' selected':'')+'>'+esc(exlist[id].name)+(n?' ('+n+')':'')+'</option>'}).join('');
  var ex=exlist[ui.exSel]||exlist[exIds[0]];
  if(!ex)return out+'<div class="card"><h3>Strength</h3><div class="empty">Add an exercise to a plan to start tracking strength.</div></div>';
  var ss=VShapeCore.strengthSeries(ex,history(ex.id)),pts=ss.points,unit=ss.unit;
  out+='<div class="card"><h3>Strength</h3><select id="exsel" aria-label="Exercise">'+opts+'</select><div style="margin-top:10px">'+(pts.length?lineChart(pts,unit):'<div class="empty">No sets logged for this exercise yet.</div>')+'</div>'+(pts.length?'<div class="muted small">'+strengthCaption(ex,unit)+'</div>':'')+'</div>';
  return out;
}

/* ---------- weekly check-in + photos ---------- */
function viewWeekly(){
  var T=S.profile.targets,bl=weekBlocks(6),wc=weeklyCheck(),last=-1;
  bl.forEach(function(b,i){if(b.nw||b.nk||b.s||b.ses)last=i});
  var rows=bl.slice(0,last+1).map(function(b,i){
    var pv=bl[i+1],ch=(b.nw>=2&&pv&&pv.nw>=2)?b.w-pv.w:null;
    var cls=ch===null?'':(ch<=-0.2&&ch>=-0.7?'good':'bad');
    return '<tr><td>'+esc(fmtDate(b.end,{day:'numeric',month:'short'}))+'</td><td>'+(b.w?r1(b.w):'&ndash;')+'</td><td class="'+cls+'">'+(ch===null?'&ndash;':(ch>0?'+':'')+r1(ch))+'</td><td>'+(b.k?num(b.k):'&ndash;')+'</td><td>'+(b.p?num(b.p):'&ndash;')+'</td><td>'+(b.s?num(b.s):'&ndash;')+'</td><td>'+gymFrac(b.ses,'/')+'</td></tr>';
  }).join('');
  return '<div class="card"><h3>Weekly check-in</h3><div class="small muted">Goal pace is 0.3 to 0.5 kg lost per week. Each row covers the 7 days ending on that date.</div>'+
    (wc?'<div class="prev"><b>'+esc(wc.txt)+'</b></div>'+(wc.adj?'<button class="btn full" data-act="applyadj">Set target to '+num(Math.max(1900,T.kcal+wc.adj))+' kcal</button>':''):'<div class="prev">Weigh in at least twice in each of the last two weeks and the app will tell you whether to change your calories.</div>')+
    (rows?'<div class="wk"><table><thead><tr><th>Week to</th><th>kg</th><th>Change</th><th>kcal</th><th>Protein</th><th>Steps</th><th>Gym</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'')+
    '<details><summary>Phase guide</summary><ol><li>Weeks 1 and 2: hit '+num(T.kcal)+' kcal and '+T.protein+' g protein, steps on shifts, '+(weeklyGymTarget()||'your usual')+' gym days. This sets your baseline.</li><li>Weeks 3 to 8: change calories once a week at most, by 150 kcal, using the check above.</li><li>Once your abs are visible: eat about 2,600 kcal for two weeks to hold the look, then reassess.</li><li>If your lifts fall for two weeks and you feel flat, eat about 2,600 kcal for 5 to 7 days, then resume.</li></ol></details></div>';
}
function viewPhotos(){
  var keys=Object.keys(S.photos).sort(),o='<div class="card"><h3>Progress photos</h3>';
  function cap(k){var p=S.photos[k];return esc(fmtDate(k,{day:'numeric',month:'short'}))+(p.w?' &middot; '+p.w+' kg':'')}
  if(!keys.length)o+='<div class="small muted">Take one front photo each week: same spot, same light, same distance, relaxed. Photos show changes the scale misses. They are resized small and kept with your logs.</div>';
  else{
    if(keys.length>1){var a=keys[0],b=keys[keys.length-1];o+='<div class="cmp"><figure><img alt="First progress photo" src="'+esc(S.photos[a].img)+'"><figcaption>'+cap(a)+'<br><span class="muted">First</span></figcaption></figure><figure><img alt="Latest progress photo" src="'+esc(S.photos[b].img)+'"><figcaption>'+cap(b)+'<br><span class="muted">Latest</span></figcaption></figure></div>'}
    o+='<div class="thumbs">'+keys.slice().reverse().map(function(k){return '<button data-act="openphoto" data-d="'+esc(k)+'" aria-label="Open photo from '+esc(k)+'"><img alt="" src="'+esc(S.photos[k].img)+'"><span>'+esc(fmtDate(k,{day:'numeric',month:'short'}))+'</span></button>'}).join('')+'</div>';
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
// Builds the full payload the native notification needs to act as a quick-logging
// controller, not just a readout: the session's own revision/identity fields (sessionId,
// exId, setIndex, lastAppliedSeq) so the native side can stamp a logset action with the
// exact set it means, the derived control state, the suggested load/reps for the pending
// set (kept separate from whatever the user may be locally adjusting - the notification
// only ever sends back whatever it actually displays, never silently invents a value), and
// the current/overall set-completion counts for both the whole workout and the one
// exercise in progress.
// Phase 2B.3: the notification needs to be able to validate, commit and advance through the
// ENTIRE rest of the workout natively, without the WebView running at all - so this payload
// carries everything required to do that offline, not just the one currently-pending set:
// - exSnapshot: the full, frozen exercise list (native needs ex.sets/lo/hi/rest/inc/bw/
//   assisted/timed for every exercise, not just the current one, to walk forward).
// - committedLog: session.log exactly as JS currently has it. Native resets its own "sets
//   committed since the last sync" cache against this every time it arrives, which is what
//   stops a native-side commit that has since actually been reconciled (or an in-app edit,
//   e.g. an undo) from silently diverging from what JS already knows - see
//   ActionQueue.pruneNativeCommits on the native side.
// - suggestions: one entry per exercise that still has at least one pending set, each with the
//   full suggested reps array for that exercise - a lookahead table, not just "the current
//   set's suggestion" - so native can keep presenting correct suggested loads for sets several
//   exercises ahead without ever running suggestProgression (history-based, JS-only) itself.
function pushNotificationState(){
  var plugin=wnPlugin();if(!plugin||!isNative())return;
  var s=getOpenSessionAnywhere();
  if(!VShapeCore.shouldShowNotification(s)){if(plugin.hide)Promise.resolve(plugin.hide()).catch(function(err){console&&console.warn&&console.warn('WorkoutNotification.hide failed',err)});return}
  var P=sessionDayView(s),sd=VShapeCore.sessionSetsDone(s,P);
  var state=VShapeCore.notificationState(s,P);
  var pending=VShapeCore.nextPendingSet(s,P);
  var pendingEx=pending?P.ex[pending.exIndex]:null;
  var sg=pendingEx?suggest(pendingEx,S.active?S.active.date:todayISO()):null;
  var exDone=pendingEx?((s.log[pendingEx.id]||[]).filter(Boolean).length):0;
  var pendingExIds={};
  VShapeCore.pendingSetsList(s,P).forEach(function(p){pendingExIds[p.exId]=true});
  var suggestions=Object.keys(pendingExIds).map(function(exId){
    var ex=P.ex.filter(function(e){return e.id===exId})[0];
    var g=ex?suggest(ex,S.active?S.active.date:todayISO()):null;
    return g?{exId:exId,w:g.w,reps:g.reps}:null;
  }).filter(Boolean);
  var payload={
    sessionId:s.id,title:P?P.name:'Workout',status:s.status,state:state,
    lastAppliedSeq:s.lastAppliedSeq||0,
    startedAtEpochMs:s.startedAt,pausedMs:s.pausedMs||0,
    elapsedMs:VShapeCore.sessionElapsedMs(s,Date.now()),
    setsDone:sd.done,setsTotal:sd.total,
    exerciseName:pendingEx?pendingEx.name:(P.ex.length?P.ex[P.ex.length-1].name:''),
    exId:pendingEx?pendingEx.id:null,
    setIndex:pending?pending.setIndex:null,
    setNumber:pending?pending.setIndex+1:null,
    exerciseSetsDone:exDone,exerciseSetsTotal:pendingEx?pendingEx.sets:0,
    suggestedW:sg?sg.w:null,suggestedR:(sg&&pending)?sg.reps[pending.setIndex]:null,
    isBodyweight:pendingEx?!!pendingEx.bw:false,isTimed:pendingEx?!!pendingEx.timed:false,
    weightIncrement:pendingEx?(pendingEx.inc||0):0,
    restActive:!!s.rest,restPaused:s.rest?!!s.rest.paused:false,
    restDeadlineEpochMs:(s.rest&&!s.rest.paused)?s.rest.deadline:null,
    restRemainingMs:s.rest?VShapeCore.restRemainingMs(s,Date.now()):null,
    exSnapshot:P.ex,committedLog:s.log,suggestions:suggestions
  };
  if(plugin.show)Promise.resolve(plugin.show(payload)).then(function(res){if(res&&res.error)reportNotifError(res.error)}).catch(function(){reportNotifError('could not update the notification')});
}
function reconcileNativeActions(){
  var plugin=wnPlugin();if(!plugin||!isNative()||!plugin.getPendingActions)return Promise.resolve();
  return Promise.resolve(plugin.getPendingActions()).then(function(res){
    if(res&&res.error)reportNotifError(res.error);
    var actions=(res&&res.actions)||[];
    if(!actions.length)return;
    var liveSession=getOpenSessionAnywhere();
    var day=(liveSession&&S.active)?S.days[S.active.date]:null;
    var idx=(day&&liveSession)?day.sessions.indexOf(liveSession):-1;
    /* Reconcile against a disposable CLONE, never the live session object directly. If we
       mutated the live object first and the save below then failed, the live session would
       be left holding an applied-but-never-persisted change - and ANY later, unrelated
       render() (switching tabs, logging food, anything at all; render() unconditionally
       calls pushNotificationState()) would push that same unsaved state to native as if it
       were durable. Native's pruneNativeCommits would then discard its own cached copy of
       that exact set because it looks "settled" in what JS just sent - leaving the set
       nowhere at all: not in localStorage (the save failed) and no longer in the native
       cache either. Working on a clone and only swapping it into S.days once the save has
       actually succeeded (and rolling the swap back if it hasn't) is what keeps the live
       session always equal to whatever is truly durable. */
    var session=idx>=0?clone(liveSession):liveSession;
    var r=VShapeCore.reconcileActions(session,actions,Date.now());
    /* reconcileActions puts every action from this batch into either applied or
       skipped - never drops one silently - so acknowledging (clearing) the
       whole batch by its highest seq is always safe PROVIDED the resulting
       state actually made it to durable storage. A skip-only batch changed
       nothing, so it's always safe to clear. A batch with an applied action
       is only cleared once its save actually succeeds - if saveDay() fails
       (full storage, etc.), the queue is left untouched so the exact same
       actions are retried next time, instead of being discarded with their
       effect never durably saved. */
    var maxSeq=actions.reduce(function(m,a){return Math.max(m,a.seq||0)},0);
    var savedOk=true;
    if(r.applied.length&&idx>=0){
      day.sessions[idx]=session;
      saveDay(S.active.date);
      savedOk=(ui.storageOk!==false);
      if(!savedOk)day.sessions[idx]=liveSession; /* roll back: the save failed, so the live session must stay exactly what localStorage still has */
    }
    /* Refresh the notification whenever we actually processed a batch, not only when
       something was applied: a skip-only batch (a rejected invalid-weight adjustment, a
       stale/duplicate tap) still needs the native "...Updating…" hint cleared and replaced
       with the real current state - otherwise the notification is left stuck showing a
       pending label for an action that has already been fully decided (and rejected). */
    if(savedOk){render();resumeTickIfNeeded()}
    if(!savedOk)return; /* leave the native queue alone; retry next reconciliation */
    if(plugin.clearPendingActions)return Promise.resolve(plugin.clearPendingActions({upTo:maxSeq})).catch(function(){});
  }).catch(function(){});
}
function reportNotifError(msg){
  if(ui.lastNotifError===msg)return;
  ui.lastNotifError=msg;
  toast('Workout notification: '+msg);
}

/* ---------- nutrition module integration (Phase: Agent 2) ---------- */
// Which calendar dates (as ISO strings) count as "training" for the advanced nutrition engine's
// training/rest target split - resolved from the exact same schedule+override logic curWd()
// already uses, not reimplemented. A flexible plan (no fixed weekdays) offers every template
// every day, so every day resolves as a training day for a flexible-schedule user; that is a
// known, documented simplification, not a bug - there is no better signal to use instead.
function trainingIsoDates(){
  var plan=VShapeCore.findPlan(S.plans,S.activePlanId),out=[],t=todayISO();
  for(var i=-60;i<=7;i++){
    var d=addDays(t,i),wd=parseISO(d).getDay();
    var res=VShapeCore.applyDayOverride(VShapeCore.resolveWeekday(plan,wd),S.days[d]&&S.days[d].override);
    if(res.kind!=='rest')out.push(d);
  }
  return out;
}
// The stable key a legacy S.days[*].food entry and an advanced nutrition log agree on: a log
// migrated from an old entry carries that entry's original id as `legacyId`; a log created
// fresh through the new UI has no legacyId, so its own id is used instead.
function legacyLogKey(l){return l.legacyId||l.id}
// Projects the advanced engine's logs back into the legacy S.days[*].food shape the old
// dashboard rings/weekly check still read, for every day either the previous or the next log
// set touches. Diffed by legacyLogKey so add/edit/delete all collapse into "replace this day's
// projected rows" without disturbing that day's steps/sessions/water/photos/override/quarantine,
// and without re-appending every log on every call (only the touched days are rewritten).
function projectNutritionLogsToLegacyDays(next,previous){
  var prevById={},nextById={};
  ((previous&&previous.logs)||[]).forEach(function(l){prevById[legacyLogKey(l)]=l});
  ((next&&next.logs)||[]).forEach(function(l){nextById[legacyLogKey(l)]=l});
  var keys={};Object.keys(prevById).forEach(function(k){keys[k]=true});Object.keys(nextById).forEach(function(k){keys[k]=true});
  var touchedDays={};
  Object.keys(prevById).forEach(function(k){touchedDays[prevById[k].day]=true});
  Object.keys(nextById).forEach(function(k){touchedDays[nextById[k].day]=true});
  Object.keys(touchedDays).forEach(function(day){
    var d=ensureDay(day);
    var kept=d.food.filter(function(e){return !keys[e.id]});
    Object.keys(nextById).forEach(function(k){
      var l=nextById[k];if(l.day!==day)return;
      var n=l.nutrition||{};
      kept.push({id:k,meal:l.meal,name:l.name,qty:l.qty,unit:l.unit,k:n.k,p:n.p,c:n.c,f:n.f});
    });
    d.food=kept;
  });
  return Object.keys(touchedDays);
}
// The durable persistence callback the mounted nutrition UI calls for every mutation (including
// undo). saveLocal() here is fully synchronous, so "durable" just means: mutate, save, check
// ui.storageOk, and roll back both the profile field and every touched day on failure - never
// resolve before the write actually succeeded.
function commitNutritionToExistingApp(next,meta){
  var previous=meta&&meta.previous;
  return new Promise(function(resolve,reject){
    var touchedDays=[];
    ((previous&&previous.logs)||[]).concat((next&&next.logs)||[]).forEach(function(l){if(touchedDays.indexOf(l.day)<0)touchedDays.push(l.day)});
    var daySnapshot={};
    touchedDays.forEach(function(d){if(S.days[d])daySnapshot[d]=clone(S.days[d])});
    var prevAdvanced=S.profile.nutritionAdvanced;
    S.profile.nutritionAdvanced=next;
    projectNutritionLogsToLegacyDays(next,previous);
    saveLocal();
    if(ui.storageOk){resolve();return}
    S.profile.nutritionAdvanced=prevAdvanced;
    touchedDays.forEach(function(d){if(daySnapshot[d])S.days[d]=daySnapshot[d];else delete S.days[d]});
    reject(new Error(ui.storageMsg||'Could not save your nutrition changes.'));
  });
}
// Mounts/unmounts the nutrition UI's own persistent DOM subtree against the Food tab's stable
// placeholder. Must run AFTER #app's innerHTML is rebuilt (every prior mount's container is
// destroyed by that string replace) and must never be called from inside commitNutritionToExistingApp
// itself (the module's own re-render after a successful commit would race a fresh remount here).
function ensureFoodMount(){
  if(ui.tab!=='food'){if(foodMount){foodMount.destroy();foodMount=null}return}
  if(foodMount){foodMount.destroy();foodMount=null}
  var root=$('#food-root');if(!root)return;
  if(ui.nutritionCorrupt){
    root.innerHTML='<div class="card"><h3>Nutrition data needs attention</h3><p class="muted small">Your saved nutrition data could not be read on this device. Nothing has been deleted. Export a diagnostic report from Settings, then restore a backup if you have one.</p></div>';
    return;
  }
  foodMount=VShapeNutritionUI.mount(root,{
    state:S.profile.nutritionAdvanced,day:ui.date,makeId:uid,
    weights:S.profile.weights,trainingDays:trainingIsoDates(),
    onChange:commitNutritionToExistingApp
  });
}

/* ---------- render ---------- */
var TABS=[['today','Today','today'],['food','Food','food'],['train','Train','train'],['progress','Progress','prog']];
function render(){
  if(S.locked){
    if(foodMount){foodMount.destroy();foodMount=null}
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
  ensureFoodMount();
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
function closeSheet(){ui.sheet=null;if(appearanceMount){appearanceMount.destroy();appearanceMount=null}$('#sheet-root').innerHTML=''}
function drawSheet(){
  var s=ui.sheet;if(!s){closeSheet();return}
  var body='';
  if(s.type==='settings')body=settingsHTML();
  else if(s.type==='onboard')body=obHTML();
  else if(s.type==='photo')body=photoHTML();
  else if(s.type==='import')body=importHTML();
  else if(s.type==='finish')body=finishHTML();
  else if(s.type==='plan')body=planEditHTML();
  else if(s.type==='planweekday')body=planWeekdayHTML();
  else if(s.type==='plantemplate')body=planTemplateHTML();
  else if(s.type==='planex')body=planExHTML();
  else if(s.type==='gen')body=genHTML();
  else if(s.type==='genpreview')body=genPreviewHTML();
  else if(s.type==='exalt')body=exAltHTML();
  else if(s.type==='library')body=libraryHTML();
  else if(s.type==='libedit')body=libEditHTML();
  else if(s.type==='platecalc')body=platecalcHTML();
  else if(s.type==='platesettings')body=platesettingsHTML();
  $('#sheet-root').innerHTML='<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true">'+body+'</div></div>';
  if(appearanceMount){appearanceMount.destroy();appearanceMount=null}
  if(s.type==='settings'){
    var appearanceRoot=$('#appearance-root');
    if(appearanceRoot)appearanceMount=VShapeThemes.mount(appearanceRoot,{
      preferences:S.profile.appearance,
      onSave:function(prefs){
        var p=S.profile.appearance;S.profile.appearance=prefs;saveProfile();
        if(!ui.storageOk){S.profile.appearance=p;return Promise.reject(new Error(ui.storageMsg||'Could not save appearance.'))}
        if(themeWatcher)themeWatcher.set(prefs);
        return Promise.resolve();
      }
    });
  }
}
function installBanner(){
  if(!installEvt||isStandalone())return '';
  return '<div class="card banner"><div class="grow"><b>Install V-Shape</b><div class="muted small">Opens full screen from your home screen and works offline.</div></div><button class="btn sm" data-act="installapp">Install</button></div>';
}
/* Everything lives on this device, so a stale/missing backup is the biggest data-loss risk. The
   decision itself is VShapeCore.backupReminder (pure + unit-tested); this only draws it. */
function backupBanner(){
  var r=VShapeCore.backupReminder(S.profile,S.days,todayISO(),Date.now());
  if(!r)return '';
  var why=r.kind==='never'?'You have never backed up, and your data only lives on this device.':'Your last backup was '+r.sinceDays+' days ago, and your data only lives on this device.';
  return '<div class="card banner"><div class="grow"><b>Back up your data</b><div class="muted small">'+why+'</div></div><div style="display:flex;flex-direction:column;gap:6px"><button class="btn sm" data-act="exportdata">Back up</button><button class="btn ghost sm" data-act="backuplater">Later</button></div></div>';
}
function lastBackupText(){
  var t=S.profile.lastBackupAt;
  if(!VShapeCore.isFiniteNumber(t))return 'Never backed up.';
  var d=Math.floor((Date.now()-t)/86400000);
  return 'Last backup: '+(d<=0?'today':d===1?'yesterday':d+' days ago')+'.';
}
function settingsHTML(){
  var T=S.profile.targets,bl=S.profile.baseline||{};
  return '<div class="sh-h"><h3>Settings</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>'+
  '<div class="two"><label class="fld" for="t-k">Calories<input id="t-k" inputmode="numeric" value="'+esc(T.kcal)+'"></label><label class="fld" for="t-p">Protein (g)<input id="t-p" inputmode="numeric" value="'+esc(T.protein)+'"></label></div>'+
  '<div class="two"><label class="fld" for="t-s">Steps<input id="t-s" inputmode="numeric" value="'+esc(T.steps)+'"></label><label class="fld" for="t-w">Water (ml)<input id="t-w" inputmode="numeric" value="'+esc(T.water||3000)+'"></label></div><button class="btn full" style="margin-top:14px" data-act="savesettings">Save targets</button>'+
  '<h4 class="sh4">Appearance</h4><div id="appearance-root"></div>'+
  '<h4 class="sh4">Baseline measurements (optional)</h4><p class="muted small" style="margin:0 0 10px">Used only for the "where you started" card on Progress. Leave blank if you have not had a scan.</p>'+
  '<div class="two"><label class="fld" for="b-w">Weight (kg)<input id="b-w" inputmode="decimal" value="'+esc(bl.weight!=null?bl.weight:'')+'"></label><label class="fld" for="b-bf">Body fat %<input id="b-bf" inputmode="decimal" value="'+esc(bl.bodyFatPct!=null?bl.bodyFatPct:'')+'"></label></div>'+
  '<label class="fld" for="b-date">Scan date or label<input id="b-date" placeholder="e.g. 17 Sep scan" value="'+esc(bl.label||'')+'"></label>'+
  '<button class="btn ghost full" style="margin-top:8px" data-act="savebaseline">Save baseline</button>'+
  '<h4 class="sh4">Fitness profile</h4>'+
  '<div class="listrow"><div class="grow"><b>'+(S.profile.fitness.onboarded?'Profile set up':'Not set up yet')+'</b><div class="muted small">'+esc(fitnessSummaryLine())+'</div></div><button class="btn ghost sm" data-act="obedit">'+(S.profile.fitness.onboarded?'Edit':'Set up')+'</button></div>'+
  '<h4 class="sh4">Workout plans</h4>'+
  (S.plans||[]).map(function(p){
    return '<div class="listrow"><button class="grow planname" data-act="planactivate" data-id="'+esc(p.id)+'">'+(p.id===S.activePlanId?'&#9679;':'&#9675;')+' <b>'+esc(p.name)+'</b><div class="muted small">'+p.templates.length+' workout'+(p.templates.length===1?'':'s')+(p.id===S.activePlanId?' &middot; active':'')+'</div></button>'+
      '<button class="icon sm" data-act="planedit" data-id="'+esc(p.id)+'" aria-label="Edit '+esc(p.name)+'">&#9998;</button>'+
      '<button class="icon sm" data-act="plandup" data-id="'+esc(p.id)+'" aria-label="Duplicate '+esc(p.name)+'">&#10064;</button>'+
      (S.plans.length>1?'<button class="icon sm" data-act="plandel" data-id="'+esc(p.id)+'" aria-label="Delete '+esc(p.name)+'">&times;</button>':'')+
    '</div>';
  }).join('')+
  '<button class="btn ghost full" style="margin-top:8px" data-act="plannew">+ New plan</button>'+
  '<button class="btn ghost full" style="margin-top:8px" data-act="genstart">+ Generate a plan</button>'+
  '<button class="btn ghost full" style="margin-top:8px" data-act="libopen">Exercise library</button>'+
  '<button class="btn ghost full" style="margin-top:8px" data-act="platesettingsopen">Plate calculator</button>'+
  (isNative()?'<h4 class="sh4">Workout notifications</h4><p class="muted small" style="margin:0 0 10px">'+(S.profile.notifPermission==='granted'?'On. You will see your active workout in the notification shade.':S.profile.notifPermission==='denied'?'Off. The workout still tracks fine inside the app.':'Not set up yet.')+'</p><button class="btn ghost full" data-act="requestworkoutnotif">'+(S.profile.notifPermission==='granted'?'Check permission again':'Enable workout notifications')+'</button>':'')+
  '<h4 class="sh4">Your data</h4><p class="muted small" style="margin:0 0 6px">Everything is stored on this phone only. Export a backup now and then, and always before you clear browser data or change phones.</p><p class="small" style="margin:0 0 10px"><b>'+lastBackupText()+'</b></p>'+
  '<div class="two"><button class="btn ghost" data-act="exportdata">Export backup</button><button class="btn ghost" data-act="importdata">Restore backup</button></div>'+
  '<button class="btn ghost full" style="margin-top:8px" data-act="recoversafety">Recover saved copies</button>'+
  '<button class="btn ghost full" style="margin-top:8px" data-act="exportdiagnostics">Export diagnostic report</button>'+
  (isStandalone()?'':'<h4 class="sh4">Install</h4><p class="muted small" style="margin:0">'+(installEvt?'<button class="btn full" data-act="installapp">Install app</button>':'In Chrome or Samsung Internet, open the menu and choose Add to Home screen or Install app.')+'</p>');
}
var WEEKDAY_NAMES=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var WEEKDAY_SHORT=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var WEEK_ORDER=[1,2,3,4,5,6,0]; // display Mon..Sun, matching the app-wide convention and the user's own example schedule

/* ---------- fitness profile onboarding/editor (Phase 3A) ----------
   A single stepped sheet (type:'onboard') used BOTH for first-run onboarding and for
   later editing from Settings. There is no separate "draft" - every answer is written
   straight into S.profile.fitness and saved immediately, exactly like every other field
   in this app (weekdaytoggle, planflexibletoggle, ...). That is what makes "save progress
   across app restarts" free: onboardingStep is itself a persisted field, so a user who
   force-quits mid-flow resumes exactly where they left off, with every answer already
   given intact - never re-asked, never lost. Nothing here is ever required: every step
   can be left blank and revisited later from Settings > Fitness profile. */
function labelFor(list,id){var x=(list||[]).filter(function(i){return i.id===id})[0];return x?x.label:id}
function fmtWeightDisplay(kg,unit){return kg==null?null:(unit==='lb'?r1(VShapeCore.kgToLb(kg))+' lb':r1(kg)+' kg')}
function fitnessSummaryLine(){
  var fp=S.profile.fitness,wp=fp.workoutPrefs,parts=[];
  if(fp.experience)parts.push(labelFor(EXPERIENCE_LEVELS,fp.experience));
  if(fp.primaryGoal)parts.push(labelFor(GOALS.concat(fp.customGoals||[]),fp.primaryGoal));
  if(wp.daysPerWeek)parts.push(wp.daysPerWeek+' days/week');
  return parts.length?parts.join(' · '):'Tell us about your goals and training setup';
}
var OB_TOTAL_STEPS=8;
function obMinStep(){return ui.sheet.editing?1:0}
function obChip(item,selected,act){
  return '<button class="chip'+(selected?' sel':'')+'" data-act="'+act+'" data-id="'+esc(item.id)+'" aria-pressed="'+!!selected+'">'+esc(item.label)+'</button>';
}
function obCard(item,selected,act){
  return '<button class="obcard'+(selected?' sel':'')+'" data-act="'+act+'" data-id="'+esc(item.id)+'" aria-pressed="'+!!selected+'"><b>'+esc(item.label)+'</b>'+(item.desc?'<div class="muted small">'+esc(item.desc)+'</div>':'')+'</button>';
}
function obShell(title,body){
  var s=ui.sheet,min=obMinStep(),step=s.step,pct=Math.round(step/OB_TOTAL_STEPS*100);
  var bar='<div class="obbar"><i style="width:'+pct+'%"></i></div><div class="muted small" style="margin:6px 0 14px">Step '+step+' of '+OB_TOTAL_STEPS+'</div>';
  var backBtn=step>min?'<button class="icon" data-act="obback" aria-label="Back">&#8249;</button>':'<span style="width:42px;display:inline-block"></span>';
  var isLast=step>=OB_TOTAL_STEPS,nextLabel=isLast?(s.editing?'Save & close':'Finish setup'):'Next',nextAct=isLast?'obfinish':'obnext';
  return '<div class="sh-h">'+backBtn+'<h3>'+esc(title)+'</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>'+bar+body+
    '<button class="btn full" style="margin-top:16px" data-act="'+nextAct+'">'+esc(nextLabel)+'</button>';
}
function obWelcomeHTML(){
  return '<div class="sh-h"><h3>Your fitness profile</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>'+
    '<p class="muted small">A few quick questions about you, your goals and how you like to train - used later to tailor your workouts. '+
    'Everything is optional and stays on this phone. Skip anything you are not sure about now; you can always come back and fill it in from Settings.</p>'+
    '<button class="btn full" style="margin-top:16px" data-act="obstart">Let&rsquo;s go</button>'+
    '<button class="btn ghost full" style="margin-top:8px" data-act="closesheet">Skip for now</button>';
}
function obAboutHTML(){
  var fp=S.profile.fitness,u=fp.units;
  var heightField=u.height==='cm'
    ?'<label class="fld" for="ob-h-cm">Height (cm, optional)<input id="ob-h-cm" inputmode="decimal" placeholder="e.g. 175" value="'+(fp.heightCm!=null?fp.heightCm:'')+'"></label>'
    :(function(){var fi=VShapeCore.cmToFeetInches(fp.heightCm||0);return '<div class="two"><label class="fld" for="ob-h-ft">Height - ft (optional)<input id="ob-h-ft" inputmode="numeric" placeholder="5" value="'+(fp.heightCm!=null?fi.ft:'')+'"></label><label class="fld" for="ob-h-in">in<input id="ob-h-in" inputmode="numeric" placeholder="9" value="'+(fp.heightCm!=null?fi.inch:'')+'"></label></div>'})();
  var wu=u.weight,curW=fp.currentWeightKg!=null?(wu==='lb'?VShapeCore.kgToLb(fp.currentWeightKg):fp.currentWeightKg):'';
  var tgtW=fp.targetWeightKg!=null?(wu==='lb'?VShapeCore.kgToLb(fp.targetWeightKg):fp.targetWeightKg):'';
  return obShell('About you',
    '<label class="fld" for="ob-dob">Date of birth (optional)<input id="ob-dob" type="date" value="'+(fp.dob||'')+'"></label>'+
    '<div class="muted small" style="margin-top:10px">Units</div>'+
    '<div class="chipwrap">'+
      obChip({id:'kg',label:'kg'},wu==='kg','obunitweight')+obChip({id:'lb',label:'lb'},wu==='lb','obunitweight')+
      obChip({id:'cm',label:'cm'},u.height==='cm','obunitheight')+obChip({id:'ftin',label:'ft/in'},u.height==='ftin','obunitheight')+
    '</div>'+
    heightField+
    '<label class="fld" for="ob-w">Current weight ('+wu+', optional)<input id="ob-w" inputmode="decimal" value="'+curW+'"></label>'+
    '<label class="fld" for="ob-tw">Target weight ('+wu+', optional)<input id="ob-tw" inputmode="decimal" value="'+tgtW+'"></label>'
  );
}
function obGenderExpHTML(){
  var fp=S.profile.fitness;
  return obShell('About you',
    '<h4 class="sh4">Gender (optional)</h4><div class="chipwrap">'+GENDERS.map(function(g){return obChip(g,fp.gender===g.id,'obgender')}).join('')+'</div>'+
    '<h4 class="sh4">Fitness experience (optional)</h4>'+EXPERIENCE_LEVELS.map(function(e){return obCard(e,fp.experience===e.id,'obexperience')}).join('')
  );
}
function obGoalsAll(){return GOALS.concat(S.profile.fitness.customGoals||[])}
function obGoalsFiltered(){var q=(ui.sheet.goalQ||'').toLowerCase().trim(),all=obGoalsAll();return q?all.filter(function(g){return g.label.toLowerCase().indexOf(q)>=0}):all}
function obGoalPrimaryList(){var fp=S.profile.fitness,list=obGoalsFiltered();return list.map(function(g){return obChip(g,fp.primaryGoal===g.id,'obgoalprimary')}).join('')||'<div class="empty">No matches</div>'}
function obGoalSecondaryList(){var fp=S.profile.fitness,list=obGoalsFiltered().filter(function(g){return g.id!==fp.primaryGoal});return list.map(function(g){return obChip(g,(fp.secondaryGoals||[]).indexOf(g.id)>=0,'obgoalsecondary')}).join('')||'<div class="empty">No matches</div>'}
function obGoalsHTML(){
  return obShell('Your goals',
    '<h4 class="sh4">Primary goal (optional)</h4>'+
    '<input id="ob-goal-q" type="search" placeholder="Search goals" value="'+esc(ui.sheet.goalQ||'')+'">'+
    '<div class="chipwrap" id="ob-goal-primary-list" style="margin-top:8px">'+obGoalPrimaryList()+'</div>'+
    '<div class="row" style="margin-top:8px"><input id="ob-goal-custom" placeholder="Add your own goal"><button class="btn ghost sm" data-act="obaddgoal">Add</button></div>'+
    '<h4 class="sh4">Secondary goals (optional)</h4><div class="chipwrap" id="ob-goal-secondary-list">'+obGoalSecondaryList()+'</div>'
  );
}
function obActivityHTML(){
  var fp=S.profile.fitness;
  return obShell('Activity & frequency',
    '<h4 class="sh4">Daily activity level (optional)</h4>'+ACTIVITY_LEVELS.map(function(a){return obCard(a,fp.activityLevel===a.id,'obactivity')}).join('')+
    '<h4 class="sh4">Current training frequency (optional)</h4><div class="chipwrap">'+FREQ_OPTIONS.map(function(n){return '<button class="chip'+(fp.currentTrainingFrequency===n?' sel':'')+'" data-act="obfreq" data-n="'+n+'" aria-pressed="'+(fp.currentTrainingFrequency===n)+'">'+(n===0?'0 (none yet)':n)+'</button>'}).join('')+'</div>'
  );
}
function obScheduleHTML(){
  var wp=S.profile.fitness.workoutPrefs;
  var daysField=wp.scheduleType==='fixed'?
    '<h4 class="sh4">Available training days</h4><div class="chipwrap">'+WEEK_ORDER.map(function(wd){return '<button class="chip'+((wp.availableDays||[]).indexOf(wd)>=0?' sel':'')+'" data-act="obweekday" data-wd="'+wd+'" aria-pressed="'+((wp.availableDays||[]).indexOf(wd)>=0)+'">'+WEEKDAY_SHORT[wd]+'</button>'}).join('')+'</div>':'';
  return obShell('Training schedule',
    '<h4 class="sh4">Training days per week (optional)</h4><div class="chipwrap">'+DAYS_PER_WEEK_OPTIONS.map(function(n){return '<button class="chip'+(wp.daysPerWeek===n?' sel':'')+'" data-act="obdays" data-n="'+n+'" aria-pressed="'+(wp.daysPerWeek===n)+'">'+n+'</button>'}).join('')+'</div>'+
    '<h4 class="sh4">Schedule (optional)</h4><div class="chipwrap">'+
      '<button class="chip'+(wp.scheduleType==='fixed'?' sel':'')+'" data-act="obschedtype" data-v="fixed" aria-pressed="'+(wp.scheduleType==='fixed')+'">Fixed weekdays</button>'+
      '<button class="chip'+(wp.scheduleType==='flexible'?' sel':'')+'" data-act="obschedtype" data-v="flexible" aria-pressed="'+(wp.scheduleType==='flexible')+'">Flexible</button>'+
    '</div>'+daysField+
    '<h4 class="sh4">Preferred workout duration (optional)</h4><div class="chipwrap">'+DURATIONS.map(function(n){return '<button class="chip'+(wp.sessionDuration===n?' sel':'')+'" data-act="obduration" data-n="'+n+'" aria-pressed="'+(wp.sessionDuration===n)+'">'+n+' min</button>'}).join('')+'</div>'
  );
}
function obEquipAll(){return EQUIPMENT.concat(S.profile.fitness.workoutPrefs.customEquipment||[])}
function obEquipFiltered(){var q=(ui.sheet.equipQ||'').toLowerCase().trim(),all=obEquipAll();return q?all.filter(function(e){return e.label.toLowerCase().indexOf(q)>=0}):all}
function obEquipList(){var wp=S.profile.fitness.workoutPrefs,list=obEquipFiltered();return list.map(function(e){return obChip(e,(wp.equipment||[]).indexOf(e.id)>=0,'obequip')}).join('')||'<div class="empty">No matches</div>'}
function obEquipmentHTML(){
  var wp=S.profile.fitness.workoutPrefs;
  return obShell('Equipment & split',
    '<h4 class="sh4">Where do you train? (optional)</h4><div class="chipwrap">'+
      [['gym','Gym'],['home','Home'],['mixed','Mixed']].map(function(x){return '<button class="chip'+(wp.equipmentAccess===x[0]?' sel':'')+'" data-act="obaccess" data-v="'+x[0]+'" aria-pressed="'+(wp.equipmentAccess===x[0])+'">'+x[1]+'</button>'}).join('')+'</div>'+
    '<h4 class="sh4">Available equipment (optional)</h4>'+
    '<input id="ob-equip-q" type="search" placeholder="Search equipment" value="'+esc(ui.sheet.equipQ||'')+'">'+
    '<div class="chipwrap" id="ob-equip-list" style="margin-top:8px">'+obEquipList()+'</div>'+
    '<div class="row" style="margin-top:8px"><input id="ob-equip-custom" placeholder="Add your own equipment"><button class="btn ghost sm" data-act="obaddequip">Add</button></div>'+
    '<h4 class="sh4">Preferred workout split (optional)</h4>'+SPLITS.map(function(sp){return obCard(sp,wp.preferredSplit===sp.id,'obsplit')}).join('')
  );
}
function obMuscleFiltered(){var q=(ui.sheet.muscleQ||'').toLowerCase().trim();return q?MUSCLE_GROUPS.filter(function(m){return m.label.toLowerCase().indexOf(q)>=0}):MUSCLE_GROUPS}
function obMuscleList(){var wp=S.profile.fitness.workoutPrefs,list=obMuscleFiltered();return list.map(function(m){return obChip(m,(wp.priorityMuscles||[]).indexOf(m.id)>=0,'obmuscle')}).join('')||'<div class="empty">No matches</div>'}
function obTagInput(kind,list){
  var tags=(list||[]).map(function(t,i){return '<span class="tag">'+esc(t)+'<button data-act="obremovetag" data-kind="'+kind+'" data-i="'+i+'" aria-label="Remove '+esc(t)+'">&times;</button></span>'}).join('');
  return '<div class="taglist">'+tags+'</div><div class="row" style="margin-top:8px"><input id="ob-tag-'+kind+'" placeholder="Type an exercise name"><button class="btn ghost sm" data-act="obaddtag" data-kind="'+kind+'">Add</button></div>';
}
function obFocusHTML(){
  var wp=S.profile.fitness.workoutPrefs;
  return obShell('Focus & preferences',
    '<h4 class="sh4">Muscle groups to prioritise (optional)</h4>'+
    '<input id="ob-muscle-q" type="search" placeholder="Search muscle groups" value="'+esc(ui.sheet.muscleQ||'')+'">'+
    '<div class="chipwrap" id="ob-muscle-list" style="margin-top:8px">'+obMuscleList()+'</div>'+
    '<h4 class="sh4">Exercises you prefer (optional)</h4>'+obTagInput('pref',wp.preferredExercises)+
    '<h4 class="sh4">Exercises to avoid (optional)</h4>'+obTagInput('avoid',wp.avoidExercises)+
    '<label class="fld" for="ob-limitations">Mobility or physical limitations (optional)<input id="ob-limitations" value="'+esc(wp.limitations||'')+'" placeholder="e.g. bad left knee, avoid overhead pressing"></label>'
  );
}
function obReviewHTML(){
  var fp=S.profile.fitness,wp=fp.workoutPrefs,age=VShapeCore.ageFromDob(fp.dob,Date.now());
  var heightDisp=fp.heightCm==null?null:(fp.units.height==='cm'?fp.heightCm+' cm':(function(){var fi=VShapeCore.cmToFeetInches(fp.heightCm);return fi.ft+"' "+fi.inch+'"'})());
  var rows=[
    ['Age',age!=null?age+' years':null],
    ['Height',heightDisp],
    ['Current weight',fmtWeightDisplay(fp.currentWeightKg,fp.units.weight)],
    ['Target weight',fmtWeightDisplay(fp.targetWeightKg,fp.units.weight)],
    ['Experience',fp.experience?labelFor(EXPERIENCE_LEVELS,fp.experience):null],
    ['Primary goal',fp.primaryGoal?labelFor(obGoalsAll(),fp.primaryGoal):null],
    ['Training days/week',wp.daysPerWeek||null],
    ['Preferred split',wp.preferredSplit?labelFor(SPLITS,wp.preferredSplit):null]
  ];
  return obShell('Review',
    rows.map(function(r){return '<div class="listrow"><div class="grow muted small">'+esc(r[0])+'</div><b>'+esc(r[1]!=null?String(r[1]):'Not set')+'</b></div>'}).join('')+
    '<p class="muted small" style="margin-top:14px">You can change any of this anytime from Settings &gt; Fitness profile.</p>'
  );
}
function obHTML(){
  var step=ui.sheet.step;
  if(step===0)return obWelcomeHTML();
  if(step===1)return obAboutHTML();
  if(step===2)return obGenderExpHTML();
  if(step===3)return obGoalsHTML();
  if(step===4)return obActivityHTML();
  if(step===5)return obScheduleHTML();
  if(step===6)return obEquipmentHTML();
  if(step===7)return obFocusHTML();
  return obReviewHTML();
}
function planEditHTML(){
  var s=ui.sheet,plan=VShapeCore.findPlan(S.plans,s.planId);
  if(!plan)return '<div class="sh-h"><h3>Plan</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div><div class="empty">That plan no longer exists.</div>';
  var head='<div class="sh-h"><button class="icon" data-act="planback" aria-label="Back">&#8249;</button><h3>Edit plan</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>'+
    '<label class="fld" for="pl-name">Plan name<input id="pl-name" value="'+esc(plan.name)+'" data-planid="'+esc(plan.id)+'"></label>'+
    '<button class="chip'+(plan.flexible?' on':'')+'" style="margin-top:10px" data-act="planflexibletoggle" aria-pressed="'+!!plan.flexible+'">'+(plan.flexible?'Flexible schedule &#10003;':'Use a flexible schedule instead')+'</button>'+
    '<div class="muted small" style="margin-top:6px">'+(plan.flexible?'No fixed weekdays - pick any workout each time you train.':'Fixed weekdays below. Turn this on if you train on no fixed schedule.')+'</div>';
  var grid='';
  if(!plan.flexible){
    grid='<h4 class="sh4">Weekly schedule</h4>'+WEEK_ORDER.map(function(wd){
      var ids=VShapeCore.scheduleSlot(plan,wd),names=ids.map(function(id){var t=VShapeCore.findTemplate(plan,id);return t?t.name:null}).filter(Boolean);
      var label=names.length?names.join(' / '):'Rest';
      return '<div class="listrow"><button class="grow planname" data-act="weekdaysel" data-wd="'+wd+'"><b>'+WEEKDAY_NAMES[wd]+'</b><div class="muted small">'+esc(label)+'</div></button></div>';
    }).join('');
  }
  var templates=plan.templates.map(function(t){
    return '<div class="listrow"><button class="grow planname" data-act="templatesel" data-id="'+esc(t.id)+'"><b>'+esc(t.name)+'</b><div class="muted small">'+(t.tag?esc(t.tag)+' &middot; ':'')+t.ex.length+' exercise'+(t.ex.length===1?'':'s')+'</div></button>'+
      '<button class="icon sm" data-act="templatedel" data-id="'+esc(t.id)+'" aria-label="Delete '+esc(t.name)+'">&times;</button></div>';
  }).join('');
  return head+grid+'<h4 class="sh4">Workout templates</h4>'+(templates||'<div class="empty">No workout templates yet. Add one below, e.g. "Push A" or "Full Body".</div>')+'<button class="btn ghost full" style="margin-top:8px" data-act="templateadd" data-planid="'+esc(plan.id)+'">+ Add workout template</button>';
}
function planWeekdayHTML(){
  var s=ui.sheet,plan=VShapeCore.findPlan(S.plans,s.planId);
  if(!plan)return '<div class="sh-h"><h3>Weekday</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div><div class="empty">That plan no longer exists.</div>';
  var wd=s.wd,selected=VShapeCore.scheduleSlot(plan,wd);
  var head='<div class="sh-h"><button class="icon" data-act="weekdaybacktoplan" aria-label="Back">&#8249;</button><h3>'+WEEKDAY_NAMES[wd]+'</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>'+
    '<div class="muted small">Pick one or more workouts for '+WEEKDAY_NAMES[wd]+'. Picking none makes it a rest day. Picking more than one means you will be asked which one to do that day.</div>';
  var rows=plan.templates.map(function(t){
    var on=selected.indexOf(t.id)>=0;
    return '<div class="listrow"><button class="grow planname" data-act="weekdaytoggle" data-wd="'+wd+'" data-id="'+esc(t.id)+'" aria-pressed="'+on+'">'+(on?'&#9679;':'&#9675;')+' '+esc(t.name)+'</button></div>';
  }).join('');
  return head+(rows||'<div class="empty">Add a workout template first, from the plan editor.</div>');
}
function planTemplateHTML(){
  var s=ui.sheet,plan=VShapeCore.findPlan(S.plans,s.planId),t=plan&&VShapeCore.findTemplate(plan,s.dayId);
  if(!plan||!t)return '<div class="sh-h"><h3>Workout</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div><div class="empty">That workout template no longer exists.</div>';
  var head='<div class="sh-h"><button class="icon" data-act="templatebacktoplan" aria-label="Back">&#8249;</button><h3>Edit workout</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>';
  var fields='<label class="fld" for="pd-name">Workout name<input id="pd-name" value="'+esc(t.name)+'" placeholder="e.g. Chest &amp; Triceps"></label>'+
    '<label class="fld" for="pd-tag">Short description<input id="pd-tag" value="'+esc(t.tag||'')+'"></label>'+
    '<label class="fld" for="pd-cue">Coaching cue<input id="pd-cue" value="'+esc(t.cue||'')+'"></label>'+
    '<button class="btn full" style="margin-top:14px" data-act="templatesave">Save workout details</button>';
  var exRows=t.ex.map(function(e,i){
    return '<div class="listrow"><div class="grow"><b>'+esc(e.name)+'</b><div class="muted small">'+esc(e.muscle||'')+' &middot; '+e.sets+' x '+e.lo+'&ndash;'+e.hi+(e.timed?'s':'')+' &middot; rest '+e.rest+'s</div></div>'+
      (i>0?'<button class="icon sm" data-act="exmoveup" data-id="'+esc(e.id)+'" aria-label="Move '+esc(e.name)+' up">&uarr;</button>':'')+
      (i<t.ex.length-1?'<button class="icon sm" data-act="exmovedown" data-id="'+esc(e.id)+'" aria-label="Move '+esc(e.name)+' down">&darr;</button>':'')+
      (e.libraryId?'<button class="icon sm" data-act="exalt" data-id="'+esc(e.id)+'" aria-label="Find an alternative to '+esc(e.name)+'">&#8646;</button>':'')+
      '<button class="icon sm" data-act="exedit" data-id="'+esc(e.id)+'" aria-label="Edit '+esc(e.name)+'">&#9998;</button>'+
      '<button class="icon sm" data-act="exremove" data-id="'+esc(e.id)+'" aria-label="Remove '+esc(e.name)+'">&times;</button></div>';
  }).join('');
  return head+fields+'<h4 class="sh4">Exercises</h4>'+(exRows||'<div class="empty">No exercises yet.</div>')+'<button class="btn ghost full" style="margin-top:8px" data-act="exadd">+ Add exercise</button>';
}
function planExHTML(){
  var s=ui.sheet,plan=VShapeCore.findPlan(S.plans,s.planId),day=plan&&VShapeCore.findTemplate(plan,s.dayId);
  if(!plan||!day)return '<div class="sh-h"><h3>Exercise</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div><div class="empty">That workout template no longer exists.</div>';
  var head='<div class="sh-h"><button class="icon" data-act="exbacktoday" aria-label="Back">&#8249;</button><h3>'+(s.exId?'Edit exercise':'Add exercise')+'</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>';
  if(!s.exId&&!s.custom){
    var lib=allKnownExercises(),inThisDay=day.ex.map(function(e){return e.id});
    var opts=Object.keys(lib).filter(function(id){return inThisDay.indexOf(id)<0}).map(function(id){var e=lib[id];
      return '<button class="frow" data-act="explpick" data-id="'+esc(id)+'"><span>'+esc(e.name)+'</span><span class="m">'+esc(e.muscle||'')+' &middot; '+e.sets+' x '+e.lo+'&ndash;'+e.hi+(e.timed?'s':'')+'</span></button>';
    }).join('');
    return head+(opts?'<div style="margin-top:4px">'+opts+'</div>':'<div class="empty">No other exercises to reuse yet.</div>')+'<button class="btn full" style="margin-top:12px" data-act="exnewcustom">Create a new exercise</button>';
  }
  var ex=s.exId?(day.ex.filter(function(e){return e.id===s.exId})[0]||{}):{};
  var flags=s.flags||{};
  return head+
    '<label class="fld" for="ex-name">Exercise name<input id="ex-name" value="'+esc(ex.name||'')+'"></label>'+
    '<label class="fld" for="ex-muscle">Muscle group<input id="ex-muscle" value="'+esc(ex.muscle||'')+'"></label>'+
    '<div class="two"><label class="fld" for="ex-sets">Sets<input id="ex-sets" inputmode="numeric" value="'+esc(ex.sets!=null?ex.sets:3)+'"></label><label class="fld" for="ex-rest">Rest (sec)<input id="ex-rest" inputmode="numeric" value="'+esc(ex.rest!=null?ex.rest:90)+'"></label></div>'+
    '<div class="two"><label class="fld" for="ex-lo">Reps low<input id="ex-lo" inputmode="numeric" value="'+esc(ex.lo!=null?ex.lo:8)+'"></label><label class="fld" for="ex-hi">Reps high<input id="ex-hi" inputmode="numeric" value="'+esc(ex.hi!=null?ex.hi:12)+'"></label></div>'+
    '<div class="two"><label class="fld" for="ex-start">Starting weight (kg)<input id="ex-start" inputmode="decimal" value="'+esc(ex.start!=null?ex.start:0)+'"></label><label class="fld" for="ex-inc">Weight increment (kg)<input id="ex-inc" inputmode="decimal" value="'+esc(ex.inc!=null?ex.inc:2)+'"></label></div>'+
    '<label class="fld" for="ex-cue">Form cue<input id="ex-cue" value="'+esc(ex.cue||'')+'"></label>'+
    '<div class="row" style="margin-top:10px">'+
      '<button class="chip'+(flags.bw?' on':'')+'" data-act="extoggle" data-f="bw" aria-pressed="'+!!flags.bw+'">Bodyweight</button>'+
      '<button class="chip'+(flags.assisted?' on':'')+'" data-act="extoggle" data-f="assisted" aria-pressed="'+!!flags.assisted+'">Assisted</button>'+
      '<button class="chip'+(flags.timed?' on':'')+'" data-act="extoggle" data-f="timed" aria-pressed="'+!!flags.timed+'">Timed (seconds, not reps)</button>'+
    '</div>'+
    (s.exId?'':'<label class="row" style="margin-top:10px;align-items:center;gap:8px"><input id="ex-savelib" type="checkbox"><span class="muted small">Also save this to my exercise library, for reuse and alternatives</span></label>')+
    '<button class="btn full" style="margin-top:14px" data-act="exsave" data-id="'+esc(ex.id||'')+'">Save exercise</button>';
}
function libMuscleLabel(id){var m=VShapeCore.MUSCLE_GROUPS.filter(function(x){return x.id===id})[0];return m?m.label:id}
function genHTML(){
  var g=ui.sheet.gen||{};
  var head='<div class="sh-h"><h3>Generate a workout plan</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>';
  return head+
    '<p class="muted small">Starting from your fitness profile - adjust anything just for this plan.</p>'+
    '<h4 class="sh4">Days per week</h4><div class="chipwrap">'+DAYS_PER_WEEK_OPTIONS.map(function(n){return '<button class="chip'+(g.daysPerWeek===n?' sel':'')+'" data-act="gendays" data-n="'+n+'" aria-pressed="'+(g.daysPerWeek===n)+'">'+n+'</button>'}).join('')+'</div>'+
    '<h4 class="sh4">Split</h4>'+SPLITS.map(function(sp){return obCard(sp,g.preferredSplit===sp.id,'gensplit')}).join('')+
    '<h4 class="sh4">Session length</h4><div class="chipwrap">'+DURATIONS.map(function(n){return '<button class="chip'+(g.sessionDuration===n?' sel':'')+'" data-act="genduration" data-n="'+n+'" aria-pressed="'+(g.sessionDuration===n)+'">'+n+' min</button>'}).join('')+'</div>'+
    '<h4 class="sh4">Equipment</h4><div class="chipwrap">'+EQUIPMENT.map(function(e){return obChip(e,(g.equipment||[]).indexOf(e.id)>=0,'genequip')}).join('')+'</div>'+
    '<button class="btn full" style="margin-top:16px" data-act="gengenerate">Generate plan</button>';
}
function genPreviewHTML(){
  var s=ui.sheet,draft=s.draft;
  if(!draft||!draft.ok)return '<div class="sh-h"><h3>Plan preview</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div><div class="empty">Could not generate a plan.</div>';
  var head='<div class="sh-h"><button class="icon" data-act="genback" aria-label="Back">&#8249;</button><h3>Plan preview</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>';
  var summary='<p class="muted small">'+esc(draft.splitReason)+'</p>';
  var days=draft.days.map(function(d){
    var exRows=d.exercises.map(function(e){
      return '<div class="listrow"><div class="grow"><b>'+esc(e.name)+'</b><div class="muted small">'+esc(e.muscle)+' &middot; '+e.sets+' x '+e.lo+'&ndash;'+e.hi+(e.timed?'s':'')+' &middot; rest '+e.rest+'s'+(e.start!=null?' &middot; start '+fmtKg(e.start)+' kg':'')+'</div></div></div>';
    }).join('')||'<div class="empty">No exercises matched your equipment for this day - add some after saving.</div>';
    return '<h4 class="sh4">'+esc(d.name)+'</h4>'+exRows;
  }).join('');
  return head+summary+days+
    '<div class="two" style="margin-top:16px"><button class="btn ghost" data-act="genregenerate">Regenerate</button><button class="btn ghost" data-act="genedit">Edit before saving</button></div>'+
    '<button class="btn full" style="margin-top:8px" data-act="gensave">Save as new plan</button>';
}
function exAltHTML(){
  var s=ui.sheet,plan=VShapeCore.findPlan(S.plans,s.planId),day=plan&&VShapeCore.findTemplate(plan,s.dayId);
  var ex=day&&day.ex.filter(function(e){return e.id===s.exId})[0];
  var head='<div class="sh-h"><button class="icon" data-act="exbacktoday" aria-label="Back">&#8249;</button><h3>Find an alternative</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>';
  if(!plan||!day||!ex)return head+'<div class="empty">That exercise no longer exists.</div>';
  var wp=S.profile.fitness.workoutPrefs,experience=S.profile.fitness.experience;
  var alts=VShapeCore.findAlternatives(S.library,ex.libraryId,wp,experience);
  var rows=alts.map(function(a){
    return '<div class="listrow"><div class="grow"><b>'+esc(a.entry.name)+'</b><div class="muted small">'+esc(libMuscleLabel(a.entry.primaryMuscle))+' &middot; '+esc(a.reason)+'</div></div><button class="btn ghost sm" data-act="exaltpick" data-id="'+esc(a.entry.id)+'">Use this</button></div>';
  }).join('');
  return head+'<p class="muted small">In place of '+esc(ex.name)+'. Sets, reps and rest stay as they are - only the movement changes.</p>'+(rows||'<div class="empty">No matching alternatives found for your equipment/experience.</div>');
}
function libRows(){
  var q=(ui.sheet.q||'').toLowerCase().trim();
  var all=VShapeCore.allLibraryExercises(S.library).filter(function(e){return !q||e.name.toLowerCase().indexOf(q)>=0});
  return all.map(function(e){
    var fl=VShapeCore.libraryFlags(S.library,e.id);
    return '<div class="listrow"><div class="grow"><b>'+esc(e.name)+'</b><div class="muted small">'+esc(libMuscleLabel(e.primaryMuscle))+(e.custom?' &middot; custom':'')+'</div></div>'+
      '<button class="icon sm" data-act="libfav" data-id="'+esc(e.id)+'" aria-pressed="'+!!fl.favorite+'" aria-label="Favorite '+esc(e.name)+'">'+(fl.favorite?'&#9733;':'&#9734;')+'</button>'+
      '<button class="icon sm" data-act="libavoid" data-id="'+esc(e.id)+'" aria-pressed="'+!!fl.avoid+'" aria-label="Avoid '+esc(e.name)+'">'+(fl.avoid?'&#128683;':'&#8416;')+'</button>'+
      (e.custom?'<button class="icon sm" data-act="libedit" data-id="'+esc(e.id)+'" aria-label="Edit '+esc(e.name)+'">&#9998;</button>':'')+
    '</div>';
  }).join('')||'<div class="empty">No matches</div>';
}
function libraryHTML(){
  var head='<div class="sh-h"><h3>My exercise library</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>';
  return head+'<input id="lib-q" type="search" placeholder="Search exercises" value="'+esc(ui.sheet.q||'')+'">'+'<div id="lib-rows" style="margin-top:8px">'+libRows()+'</div>';
}
function libEditHTML(){
  var ex=VShapeCore.findLibraryExercise(S.library,ui.sheet.exId);
  var head='<div class="sh-h"><button class="icon" data-act="libopen" aria-label="Back">&#8249;</button><h3>Edit custom exercise</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>';
  if(!ex||!ex.custom)return head+'<div class="empty">That custom exercise no longer exists.</div>';
  return head+
    '<label class="fld" for="le-name">Exercise name<input id="le-name" value="'+esc(ex.name||'')+'"></label>'+
    '<h4 class="sh4">Primary muscle</h4><div class="chipwrap">'+VShapeCore.MUSCLE_GROUPS.map(function(m){return '<button class="chip'+(ex.primaryMuscle===m.id?' sel':'')+'" data-act="lemuscle" data-id="'+m.id+'" aria-pressed="'+(ex.primaryMuscle===m.id)+'">'+esc(m.label)+'</button>'}).join('')+'</div>'+
    '<h4 class="sh4">Equipment</h4><div class="chipwrap">'+[{id:'bodyweight',label:'Bodyweight'}].concat(VShapeCore.EQUIPMENT_LIST).map(function(eq){return '<button class="chip'+(ex.equipment===eq.id?' sel':'')+'" data-act="leequip" data-id="'+eq.id+'" aria-pressed="'+(ex.equipment===eq.id)+'">'+esc(eq.label)+'</button>'}).join('')+'</div>'+
    '<div class="two"><label class="fld" for="le-sets">Sets<input id="le-sets" inputmode="numeric" value="'+esc(ex.defaultSets!=null?ex.defaultSets:3)+'"></label><label class="fld" for="le-rest">Rest (sec)<input id="le-rest" inputmode="numeric" value="'+esc(ex.defaultRest!=null?ex.defaultRest:90)+'"></label></div>'+
    '<div class="two"><label class="fld" for="le-lo">Reps low<input id="le-lo" inputmode="numeric" value="'+esc(ex.defaultLo!=null?ex.defaultLo:8)+'"></label><label class="fld" for="le-hi">Reps high<input id="le-hi" inputmode="numeric" value="'+esc(ex.defaultHi!=null?ex.defaultHi:12)+'"></label></div>'+
    '<label class="fld" for="le-inc">Weight increment (kg)<input id="le-inc" inputmode="decimal" value="'+esc(ex.defaultInc!=null?ex.defaultInc:2)+'"></label>'+
    '<label class="fld" for="le-notes">Notes<input id="le-notes" value="'+esc(ex.notes||'')+'"></label>'+
    '<button class="btn full" style="margin-top:14px" data-act="libeditsave">Save changes</button>'+
    '<button class="btn ghost full" style="margin-top:8px" data-act="libeditdelete">Delete custom exercise</button>';
}
/* ---------- plate calculator (Phase 3D) ---------- */
// Finds the exercise object as it appears in TODAY's actual trained workout (not just any
// template elsewhere) - the same lookup viewTrain() itself uses, so the calculator always
// reasons about the exact exercise currently on screen.
function findTrainExerciseById(exId){
  var P=trainDayView(ui.date,curWd());
  return P&&P.ex.filter(function(e){return e.id===exId})[0]||null;
}
// Best-guess equipment type for an exercise the calculator has never been told about before -
// from its library entry's loadType when it has one (generated/alternative-picked exercises
// always do), else a plain barbell default. Never guessed for bodyweight/assisted exercises -
// the trigger button is hidden for those entirely (see viewTrain).
function inferPlateEquipment(ex){
  var lib=ex.libraryId&&VShapeCore.findLibraryExercise(S.library,ex.libraryId);
  if(lib){
    if(lib.loadType==='dumbbell')return 'dumbbell';
    if(lib.loadType==='kettlebell')return 'kettlebell';
    if(lib.loadType==='machine'||lib.loadType==='cable')return 'stack';
  }
  return 'barbell';
}
function computePlateResult(equipment,targetKg,pc){
  if(equipment==='stack')return VShapeCore.findStackLoading(targetKg,pc.stack);
  if(equipment==='kettlebell')return VShapeCore.nearestFromList(targetKg,pc.kettlebells);
  if(equipment==='dumbbell')return VShapeCore.nearestStepped(targetKg,pc.dumbbellStep,0,200);
  return VShapeCore.findBarbellLoading(targetKg,pc.bar,pc.plates);
}
var PLATE_COLORS={25:'#CC4200',20:'#2E7D32',15:'#1565C0',10:'#F9A825',5:'#616161',2.5:'#9E9E9E',1.25:'#BDBDBD'};
function renderBarbellSVG(perSide){
  var sorted=(perSide||[]).slice().sort(function(a,b){return b.weight-a.weight});
  var list=[];sorted.forEach(function(p){for(var i=0;i<p.n;i++)list.push(p.weight)});
  var W=Math.max(220,140+list.length*36),H=170,midY=78,shaftH=14,shaftLeft=60,shaftRight=W-60;
  var s='<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Barbell loading per side: '+(list.join(', ')||'no plates')+' kg">';
  s+='<rect x="'+shaftLeft+'" y="'+(midY-shaftH/2)+'" width="'+(shaftRight-shaftLeft)+'" height="'+shaftH+'" rx="4" fill="#9A8B80"/>';
  function side(startX,dir){
    var x=startX;
    list.forEach(function(w){
      var h=Math.min(110,34+w*2.4),pw=14+Math.min(10,w/3);
      var rx=dir>0?x:x-pw;
      s+='<rect x="'+rx.toFixed(1)+'" y="'+(midY-h/2).toFixed(1)+'" width="'+pw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="3" fill="'+(PLATE_COLORS[w]||'var(--accent)')+'" stroke="rgba(0,0,0,.18)"/>';
      s+='<text x="'+(rx+pw/2).toFixed(1)+'" y="'+(midY+h/2+14).toFixed(1)+'" text-anchor="middle" class="tx">'+(w%1===0?w:w)+'</text>';
      x+=dir*pw;
    });
  }
  side(shaftLeft,-1);side(shaftRight,1);
  return s+'</svg>';
}
function renderPlateResult(equipment,target,result,pc,ex){
  var unit=pc.unit,disp=function(kg){return unit==='lb'?r1(VShapeCore.kgToLb(kg)):r1(kg)};
  if(equipment==='barbell'){
    var perSideTxt=result.perSide.length?result.perSide.map(function(p){return disp(p.weight)+(p.n>1?' x'+p.n:'')}).join(', '):'bar only';
    return renderBarbellSVG(result.perSide)+
      '<div class="prev">Total: <b>'+disp(result.achievableTotal)+' '+unit+'</b> (bar '+disp(pc.bar.weight)+(pc.bar.collarWeight?' + collars '+disp(pc.bar.collarWeight):'')+')'+
      (Math.abs(result.diffFromTarget)>0.001?' &middot; '+(result.diffFromTarget>0?'+':'')+disp(result.diffFromTarget)+' '+unit+' vs target':' &middot; exact match')+
      '<div class="muted small" style="margin-top:4px">Each side: '+esc(perSideTxt)+'</div></div>';
  }
  if(equipment==='stack'){
    var selTxt=result.selected.length?result.selected.map(function(p){return disp(p.weight)+(p.n>1?' x'+p.n:'')}).join(', '):'base only';
    return '<div class="prev">Total: <b>'+disp(result.achievableTotal)+' '+unit+'</b>'+
      (Math.abs(result.diffFromTarget)>0.001?' &middot; '+(result.diffFromTarget>0?'+':'')+disp(result.diffFromTarget)+' '+unit+' vs target':' &middot; exact match')+
      '<div class="muted small" style="margin-top:4px">Pins/increments: '+esc(selTxt)+'. Uses only your configured machine increments - never an invented resistance value.</div></div>';
  }
  if(equipment==='dumbbell'){
    return '<div class="prev">Per hand: <b>'+disp(result.achievableTotal)+' '+unit+'</b> &middot; combined (pair): <b>'+disp(result.achievableTotal*2)+' '+unit+'</b>'+
      (Math.abs(result.diffFromTarget)>0.001?' &middot; '+(result.diffFromTarget>0?'+':'')+disp(result.diffFromTarget)+' '+unit+' vs target per hand':'')+'</div>';
  }
  if(equipment==='kettlebell'){
    if(result.achievableTotal==null)return '<div class="empty">Add the kettlebell sizes your gym has in Settings &gt; Plate calculator.</div>';
    return '<div class="prev">Nearest kettlebell you have: <b>'+disp(result.achievableTotal)+' '+unit+'</b>'+
      (Math.abs(result.diffFromTarget)>0.001?' &middot; '+(result.diffFromTarget>0?'+':'')+disp(result.diffFromTarget)+' '+unit+' vs target':'')+'</div>';
  }
  return '';
}
function platecalcHTML(){
  var s=ui.sheet,ex=findTrainExerciseById(s.exId);
  var head='<div class="sh-h"><h3>Plate calculator</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>';
  if(!ex)return head+'<div class="empty">That exercise is no longer in today\'s workout.</div>';
  var pc=S.profile.plateCalc,unit=pc.unit,dispTarget=unit==='lb'?r1(VShapeCore.kgToLb(s.target)):r1(s.target);
  var equipChips=[['barbell','Barbell'],['dumbbell','Dumbbell'],['kettlebell','Kettlebell'],['stack','Machine / cable']].map(function(e){
    return '<button class="chip'+(s.equipment===e[0]?' sel':'')+'" data-act="pcequip" data-id="'+e[0]+'" aria-pressed="'+(s.equipment===e[0])+'">'+e[1]+'</button>';
  }).join('');
  var result=computePlateResult(s.equipment,s.target,pc);
  var sug=suggest(ex,ui.date);
  return head+
    '<p class="muted small">For '+esc(ex.name)+'. Suggested: '+fmtKg(sug.w)+' kg'+(sug.w===0&&ex.bw?' (bodyweight)':'')+'.</p>'+
    '<div class="chipwrap">'+equipChips+'</div>'+
    '<label class="fld" for="pc-target">Target weight ('+unit+')</label>'+
    '<div class="row" style="margin-top:4px"><button class="btn ghost sm" data-act="pcstep" data-n="-2.5" aria-label="Decrease target">&minus;</button>'+
    '<input id="pc-target" inputmode="decimal" value="'+dispTarget+'" style="text-align:center;font-size:20px;font-weight:700;flex:1">'+
    '<button class="btn ghost sm" data-act="pcstep" data-n="2.5" aria-label="Increase target">+</button></div>'+
    renderPlateResult(s.equipment,s.target,result,pc,ex)+
    '<div class="two" style="margin-top:14px"><button class="btn ghost" data-act="pcreset">Use suggested weight</button><button class="btn" data-act="pcapply">Apply to this set</button></div>';
}
function platesettingsHTML(){
  var pc=S.profile.plateCalc,unit=pc.unit;
  var head='<div class="sh-h"><button class="icon" data-act="settings" aria-label="Back">&#8249;</button><h3>Plate calculator</h3><button class="icon" data-act="closesheet" aria-label="Close">&times;</button></div>';
  var plateRows=pc.plates.map(function(p,i){return '<div class="listrow"><div class="grow">'+p.weight+' '+unit+' &times; '+p.count+'</div><button class="icon sm" data-act="pcrmplate" data-i="'+i+'" aria-label="Remove">&times;</button></div>'}).join('')||'<div class="empty">No plates added yet.</div>';
  var stackRows=pc.stack.increments.map(function(p,i){return '<div class="listrow"><div class="grow">'+p.weight+' '+unit+' &times; '+p.count+'</div><button class="icon sm" data-act="pcrmstackinc" data-i="'+i+'" aria-label="Remove">&times;</button></div>'}).join('')||'<div class="empty">No increments added yet.</div>';
  var kbTags='<div class="taglist">'+pc.kettlebells.map(function(v,i){return '<span class="tag">'+v+' '+unit+'<button data-act="pcrmkb" data-i="'+i+'" aria-label="Remove '+v+'">&times;</button></span>'}).join('')+'</div>';
  return head+
    '<h4 class="sh4">Unit</h4><div class="chipwrap">'+[['kg','kg'],['lb','lb']].map(function(u){return '<button class="chip'+(unit===u[0]?' sel':'')+'" data-act="pcunit" data-id="'+u[0]+'" aria-pressed="'+(unit===u[0])+'">'+u[1]+'</button>'}).join('')+'</div>'+
    '<h4 class="sh4">Barbell</h4>'+
    '<div class="two"><label class="fld" for="pcs-barweight">Bar weight ('+unit+')<input id="pcs-barweight" inputmode="decimal" value="'+pc.bar.weight+'"></label><label class="fld" for="pcs-collar">Collars total ('+unit+')<input id="pcs-collar" inputmode="decimal" value="'+pc.bar.collarWeight+'"></label></div>'+
    '<button class="btn ghost full" style="margin-top:8px" data-act="pcsavebar">Save bar</button>'+
    '<h4 class="sh4">Plate inventory</h4><p class="muted small" style="margin:0 0 8px">Count is the total number of that plate you own (not per side).</p>'+
    plateRows+
    '<div class="two" style="margin-top:8px"><input id="pcs-plate-w" inputmode="decimal" placeholder="Weight ('+unit+')"><input id="pcs-plate-n" inputmode="numeric" placeholder="Count"></div>'+
    '<button class="btn ghost full" style="margin-top:8px" data-act="pcaddplate">+ Add plate</button>'+
    '<h4 class="sh4">Dumbbells</h4><label class="fld" for="pcs-dstep">Fixed increment between dumbbells ('+unit+')<input id="pcs-dstep" inputmode="decimal" value="'+pc.dumbbellStep+'"></label>'+
    '<button class="btn ghost full" style="margin-top:8px" data-act="pcsavedstep">Save increment</button>'+
    '<h4 class="sh4">Kettlebells</h4><p class="muted small" style="margin:0 0 8px">The actual sizes your gym stocks - sizes are irregular, so nothing is assumed.</p>'+
    kbTags+'<div class="row" style="margin-top:8px"><input id="pcs-kb" inputmode="decimal" placeholder="Size ('+unit+')"><button class="btn ghost sm" data-act="pcaddkb">Add</button></div>'+
    '<h4 class="sh4">Machine / cable / Smith stack</h4><p class="muted small" style="margin:0 0 8px">Use the machine\'s own labelled values - nothing here is an assumed resistance.</p>'+
    '<label class="fld" for="pcs-stackbase">Base/pin weight ('+unit+')<input id="pcs-stackbase" inputmode="decimal" value="'+pc.stack.baseWeight+'"></label>'+
    '<button class="btn ghost full" style="margin-top:8px" data-act="pcsavestackbase">Save base weight</button>'+
    stackRows+
    '<div class="two" style="margin-top:8px"><input id="pcs-stack-w" inputmode="decimal" placeholder="Increment ('+unit+')"><input id="pcs-stack-n" inputmode="numeric" placeholder="Count"></div>'+
    '<button class="btn ghost full" style="margin-top:8px" data-act="pcaddstackinc">+ Add increment</button>';
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
/* Called on boot AND every time the app becomes visible again (see the
   visibilitychange listener below). The WebView can throttle or fully
   suspend setInterval while backgrounded/minimised without ever clearing
   it, so `tick` can be a dead, stale interval id by the time we come back -
   checking "is tick already set" is not enough to know it is still
   actually firing. Unconditionally clearing and recreating it here (rather
   than the old if(!tick) guard) is what fixes the countdown staying frozen
   after minimising and reopening the app: drawTimer() always recomputes
   the displayed time from the deadline fresh, right now, and a live
   interval is guaranteed to be running afterwards whenever rest is
   actually in progress. */
function resumeTickIfNeeded(){
  var s=getOpenSessionAnywhere();
  clearInterval(tick);tick=null;
  if(s&&s.rest){drawTimer();tick=setInterval(tickFn,500)}
}
function tickFn(){
  var s=getOpenSessionAnywhere(),rest=s&&s.rest;
  if(!rest){clearInterval(tick);tick=null;return}
  var left=VShapeCore.restRemainingMs(s,Date.now()),v=$('#tval');
  if(left<=0&&!rest.done){
    rest.done=true;$('#timer').className='go';
    try{navigator.vibrate&&navigator.vibrate(200)}catch(e){}
    if(S.active)saveDay(S.active.date);
    pushNotificationState(); /* so the notification stops showing a stuck 0:00 countdown right away */
    setTimeout(function(){var s2=getOpenSessionAnywhere();if(s2&&s2.rest&&s2.rest.done){VShapeCore.skipRest(s2);if(S.active)saveDay(S.active.date);drawTimer();pushNotificationState()}},7000);
  }
  if(v)v.textContent=rest.done?'Go':fmtClock(left);
}

/* ---------- actions ---------- */
var A={
  tab:function(t){ui.tab=t.dataset.tab;render();window.scrollTo(0,0)},
  dprev:function(){ui.date=addDays(ui.date,-1);ui.wd=null;ui.trainPicker=false;render()},
  dnext:function(){if(ui.date<todayISO()){ui.date=addDays(ui.date,1);ui.wd=null;ui.trainPicker=false;render()}},
  dtoday:function(){ui.date=todayISO();ui.wd=null;ui.trainPicker=false;render()},
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
  gotod:function(t){ui.date=t.dataset.d;ui.wd=null;ui.trainPicker=false;render()},
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
  /* ---- workout plan builder ---- */
  plannew:function(){
    var p=VShapeCore.createPlan(S.plans,'New plan',Date.now());
    saveLocal();openSheet({type:'plan',planId:p.id});
  },
  planedit:function(t){openSheet({type:'plan',planId:t.dataset.id})},
  plandup:function(t){
    var p=VShapeCore.duplicatePlan(S.plans,t.dataset.id,null,Date.now());
    if(!p){toast('Could not duplicate that plan');return}
    saveLocal();drawSheet();toast('Duplicated as "'+p.name+'"');
  },
  plandel:function(t){
    var r=VShapeCore.deletePlan(S.plans,t.dataset.id,S.activePlanId);
    if(!r.ok){toast('You need at least one plan');return}
    if(r.newActivePlanId)S.activePlanId=r.newActivePlanId;
    saveLocal();drawSheet();render();toast('Plan deleted');
  },
  planactivate:function(t){
    S.activePlanId=t.dataset.id;ui.wd=null;saveLocal();drawSheet();render();toast('Active plan set');
  },
  planback:function(){openSheet({type:'settings'})},
  planflexibletoggle:function(){
    var plan=VShapeCore.findPlan(S.plans,ui.sheet.planId);if(!plan)return;
    plan.flexible=!plan.flexible;saveLocal();drawSheet();render();
  },
  templateadd:function(t){
    var plan=VShapeCore.findPlan(S.plans,t.dataset.planid);if(!plan)return;
    var tpl=VShapeCore.newTemplate('New workout',Date.now());
    VShapeCore.addTemplateToPlan(plan,tpl);saveLocal();
    openSheet({type:'plantemplate',planId:plan.id,dayId:tpl.id});
  },
  templatesel:function(t){openSheet({type:'plantemplate',planId:ui.sheet.planId,dayId:t.dataset.id})},
  templatedel:function(t){
    var plan=VShapeCore.findPlan(S.plans,ui.sheet.planId);if(!plan)return;
    VShapeCore.removeTemplateFromPlan(plan,t.dataset.id);saveLocal();drawSheet();render();toast('Workout template deleted');
  },
  templatebacktoplan:function(){openSheet({type:'plan',planId:ui.sheet.planId})},
  templatesave:function(){
    var plan=VShapeCore.findPlan(S.plans,ui.sheet.planId),t=plan&&VShapeCore.findTemplate(plan,ui.sheet.dayId);
    if(!t)return;
    var name=$('#pd-name').value.trim();
    if(!name){toast('Give the workout a name');return}
    t.name=name;t.tag=$('#pd-tag').value.trim();t.cue=$('#pd-cue').value.trim();
    saveLocal();drawSheet();render();toast('Workout saved');
  },
  weekdaysel:function(t){openSheet({type:'planweekday',planId:ui.sheet.planId,wd:Number(t.dataset.wd)})},
  weekdaybacktoplan:function(){openSheet({type:'plan',planId:ui.sheet.planId})},
  weekdaytoggle:function(t){
    var plan=VShapeCore.findPlan(S.plans,ui.sheet.planId);if(!plan)return;
    var wd=Number(t.dataset.wd),id=t.dataset.id,cur=VShapeCore.scheduleSlot(plan,wd),idx=cur.indexOf(id);
    var next=idx>=0?cur.filter(function(x){return x!==id}):cur.concat([id]);
    VShapeCore.setWeekdayTemplates(plan,wd,next);
    saveLocal();drawSheet();render();
  },
  exadd:function(){ui.sheet=Object.assign(ui.sheet,{type:'planex',exId:null,custom:false,flags:{}});drawSheet()},
  exedit:function(t){
    var plan=VShapeCore.findPlan(S.plans,ui.sheet.planId),day=plan&&VShapeCore.findTemplate(plan,ui.sheet.dayId);
    var ex=day&&day.ex.filter(function(e){return e.id===t.dataset.id})[0];if(!ex)return;
    ui.sheet=Object.assign(ui.sheet,{type:'planex',exId:ex.id,custom:true,flags:{bw:!!ex.bw,assisted:!!ex.assisted,timed:!!ex.timed}});
    drawSheet();
  },
  exmoveup:function(t){var plan=VShapeCore.findPlan(S.plans,ui.sheet.planId),day=plan&&VShapeCore.findTemplate(plan,ui.sheet.dayId);if(day&&VShapeCore.moveExerciseInTemplate(day,t.dataset.id,-1)){saveLocal();drawSheet()}},
  exmovedown:function(t){var plan=VShapeCore.findPlan(S.plans,ui.sheet.planId),day=plan&&VShapeCore.findTemplate(plan,ui.sheet.dayId);if(day&&VShapeCore.moveExerciseInTemplate(day,t.dataset.id,1)){saveLocal();drawSheet()}},
  exremove:function(t){
    var plan=VShapeCore.findPlan(S.plans,ui.sheet.planId),day=plan&&VShapeCore.findTemplate(plan,ui.sheet.dayId);
    if(day&&VShapeCore.removeExerciseFromTemplate(day,t.dataset.id)){saveLocal();drawSheet()}
  },
  exbacktoday:function(){openSheet({type:'plantemplate',planId:ui.sheet.planId,dayId:ui.sheet.dayId})},
  exnewcustom:function(){ui.sheet.custom=true;ui.sheet.flags={};drawSheet()},
  explpick:function(t){
    var plan=VShapeCore.findPlan(S.plans,ui.sheet.planId),day=plan&&VShapeCore.findTemplate(plan,ui.sheet.dayId);
    var lib=allKnownExercises(),src=lib[t.dataset.id];if(!day||!src)return;
    VShapeCore.addExerciseToTemplate(day,Object.assign({},src));
    saveLocal();openSheet({type:'plantemplate',planId:plan.id,dayId:day.id});toast('Added '+src.name);
  },
  extoggle:function(t){ui.sheet.flags=ui.sheet.flags||{};var f=t.dataset.f;ui.sheet.flags[f]=!ui.sheet.flags[f];drawSheet()},
  exsave:function(t){
    var plan=VShapeCore.findPlan(S.plans,ui.sheet.planId),day=plan&&VShapeCore.findTemplate(plan,ui.sheet.dayId);
    if(!day)return;
    var name=$('#ex-name').value.trim(),sets=parseInt($('#ex-sets').value,10),lo=parseInt($('#ex-lo').value,10),hi=parseInt($('#ex-hi').value,10),rest=parseInt($('#ex-rest').value,10);
    var start=parseFloat($('#ex-start').value),inc=parseFloat($('#ex-inc').value),muscle=$('#ex-muscle').value.trim(),cue=$('#ex-cue').value.trim();
    if(!name||!(sets>0)||!(lo>0)||!(hi>=lo)||!(rest>=0)){toast('Check the exercise fields');return}
    var flags=ui.sheet.flags||{};
    var exId=t.dataset.id||(uid()+'-ex');
    var def={id:exId,name:name,sets:sets,lo:lo,hi:hi,rest:rest,inc:isNaN(inc)?0:inc,start:isNaN(start)?0:start,muscle:muscle,cue:cue,bw:!!flags.bw,assisted:!!flags.assisted,timed:!!flags.timed};
    if(t.dataset.id){VShapeCore.substituteExerciseInTemplate(day,t.dataset.id,def)}
    else{VShapeCore.addExerciseToTemplate(day,def)}
    var savelibEl=$('#ex-savelib');
    if(savelibEl&&savelibEl.checked){
      var matchedMuscle=VShapeCore.MUSCLE_GROUPS.filter(function(m){return m.label.toLowerCase()===muscle.toLowerCase()})[0];
      VShapeCore.addCustomExercise(S.library,{name:name,primaryMuscle:matchedMuscle?matchedMuscle.id:null,secondaryMuscles:[],movementPattern:null,equipment:flags.bw?'bodyweight':null,difficulty:null,defaultSets:sets,defaultLo:lo,defaultHi:hi,defaultRest:rest,defaultInc:isNaN(inc)?0:inc,loadType:flags.bw?'bodyweight':null,unilateral:false,timed:!!flags.timed,assistedCapable:!!flags.assisted,notes:cue},Date.now());
      toast('Exercise saved to your library');
    }
    saveLocal();openSheet({type:'plantemplate',planId:plan.id,dayId:day.id});toast('Exercise saved');
  },
  /* ---- workout generator (Phase 3B) ---- */
  genstart:function(){
    var wp=S.profile.fitness.workoutPrefs;
    openSheet({type:'gen',gen:{
      daysPerWeek:wp.daysPerWeek||3,preferredSplit:wp.preferredSplit||null,
      sessionDuration:wp.sessionDuration||45,equipment:(wp.equipment||[]).slice()
    }});
  },
  gendays:function(t){ui.sheet.gen.daysPerWeek=Number(t.dataset.n);drawSheet()},
  gensplit:function(t){var id=t.dataset.id;ui.sheet.gen.preferredSplit=(ui.sheet.gen.preferredSplit===id?null:id);drawSheet()},
  genduration:function(t){ui.sheet.gen.sessionDuration=Number(t.dataset.n);drawSheet()},
  genequip:function(t){ui.sheet.gen.equipment=toggleInArray((ui.sheet.gen.equipment||[]).slice(),t.dataset.id);drawSheet()},
  gengenerate:function(){
    var g=ui.sheet.gen,baseWp=S.profile.fitness.workoutPrefs;
    var fp=Object.assign({},S.profile.fitness,{workoutPrefs:Object.assign({},baseWp,{
      daysPerWeek:g.daysPerWeek,preferredSplit:g.preferredSplit,sessionDuration:g.sessionDuration,equipment:g.equipment
    })});
    var draft=VShapeCore.generateWorkoutPlan(fp,S.library,allSessionsFlat(),Date.now());
    if(!draft.ok){toast(draft.message||'Could not generate a plan - try a different split');return}
    ui.sheet={type:'genpreview',gen:g,draft:draft};
    drawSheet();
  },
  genregenerate:function(){A.gengenerate()},
  genback:function(){ui.sheet=Object.assign(ui.sheet,{type:'gen'});drawSheet()},
  gensave:function(){
    var p=materializeDraftPlan(ui.sheet.draft,'Generated plan');
    closeSheet();render();toast('Saved as "'+p.name+'". It is not active yet - activate it from Settings when ready.');
  },
  genedit:function(){
    var p=materializeDraftPlan(ui.sheet.draft,'Generated plan');
    openSheet({type:'plan',planId:p.id});toast('Saved - edit anything below');
  },
  /* ---- exercise alternatives & library (Phase 3C) ---- */
  exalt:function(t){openSheet({type:'exalt',planId:ui.sheet.planId,dayId:ui.sheet.dayId,exId:t.dataset.id})},
  exaltpick:function(t){
    var plan=VShapeCore.findPlan(S.plans,ui.sheet.planId),day=plan&&VShapeCore.findTemplate(plan,ui.sheet.dayId);
    var old=day&&day.ex.filter(function(e){return e.id===ui.sheet.exId})[0];
    var entry=VShapeCore.findLibraryExercise(S.library,t.dataset.id);
    if(!day||!old||!entry)return;
    var def=Object.assign({},old,{name:entry.name,muscle:libMuscleLabel(entry.primaryMuscle),libraryId:entry.id,bw:entry.loadType==='bodyweight',timed:!!entry.timed});
    VShapeCore.substituteExerciseInTemplate(day,old.id,def);
    saveLocal();openSheet({type:'plantemplate',planId:plan.id,dayId:day.id});toast('Switched to '+entry.name);
  },
  libopen:function(){openSheet({type:'library',q:''})},
  libfav:function(t){var id=t.dataset.id,fl=VShapeCore.libraryFlags(S.library,id);VShapeCore.setLibraryFlag(S.library,id,'favorite',!fl.favorite);saveLocal();drawSheet()},
  libavoid:function(t){var id=t.dataset.id,fl=VShapeCore.libraryFlags(S.library,id);VShapeCore.setLibraryFlag(S.library,id,'avoid',!fl.avoid);saveLocal();drawSheet()},
  libedit:function(t){openSheet({type:'libedit',exId:t.dataset.id})},
  lemuscle:function(t){
    var ex=VShapeCore.findLibraryExercise(S.library,ui.sheet.exId);if(!ex||!ex.custom)return;
    VShapeCore.updateCustomExercise(S.library,ex.id,{primaryMuscle:t.dataset.id});saveLocal();drawSheet();
  },
  leequip:function(t){
    var ex=VShapeCore.findLibraryExercise(S.library,ui.sheet.exId);if(!ex||!ex.custom)return;
    var id=t.dataset.id;
    VShapeCore.updateCustomExercise(S.library,ex.id,{equipment:id,loadType:id==='bodyweight'?'bodyweight':ex.loadType});saveLocal();drawSheet();
  },
  libeditsave:function(t){
    var ex=VShapeCore.findLibraryExercise(S.library,ui.sheet.exId);if(!ex||!ex.custom)return;
    var name=$('#le-name').value.trim(),sets=parseInt($('#le-sets').value,10),lo=parseInt($('#le-lo').value,10),hi=parseInt($('#le-hi').value,10),rest=parseInt($('#le-rest').value,10),inc=parseFloat($('#le-inc').value),notes=$('#le-notes').value.trim();
    if(!name||!(sets>0)||!(lo>0)||!(hi>=lo)||!(rest>=0)){toast('Check the exercise fields');return}
    VShapeCore.updateCustomExercise(S.library,ex.id,{name:name,defaultSets:sets,defaultLo:lo,defaultHi:hi,defaultRest:rest,defaultInc:isNaN(inc)?0:inc,notes:notes});
    saveLocal();openSheet({type:'library',q:ui.sheet.q||''});toast('Exercise updated');
  },
  libeditdelete:function(){
    var ex=VShapeCore.findLibraryExercise(S.library,ui.sheet.exId);if(!ex||!ex.custom)return;
    VShapeCore.removeCustomExercise(S.library,ex.id);saveLocal();openSheet({type:'library',q:''});toast('Custom exercise deleted');
  },
  /* ---- plate calculator (Phase 3D) ---- */
  platecalc:function(t){
    var exId=t.dataset.ex,ex=findTrainExerciseById(exId);if(!ex)return;
    var pc=S.profile.plateCalc,equipment=pc.exerciseEquipment[exId]||inferPlateEquipment(ex);
    var sg=suggest(ex,ui.date);
    openSheet({type:'platecalc',exId:exId,equipment:equipment,target:sg.w>0?sg.w:pc.bar.weight});
  },
  pcequip:function(t){
    ui.sheet.equipment=t.dataset.id;
    S.profile.plateCalc.exerciseEquipment[ui.sheet.exId]=t.dataset.id;saveLocal();drawSheet();
  },
  pcstep:function(t){
    var n=Number(t.dataset.n),unit=S.profile.plateCalc.unit;
    var deltaKg=unit==='lb'?VShapeCore.lbToKg(n):n;
    ui.sheet.target=Math.max(0,r1(ui.sheet.target+deltaKg));drawSheet();
  },
  pcreset:function(){
    var ex=findTrainExerciseById(ui.sheet.exId);if(!ex)return;
    ui.sheet.target=suggest(ex,ui.date).w||S.profile.plateCalc.bar.weight;drawSheet();
  },
  pcapply:function(){
    var s=ui.sheet,ex=findTrainExerciseById(s.exId);if(!ex)return;
    var pc=S.profile.plateCalc,result=computePlateResult(s.equipment,s.target,pc);
    var achievable=result.achievableTotal;
    if(achievable==null){toast('Add a size in Settings first');return}
    var log=(displaySessionFor(ui.date,curWd())||{}).log||{},logged=log[ex.id]||[];
    var idx=-1;for(var i=0;i<ex.sets;i++){if(!logged[i]){idx=i;break}}
    if(idx<0){toast('Every set for this exercise is already logged');return}
    var k=ui.date+'|'+ex.id+'|'+idx;
    ui.drafts[k]=Object.assign({},ui.drafts[k],{w:fmtKg(achievable)});
    closeSheet();render();toast('Applied '+fmtKg(achievable)+' kg to set '+(idx+1));
  },
  platesettingsopen:function(){openSheet({type:'platesettings'})},
  pcunit:function(t){S.profile.plateCalc.unit=t.dataset.id;saveLocal();drawSheet()},
  pcsavebar:function(){
    var w=parseFloat($('#pcs-barweight').value),c=parseFloat($('#pcs-collar').value);
    if(!(w>=0)){toast('Enter a valid bar weight');return}
    S.profile.plateCalc.bar={weight:w,collarWeight:isNaN(c)?0:c};saveLocal();drawSheet();
  },
  pcaddplate:function(){
    var w=parseFloat($('#pcs-plate-w').value),n=parseInt($('#pcs-plate-n').value,10);
    if(!(w>0)||!(n>0)){toast('Enter a plate weight and count');return}
    S.profile.plateCalc.plates.push({weight:w,count:n});saveLocal();drawSheet();
  },
  pcrmplate:function(t){S.profile.plateCalc.plates.splice(Number(t.dataset.i),1);saveLocal();drawSheet()},
  pcsavedstep:function(){
    var v=parseFloat($('#pcs-dstep').value);if(!(v>0)){toast('Enter a valid increment');return}
    S.profile.plateCalc.dumbbellStep=v;saveLocal();drawSheet();
  },
  pcaddkb:function(){
    var v=parseFloat($('#pcs-kb').value);if(!(v>0)){toast('Enter a kettlebell size');return}
    S.profile.plateCalc.kettlebells=S.profile.plateCalc.kettlebells.concat([v]).sort(function(a,b){return a-b});
    saveLocal();drawSheet();
  },
  pcrmkb:function(t){S.profile.plateCalc.kettlebells.splice(Number(t.dataset.i),1);saveLocal();drawSheet()},
  pcsavestackbase:function(){
    var v=parseFloat($('#pcs-stackbase').value);if(isNaN(v)||v<0){toast('Enter a valid base weight');return}
    S.profile.plateCalc.stack.baseWeight=v;saveLocal();drawSheet();
  },
  pcaddstackinc:function(){
    var w=parseFloat($('#pcs-stack-w').value),n=parseInt($('#pcs-stack-n').value,10);
    if(!(w>0)||!(n>0)){toast('Enter an increment weight and count');return}
    S.profile.plateCalc.stack.increments.push({weight:w,count:n});saveLocal();drawSheet();
  },
  pcrmstackinc:function(t){S.profile.plateCalc.stack.increments.splice(Number(t.dataset.i),1);saveLocal();drawSheet()},
  requestworkoutnotif:function(){
    var plugin=wnPlugin();
    if(!plugin){toast('Workout notifications need the Android app');return}
    Promise.resolve(plugin.requestPermission?plugin.requestPermission():{status:'unknown'}).then(function(res){
      S.profile.notifPermission=(res&&res.status)||'unknown';saveProfile();render();drawSheet();
      toast(S.profile.notifPermission==='granted'?'Workout notifications are on':'Notifications are off. The workout still tracks fine in the app.');
    }).catch(function(){toast('Could not reach the notification permission')});
  },
  /* ---- fitness profile onboarding/editor ---- */
  obedit:function(){openSheet({type:'onboard',step:1,editing:true})},
  obstart:function(){var s=ui.sheet;s.step=1;S.profile.fitness.onboardingStep=1;saveProfile();drawSheet()},
  obback:function(){var s=ui.sheet,min=obMinStep();s.step=Math.max(min,s.step-1);S.profile.fitness.onboardingStep=s.step;saveProfile();drawSheet()},
  obnext:function(){
    var s=ui.sheet,fp=S.profile.fitness,u=fp.units;
    if(s.step===1){
      var dobEl=$('#ob-dob'),dobRaw=dobEl?dobEl.value.trim():'';
      if(dobRaw){var dob=VShapeCore.sanitizeDob(dobRaw,Date.now());if(!dob){toast('Enter a valid date of birth');return}fp.dob=dob}
      else fp.dob=null;
      if(u.height==='cm'){
        var hEl=$('#ob-h-cm'),hRaw=hEl?hEl.value.trim():'';
        if(hRaw){var h=VShapeCore.sanitizeHeightCm(hRaw);if(h==null){toast('Enter a valid height');return}fp.heightCm=h}
        else fp.heightCm=null;
      }else{
        var ftEl=$('#ob-h-ft'),inEl=$('#ob-h-in'),ftRaw=ftEl?ftEl.value.trim():'',inRaw=inEl?inEl.value.trim():'';
        if(ftRaw||inRaw){var cm=VShapeCore.feetInchesToCm(parseFloat(ftRaw)||0,parseFloat(inRaw)||0),h2=VShapeCore.sanitizeHeightCm(cm);if(h2==null){toast('Enter a valid height');return}fp.heightCm=h2}
        else fp.heightCm=null;
      }
      var wEl=$('#ob-w'),wRaw=wEl?wEl.value.trim():'';
      if(wRaw){var wn=parseFloat(wRaw.replace(',','.')),wkg=u.weight==='lb'?VShapeCore.lbToKg(wn):wn,wv=VShapeCore.sanitizeBodyWeightKg(wkg);if(wv==null){toast('Enter a valid current weight');return}fp.currentWeightKg=wv}
      else fp.currentWeightKg=null;
      var twEl=$('#ob-tw'),twRaw=twEl?twEl.value.trim():'';
      if(twRaw){var twn=parseFloat(twRaw.replace(',','.')),twkg=u.weight==='lb'?VShapeCore.lbToKg(twn):twn,twv=VShapeCore.sanitizeBodyWeightKg(twkg);if(twv==null){toast('Enter a valid target weight');return}fp.targetWeightKg=twv}
      else fp.targetWeightKg=null;
    }
    if(s.step===7){
      var limEl=$('#ob-limitations');fp.workoutPrefs.limitations=(limEl&&limEl.value.trim())?limEl.value.trim():null;
    }
    s.step=Math.min(OB_TOTAL_STEPS,s.step+1);fp.onboardingStep=s.step;saveProfile();drawSheet();
  },
  obfinish:function(){
    S.profile.fitness.onboarded=true;S.profile.fitness.onboardingStep=0;
    saveProfile();closeSheet();render();toast('Profile saved');
  },
  obunitweight:function(t){S.profile.fitness.units.weight=t.dataset.id;saveProfile();drawSheet()},
  obunitheight:function(t){S.profile.fitness.units.height=t.dataset.id;saveProfile();drawSheet()},
  obgender:function(t){var fp=S.profile.fitness,id=t.dataset.id;fp.gender=fp.gender===id?null:id;saveProfile();drawSheet()},
  obexperience:function(t){var fp=S.profile.fitness,id=t.dataset.id;fp.experience=fp.experience===id?null:id;saveProfile();drawSheet()},
  obgoalprimary:function(t){
    var fp=S.profile.fitness,id=t.dataset.id;
    fp.primaryGoal=fp.primaryGoal===id?null:id;
    fp.secondaryGoals=(fp.secondaryGoals||[]).filter(function(x){return x!==fp.primaryGoal});
    saveProfile();
    $('#ob-goal-primary-list').innerHTML=obGoalPrimaryList();
    $('#ob-goal-secondary-list').innerHTML=obGoalSecondaryList();
  },
  obgoalsecondary:function(t){
    var fp=S.profile.fitness,id=t.dataset.id;
    fp.secondaryGoals=toggleInArray((fp.secondaryGoals||[]).slice(),id);
    saveProfile();
    $('#ob-goal-secondary-list').innerHTML=obGoalSecondaryList();
  },
  obaddgoal:function(){
    var el=$('#ob-goal-custom'),name=el&&el.value.trim();
    if(!name){toast('Enter a goal name');return}
    var fp=S.profile.fitness,id='custom-'+slug(name)+'-'+uid();
    fp.customGoals=(fp.customGoals||[]).concat([{id:id,label:name}]);
    el.value='';saveProfile();
    $('#ob-goal-primary-list').innerHTML=obGoalPrimaryList();
    $('#ob-goal-secondary-list').innerHTML=obGoalSecondaryList();
  },
  obactivity:function(t){var fp=S.profile.fitness,id=t.dataset.id;fp.activityLevel=fp.activityLevel===id?null:id;saveProfile();drawSheet()},
  obfreq:function(t){var fp=S.profile.fitness,n=Number(t.dataset.n);fp.currentTrainingFrequency=fp.currentTrainingFrequency===n?null:n;saveProfile();drawSheet()},
  obdays:function(t){var wp=S.profile.fitness.workoutPrefs,n=Number(t.dataset.n);wp.daysPerWeek=wp.daysPerWeek===n?null:n;saveProfile();drawSheet()},
  obschedtype:function(t){
    var wp=S.profile.fitness.workoutPrefs,v=t.dataset.v;
    wp.scheduleType=wp.scheduleType===v?null:v;
    if(wp.scheduleType!=='fixed')wp.availableDays=[];
    saveProfile();drawSheet();
  },
  obweekday:function(t){var wp=S.profile.fitness.workoutPrefs,wd=Number(t.dataset.wd);wp.availableDays=toggleInArray((wp.availableDays||[]).slice(),wd);saveProfile();drawSheet()},
  obduration:function(t){var wp=S.profile.fitness.workoutPrefs,n=Number(t.dataset.n);wp.sessionDuration=wp.sessionDuration===n?null:n;saveProfile();drawSheet()},
  obaccess:function(t){var wp=S.profile.fitness.workoutPrefs,v=t.dataset.v;wp.equipmentAccess=wp.equipmentAccess===v?null:v;saveProfile();drawSheet()},
  obequip:function(t){
    var wp=S.profile.fitness.workoutPrefs,id=t.dataset.id;
    wp.equipment=toggleInArray((wp.equipment||[]).slice(),id);
    saveProfile();$('#ob-equip-list').innerHTML=obEquipList();
  },
  obaddequip:function(){
    var el=$('#ob-equip-custom'),name=el&&el.value.trim();
    if(!name){toast('Enter an equipment name');return}
    var wp=S.profile.fitness.workoutPrefs,id='custom-'+slug(name)+'-'+uid();
    wp.customEquipment=(wp.customEquipment||[]).concat([{id:id,label:name}]);
    wp.equipment=toggleInArray((wp.equipment||[]).slice(),id);
    el.value='';saveProfile();$('#ob-equip-list').innerHTML=obEquipList();
  },
  obsplit:function(t){var wp=S.profile.fitness.workoutPrefs,id=t.dataset.id;wp.preferredSplit=wp.preferredSplit===id?null:id;saveProfile();drawSheet()},
  obmuscle:function(t){
    var wp=S.profile.fitness.workoutPrefs,id=t.dataset.id;
    wp.priorityMuscles=toggleInArray((wp.priorityMuscles||[]).slice(),id);
    saveProfile();$('#ob-muscle-list').innerHTML=obMuscleList();
  },
  obaddtag:function(t){
    var kind=t.dataset.kind,el=$('#ob-tag-'+kind),name=el&&el.value.trim();
    if(!name){toast('Enter an exercise name');return}
    var wp=S.profile.fitness.workoutPrefs,key=kind==='pref'?'preferredExercises':'avoidExercises';
    if(wp[key].indexOf(name)<0)wp[key]=wp[key].concat([name]);
    el.value='';saveProfile();drawSheet();
  },
  obremovetag:function(t){
    var kind=t.dataset.kind,i=Number(t.dataset.i),wp=S.profile.fitness.workoutPrefs,key=kind==='pref'?'preferredExercises':'avoidExercises';
    wp[key]=wp[key].filter(function(_,idx){return idx!==i});
    saveProfile();drawSheet();
  },
  closesheet:function(){closeSheet()},
  scrim:function(t,e){if(e.target===t&&!(ui.sheet&&ui.sheet.type==='onboard'))closeSheet()},
  wd:function(t){ui.wd=t.dataset.k;render()},
  startworkout:function(){
    var key=curWd();
    if(key==='rest'||key==='choose'){toast('Pick a workout first');return}
    var r=startOrGetSession(ui.date,key);
    if(r.blocked){toast('Finish or pause your current workout first');return}
    saveDay(ui.date);render();
  },
  /* Date-specific rest/skip/train-anyway overrides (see core.js's applyDayOverride): never a
     session, never a PR, never a change to the recurring weekly schedule - just how this one
     calendar date resolves. All undoable via undooverride. */
  resttoday:function(){
    var d=ensureDay(ui.date);d.override={type:'rest',reason:'rest'};
    ui.wd=null;ui.trainPicker=false;saveDay(ui.date);render();toast('Marked as rest today');
  },
  skipworkout:function(){
    var d=ensureDay(ui.date);d.override={type:'rest',reason:'skip'};
    ui.wd=null;ui.trainPicker=false;saveDay(ui.date);render();toast('Workout skipped for today');
  },
  skiprestopen:function(){ui.trainPicker=true;render()},
  skiprestclose:function(){ui.trainPicker=false;render()},
  traininstead:function(t){
    var d=ensureDay(ui.date);d.override={type:'train',templateId:t.dataset.k};
    ui.wd=null;ui.trainPicker=false;saveDay(ui.date);render();
  },
  undooverride:function(){
    var d=ensureDay(ui.date);d.override=null;
    ui.wd=null;ui.trainPicker=false;saveDay(ui.date);render();toast('Undone');
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
    if(S.active)saveDay(S.active.date);drawTimer();pushNotificationState();
  },
  logset:function(t){
    var row=t.closest('.set'),exId=row.dataset.ex,i=Number(row.dataset.i);
    var key=curWd();
    if(key==='rest'||key==='choose'){toast('Pick a workout first');return}
    var r=startOrGetSession(ui.date,key);
    if(r.blocked){toast('Finish or pause your current workout first');return}
    var session=r.session,ex=(session.exSnapshot||[]).filter(function(e){return e.id===exId})[0];
    if(!ex){toast('That exercise is no longer in this workout');return}
    var arr=session.log[exId]||[];
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
    drawTimer();pushNotificationState();
  },
  backuplater:function(){S.profile.backupSnoozedUntil=Date.now()+3*86400000;saveProfile();render()},
  exportdata:function(){
    // Stamped BEFORE the file is built so the file carries its own timestamp: restoring it
    // later then reports a truthful "last backup" instead of the previous one.
    S.profile.lastBackupAt=Date.now();S.profile.backupSnoozedUntil=null;
    var out={app:'vshape-tracker',v:3,schema:VShapeCore.SCHEMA_VERSION,exportedAt:new Date().toISOString(),profile:S.profile,days:S.days,photos:S.photos,plans:S.plans,activePlanId:S.activePlanId,library:S.library};
    var blob=new Blob([JSON.stringify(out)],{type:'application/json'}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download='vshape-backup-'+todayISO()+'.json';
    document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
    toast('Backup saved to your downloads');
    saveProfile();render();if(ui.sheet&&ui.sheet.type==='settings')drawSheet();
  },
  importdata:function(){$('#backupIn').click()},
  doimport:function(){
    var p=ui.sheet&&ui.sheet.pending;if(!p)return;
    var newPhotos=p.photos||{};
    // Decide whether the backup is usable BEFORE touching IndexedDB: this used to replace the
    // stored photos first and only then discover the backup was from a newer schema, leaving
    // photos swapped while the toast claimed nothing was restored.
    var out=VShapeCore.migrateBlob({schema:p.schema,profile:p.profile,days:p.days,plans:p.plans,activePlanId:p.activePlanId,library:p.library});
    if(out.locked){toast('That backup is from a newer app version and cannot be restored here.');return}
    // Validated BEFORE touching S: an invalid/unsupported nutrition blob must abort the
    // whole restore with the existing data untouched, never fall back to empty defaults.
    var restoredNutrition;
    try{restoredNutrition=VShapeNutrition.migrate((out.profile&&out.profile.nutritionAdvanced)||null)}
    catch(e){toast('That backup\'s nutrition data could not be read; nothing was changed.');return}
    var restoredAppearance=VShapeThemes.normalize(out.profile&&out.profile.appearance);
    // Keep a copy of what is on this device right now, so restoring the wrong file is
    // recoverable from Settings > Recover saved copies.
    try{var cur=localStorage.getItem(LS);if(cur)idbPutSafety(cur)}catch(e){}
    Promise.all(Object.keys(newPhotos).map(function(k){return idbPutP(newPhotos[k])})).then(function(results){
      if(results.some(function(r){return !r.ok})){toast('Could not restore all photos; nothing was changed.');return}
      var oldKeys=Object.keys(S.photos),newKeys=Object.keys(newPhotos);
      var toDelete=oldKeys.filter(function(k){return newKeys.indexOf(k)<0});
      return Promise.all(toDelete.map(idbDelP)).then(function(){
        S.profile=Object.assign(defProfile(),out.profile||{});
        S.profile.targets=Object.assign(defProfile().targets,S.profile.targets||{});
        if(!S.profile.weights)S.profile.weights={};
        if(!S.profile.customFoods)S.profile.customFoods=[];
        S.profile.fitness=VShapeCore.mergeFitnessProfile(S.profile.fitness);
        S.profile.plateCalc=VShapeCore.mergePlateCalc(S.profile.plateCalc);
        S.profile.nutritionAdvanced=restoredNutrition;
        S.profile.appearance=restoredAppearance;
        S.library=VShapeCore.mergeLibrary(out.library);
        S.days=out.days||{};
        var pr=ensurePlans(out.plans,out.activePlanId);
        S.plans=pr.plans;S.activePlanId=pr.activePlanId;
        backfillSessionSnapshots();
        var flat=flatExerciseLookup();
        Object.keys(S.days).forEach(function(d){VShapeCore.quarantineInvalidSets(S.days[d],flat)});
        S.photos=newPhotos;S.active=null;
        if(themeWatcher)themeWatcher.set(S.profile.appearance);
        saveLocal();closeSheet();render();toast('Backup restored');
      });
    }).catch(function(){toast('Restore failed; your existing data was kept.')});
  },
  /* Recovers EVERY safety copy this device has ever kept, from BOTH places one can exist:
     localStorage's own pre-migration backups (written by loadLocal right before any
     schema upgrade touches the live data) and the IndexedDB 'safety' store (idbPutSafety) -
     which, before this fix, was write-only: nothing ever read it back, so a device that lost
     its localStorage copy but still had an IndexedDB one had no way to recover it. */
  recoversafety:function(){
    var found=[];
    try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf(LS+'-pre-migration-backup-')===0)found.push(k)}}catch(e){}
    var lsCopies=found.sort().map(function(k){try{return {source:'localStorage',key:k,raw:JSON.parse(localStorage.getItem(k))}}catch(e){return {source:'localStorage',key:k,raw:null,unreadable:true}}});
    idbRun('safety','readonly',function(s){return s.getAll()}).then(function(list){return list||[]}).catch(function(){return []}).then(function(idbList){
      var idbCopies=idbList.map(function(e){
        var raw=null,unreadable=false;
        try{raw=typeof e.raw==='string'?JSON.parse(e.raw):e.raw}catch(err){unreadable=true}
        return {source:'indexedDB',ts:e.ts,raw:raw,unreadable:unreadable};
      });
      var all=lsCopies.concat(idbCopies);
      if(!all.length){toast('No saved copies were found on this device');return}
      var combined={app:'vshape-tracker-safety-export',exportedAt:new Date().toISOString(),copies:all};
      var blob=new Blob([JSON.stringify(combined)],{type:'application/json'}),a=document.createElement('a');
      a.href=URL.createObjectURL(blob);a.download='vshape-safety-copies-'+todayISO()+'.json';
      document.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
      toast('Downloaded '+all.length+' saved copy(ies)');
    });
  },
  /* A redacted structural report for diagnosing data-loss/sync reports without exporting the
     user's actual food/weight/photo data: counts and ids only (schema state, per-day session
     counts, every logged set's exId/index/w/r so a support thread can see exactly what is and
     is not present), plus whatever the native side still has pending/cached. Never silently
     fixes or clears anything - purely read-only. */
  exportdiagnostics:function(){
    buildDiagnosticReport().then(function(report){
      var blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),a=document.createElement('a');
      a.href=URL.createObjectURL(blob);a.download='vshape-diagnostics-'+todayISO()+'.json';
      document.body.appendChild(a);a.click();
      setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1500);
      toast('Diagnostic report saved to your downloads');
    });
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
  if(t.id==='ob-goal-q'&&ui.sheet){ui.sheet.goalQ=t.value;$('#ob-goal-primary-list').innerHTML=obGoalPrimaryList();$('#ob-goal-secondary-list').innerHTML=obGoalSecondaryList()}
  if(t.id==='ob-equip-q'&&ui.sheet){ui.sheet.equipQ=t.value;$('#ob-equip-list').innerHTML=obEquipList()}
  if(t.id==='ob-muscle-q'&&ui.sheet){ui.sheet.muscleQ=t.value;$('#ob-muscle-list').innerHTML=obMuscleList()}
  if(t.id==='lib-q'&&ui.sheet){ui.sheet.q=t.value;$('#lib-rows').innerHTML=libRows()}
  if(t.id==='pc-target'&&ui.sheet){
    var v=parseFloat(t.value);
    if(!isNaN(v))ui.sheet.target=S.profile.plateCalc.unit==='lb'?VShapeCore.lbToKg(v):v;
  }
});
document.addEventListener('change',function(e){
  if(e.target.id==='exsel'){ui.exSel=e.target.value;render()}
  if(e.target.id==='pc-target'&&ui.sheet)drawSheet();
  if(e.target.id==='pl-name'){
    var plan=VShapeCore.findPlan(S.plans,e.target.dataset.planid),name=e.target.value.trim();
    if(plan&&name){plan.name=name;saveLocal()}
  }
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
  keys.forEach(function(d){var day=ensureDay(d);day.steps=best[d];day.stepsSource='import'});
  saveLocal(); /* one write for the whole file, not one full-state write per day */
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
    var pend=VShapeCore.prepareRestore(pr.data);pend.library=pr.data.library;
    openSheet({type:'import',pending:pend,nd:Object.keys(pend.days||{}).length,np:Object.keys(pend.photos).length,dropped:pend.dropped});
  };
  rd.onerror=function(){toast('Could not read that file')};
  rd.readAsText(f);
});

/* ---------- start ---------- */
loadLocal();
if(!S.locked)themeWatcher=VShapeThemes.watch(document,S.profile.appearance);
if(!S.locked&&!S.profile.fitness.onboarded)openSheet({type:'onboard',step:S.profile.fitness.onboardingStep||0,editing:false});
render();
loadPhotos();
initPwa();
resumeTickIfNeeded();
if(isNative()&&!S.locked)setTimeout(function(){hcSync(7,true);reconcileNativeActions()},800);
document.addEventListener('visibilitychange',function(){
  if(document.hidden||S.locked)return;
  resumeTickIfNeeded(); /* the rest countdown must reflect reality the instant we're back, not stay frozen on whatever was last drawn before we were minimised */
  if(isNative()){
    reconcileNativeActions();
    if(!ui.hcAt||Date.now()-ui.hcAt>10*60000)hcSync(3,true);
  }
  var t=todayISO();
  if(t!==ui.today){if(ui.date===ui.today)ui.date=t;ui.today=t;ui.wd=null;softRender()}
});
})();
