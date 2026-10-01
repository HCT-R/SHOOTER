/* Campaign progression and checkpoint regression, no renderer required.
   Run: node tools/campaigntest.js */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const data = new Map();
const storage = {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
const context = vm.createContext({console, window:{localStorage:storage}});
for (const file of ['00-util.js','05-save.js','30-level.js','89-campaign.js'])
  new vm.Script(fs.readFileSync(path.join(root,'src',file),'utf8'),{filename:file}).runInContext(context);
const api = vm.runInContext('({CAMPAIGN_MISSIONS,CampaignDirector,createCampaignLevel,campaignPath,campaignProgress,store})',context);
let checks=0, completedStages=0;
function check(value,message){checks++;assert(value,message);}
function eq(actual,expected,message){checks++;assert.strictEqual(actual,expected,message);}
function game(missionId, seed=3107){
  let nextId=0;
  return {runSeed:seed,level:api.createCampaignLevel(seed,missionId),money:50,score:0,time:0,sampleYield:0,perks:{},upgrades:{},stats:{kills:0,shots:0,hits:0},state:'play',
    player:{x:0,z:0,vx:0,vz:0,hp:100,maxHp:100,armor:20,maxArmor:100,alive:true,owned:{pistol:true,knife:true},meleeId:'knife',weapon:{id:'pistol'},ammo:{light:90},mags:{pistol:12},damageMultiplier:1.3,burnChains:true},
    enemies:{list:[],spawn(id,x,z){const e={id:++nextId,x,z,hp:100,maxHp:100,state:0,def:{id,label:id,ranged:id==='spitter'}};this.list.push(e);return e;},reset(){this.list=[];}},
    projectiles:{clear(){}},hazards:{events:[],clear(){this.events=[];},spawn(...args){this.events.push(args);}},pickups:{spawn(){}},props:{resolve(){}},hud:{popup(){}},
    bankRun(){this.banked=(this.banked||0)+this.sampleYield;return this.sampleYield;}}
}
function move(g,p){g.player.x=p.x;g.player.z=p.z;}
function killAll(g,d){for(const e of g.enemies.list){if(e.hp<=0)continue;e.hp=0;e.state=99;g.stats.kills++;d.onEnemyKilled(e);}g.enemies.list=[];}
function fresh(id,resume=false){const g=game(id),d=new api.CampaignDirector(g,{missionId:id,resume,headless:true});g.campaign=d;d.begin();return {g,d};}

// Authored topology is deterministic and every objective/escort waypoint is
// reachable on every tested seed. Every path segment fits the NPC collider.
const signatures=new Set();
for(const m of api.CAMPAIGN_MISSIONS){
  check(m.stages.length>=7,'mission needs substantive independent objectives: '+m.id);
  const level=api.createCampaignLevel(3107,m.id);signatures.add(Buffer.from(level.grid).toString('base64'));
  for(const seed of [1,3107,99991]){
    const l=api.createCampaignLevel(seed,m.id);
    eq(Buffer.from(l.grid).toString('hex'),Buffer.from(level.grid).toString('hex'),'seed changed authored collision');
    for(const stage of m.stages){
      const names=[stage.entry,...stage.targets||[],stage.target,...stage.route||[]].filter(Boolean);
      for(const name of names){
        const target=l.campaignPoints[name];check(!!target,'undefined objective '+name);
        check(!l.isWallAt(target.x,target.z),'objective inside wall');
        const points=api.campaignPath(l,l.start,target);check(points.length>0||Math.hypot(l.start.x-target.x,l.start.z-target.z)<1,'unreachable objective '+m.id+':'+name);
        for(const p of points){const resolved={x:p.x,z:p.z};l.resolveCircle(resolved,.45);check(Math.hypot(p.x-resolved.x,p.z-resolved.z)<.001,'NPC path clips collision');}
      }
    }
  }
}
eq(signatures.size,6,'missions reused the same map');

// Wrong-position interactions, uncleared targets and uncompleted bosses do
// not advance. Defence advances only when its actual zone is held.
{
  const {g,d}=fresh(2);d.stageIndex=2;d.beginStage();
  const index=d.stageIndex;
  eq(d.interact(),false,'remote terminal interaction succeeded');
  const target=d.activeTargets()[0];move(g,target);
  g.enemies.spawn('grunt',target.x,target.z);
  eq(d.interact(),false,'contested terminal interaction succeeded');
  killAll(g,d);eq(d.interact(),true);d.update(.1);eq(d.stageIndex,index,'one journal skipped the remaining journals');
  d.stageIndex=5;d.beginStage();d.update(100);eq(d.stageIndex,5,'boss advanced without kill');
  killAll(g,d);d.update(.1);eq(d.phase,'checkpoint');
}
{
  const {g,d}=fresh(1);d.stageIndex=5;d.beginStage();
  move(g,d.point('start'));d.update(1);eq(d.stageClock,0,'defence advanced outside zone');
  move(g,d.point(d.stage.target));const e=g.enemies.spawn('grunt',g.player.x,g.player.z);d.update(1);eq(d.stageClock,0,'contested defence advanced');
  killAll(g,d);d.update(1);eq(d.stageClock,1,'held defence did not progress');
}

// Mission3 NPC can die; retry restores the same escort boundary/loadout.
{
  const {g,d}=fresh(3);d.stageIndex=5;d.placeAtEntry();d.saveCheckpoint();d.beginStage();
  const at={x:d.npc.x,z:d.npc.z};move(g,at);g.enemies.reset();
  for(let i=0;i<4;i++)g.enemies.spawn('grunt',at.x+.5,at.z);
  for(let i=0;i<20&&!d.finished;i++)d.update(1);
  eq(g.state,'campaignFailed','escort death did not fail mission');
  eq(api.campaignProgress().checkpoint.stageIndex,5,'failure overwrote checkpoint');
  const retry=fresh(3,true);eq(retry.d.stageIndex,5);eq(retry.d.npc.hp,140,'NPC health was not reset');
  eq(retry.g.player.damageMultiplier,1.3,'checkpoint lost build multiplier');
  eq(retry.g.player.meleeId,'knife');eq(retry.g.player.ammo.light,90);
  const x=retry.d.npc.x,z=retry.d.npc.z;move(retry.g,{x:x+30,z:z+30});retry.g.enemies.reset();retry.d.update(.1);
  eq(retry.d.npc.x,x,'NPC did not wait for distant player');eq(retry.d.npc.z,z);
}

// Resolve every actual objective via the same public inputs and callbacks
// used by play, including walking the complete escort route with collision.
data.clear();
api.store.set('campaign',{unlocked:1,completed:[],logs:[],checkpoint:null});
for(const m of api.CAMPAIGN_MISSIONS){
  const {g,d}=fresh(m.id,m.id>1);
  let steps=0;
  while(!d.finished && steps++<12000){
    if(d.phase==='checkpoint'){const save=api.campaignProgress().checkpoint;eq(save.stageIndex,d.stageIndex);check(d.interact(),'checkpoint continue');continue;}
    const before=d.stageIndex, stage=d.stage;
    killAll(g,d);
    if(stage.type==='collect'||stage.type==='interact'){
      const target=d.activeTargets()[0];if(target){move(g,target);check(d.interact(),'objective could not be activated');}
    } else if(stage.type==='escort') move(g,d.npc);
    else move(g,d.point(stage.target||stage.entry));
    d.update(stage.type==='escort'?.15:1);
    if(d.stageIndex!==before)completedStages++;
  }
  check(steps<12000,'mission did not terminate '+m.id);
  eq(g.state,'campaignComplete','mission failed '+m.id);check(g.banked>0,'mission failed to bank reward');
  const progress=api.campaignProgress();check(progress.completed.includes(m.id),'completion not persisted');
  check(progress.unlocked>=Math.min(6,m.id+1),'next mission locked');
  if(m.id<6){eq(progress.checkpoint.missionId,m.id+1);eq(progress.checkpoint.stageIndex,0);eq(progress.checkpoint.sampleYield,0,'banked samples could duplicate');}
  else eq(progress.checkpoint,null,'final mission created endless checkpoint');
}
check(api.campaignProgress().logs.includes('archive-a'),'archive logs not persisted');
eq(api.campaignProgress().completed.length,6);
console.log('CAMPAIGN_OK: '+checks+' assertions; 6 authored maps, '+completedStages+' objectives, guarded interactions, contestable defence, escort failure/wait/path, checkpoint retry and final completion');
