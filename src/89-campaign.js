/* Six authored missions. The director owns objectives, stage encounters and
   safe checkpoints; the existing combat simulation owns every alien shot. */
const CAMPAIGN_MISSIONS = Object.freeze([
  { id: 1, key: 'arrival', title: 'ПРИБЫТИЕ', subtitle: 'Док 07 · прибытие', sector: 0, size: 44,
    briefing: 'Станция «Затмение» замолчала. Доберитесь до поста связи и поднимите аварийный маяк.',
    ending: 'Маяк работает. Архив станции ответил: карантин включили изнутри. Найдите записи дежурного.',
    rooms: [[3,29,10,11],[3,15,10,10],[18,15,10,10],[30,15,10,12],[30,3,10,9]], links: [[0,1],[1,2],[2,3],[3,4]],
    points: { start:0, training:1, junction:2, beacon:3, exit:4 },
    stages: [
      { type:'reach', title:'ДОБЕРИТЕСЬ ДО ПОСТА', text:'Двигайтесь к отмеченному посту. Используйте рывок, чтобы разорвать дистанцию.', target:'training', entry:'start', radio:'ЛИНА: Канал нестабилен. Проверьте движение и пройдите к грузовому посту.' },
      { type:'clear', title:'ЗАЧИСТИТЕ ГРУЗОВОЙ ПОСТ', target:'training', entry:'training', count:18, batch:6, types:['crawler','crawler','grunt'], radio:'ЛИНА: Контакты впереди. Огонь — ЛКМ, точное прицеливание — ПКМ. Боеприпасы у поста.' },
      { type:'collect', title:'ВОССТАНОВИТЕ ПИТАНИЕ ДОКА', targets:['junction','exit'], entry:'training', count:14, types:['crawler','grunt'], guarded:true, radio:'ЛИНА: Маяк обесточен. Найдите два распределителя. Терминал блокируется, пока рядом противник.' },
      { type:'clear', title:'ОТБЕЙТЕ ПОСТ СВЯЗИ', target:'beacon', entry:'junction', count:24, batch:8, types:['grunt','crawler','spitter'], radio:'ЛИНА: Питание включено. Рой занимает пост связи — очистите подходы.' },
      { type:'interact', title:'ВКЛЮЧИТЕ АВАРИЙНЫЙ МАЯК', target:'beacon', entry:'training', radio:'ЛИНА: Найдите терминал в восточном доке. Подойдите к нему и взаимодействуйте.' },
      { type:'defend', title:'УДЕРЖИВАЙТЕ МАЯК', target:'beacon', entry:'beacon', seconds:60, count:6, types:['crawler','grunt'], radio:'ЛИНА: Сигнал привёл рой. Оставайтесь у маяка, пока идёт передача. Враг у терминала блокирует отправку.' },
      { type:'clear', title:'РАСЧИСТИТЕ ВЫХОД ИЗ ДОКА', target:'exit', entry:'beacon', count:22, batch:7, types:['grunt','spitter','crawler'], radio:'ЛИНА: Архив ответил. У выхода новая группа — пробейте коридор.' },
      { type:'reach', title:'ПРОЙДИТЕ В АРХИВ', target:'exit', entry:'beacon', radio:'ЛИНА: Есть ответ из архива. Маршрут открыт.' }
    ] },
  { id: 2, key:'archive', title:'СЛЕД ЗАРАЖЕНИЯ', subtitle:'Криоархив · расследование', sector:1, size:48,
    briefing:'Три журнала хранят причину аварии. Восстановите записи и отключите Стража, охраняющего центральное хранилище.',
    ending:'Записи подтверждают: экипаж заперт в медицинском секторе. Инженер Мир ещё жив — без него реактор не остановить.',
    rooms:[[19,35,10,9],[18,20,12,10],[3,20,10,10],[35,20,10,10],[19,4,10,10],[33,3,12,12],[3,3,10,10]],
    links:[[0,1],[1,2],[1,3],[1,4],[4,5],[4,6],[2,6],[3,5]], points:{start:0,hub:1,logA:2,logB:3,logC:4,warden:5,exit:6},
    stages:[
      { type:'clear', title:'ВОЙДИТЕ В КРИОАРХИВ', target:'hub', entry:'start', count:27, batch:9, types:['grunt','spitter','crawler'], radio:'ЛИНА: След ведёт в архив. Рой перекрыл центральный коридор. Найдите путь через укрытия.' },
      { type:'interact', title:'ОТКРОЙТЕ ЗАПЕЧАТАННЫЕ ЯЧЕЙКИ', target:'hub', entry:'hub', radio:'ЛИНА: Центральная консоль откроет три хранилища. Подойдите и сбросьте карантин.' },
      { type:'collect', title:'ВОССТАНОВИТЕ ТРИ ЖУРНАЛА', targets:['logA','logB','logC'], entry:'hub', count:24, types:['grunt','spitter','crawler'], guarded:true, radio:'ЛИНА: Архив разделён на три ячейки. Очистите терминалы и заберите все записи — порядок не важен.', logs:['archive-a','archive-b','archive-c'] },
      { type:'defend', title:'РАСШИФРУЙТЕ ЗАПИСИ В АРХИВЕ', target:'logC', entry:'logC', seconds:70, count:8, types:['spitter','grunt','crawler'], radio:'ЛИНА: Журналы повреждены. Защитите накопитель, пока идёт восстановление. Следите за боковыми входами.' },
      { type:'clear', title:'ПРОБЕЙТЕСЬ В ХРАНИЛИЩЕ СТРАЖА', target:'warden', entry:'logC', count:30, batch:10, types:['grunt','spitter','brute'], radio:'ЛИНА: Охрана получила приказ уничтожить записи. Сначала расчистите машинный зал.' },
      { type:'boss', title:'ОТКЛЮЧИТЕ НЕОНОВОГО СТРАЖА', target:'warden', entry:'hub', boss:'warden', radio:'ЖУРНАЛ: «Экипаж жив. Медблок запечатан. Страж считает нас заражёнными». Придётся пробиться.' },
      { type:'interact', title:'СКОПИРУЙТЕ КОД ДОСТУПА В МЕДБЛОК', target:'warden', entry:'warden', radio:'ЛИНА: В памяти Стража есть ключ. Заберите его перед выходом.' },
      { type:'reach', title:'ОТКРОЙТЕ МАРШРУТ В МЕДБЛОК', target:'exit', entry:'warden', radio:'ЛИНА: Страж отключён. В медицинском секторе зарегистрирован один пульс.' }
    ] },
  { id:3, key:'rescue', title:'ПОСЛЕДНИЙ ВЫЖИВШИЙ', subtitle:'Медблок · спасение', sector:1, size:48,
    briefing:'Найдите инженера Мира. Сопроводите его через служебные коридоры и удержите эвакуационный шлюз.',
    ending:'МИР: Я успел вытащить коды реактора. Пока он питает колонию, станцию не вернуть. Нужно отключить три узла.',
    rooms:[[3,34,10,10],[3,20,10,10],[18,20,10,10],[18,4,12,11],[34,4,10,12],[34,22,10,18]],
    links:[[0,1],[1,2],[2,3],[3,4],[4,5]], points:{start:0,clinic:1,hub:2,turn:3,gate:4,evac:5,exit:5},
    stages:[
      { type:'clear', title:'ЗАЧИСТИТЕ МЕДБЛОК', target:'clinic', entry:'start', count:30, batch:8, types:['grunt','crawler','spitter'], radio:'МИР: Я в кабинете триажа. Они у двери. Сначала очистите коридор.' },
      { type:'interact', title:'НАЙДИТЕ ИНЖЕНЕРА МИРА', target:'clinic', entry:'clinic', npc:true, radio:'МИР: Вы не из службы безопасности? Хорошо. Подойдите — у меня ключи от реактора.' },
      { type:'collect', title:'ОТКРОЙТЕ СЛУЖЕБНЫЙ МАРШРУТ', targets:['hub','turn'], entry:'clinic', count:21, types:['spitter','crawler','grunt'], guarded:true, radio:'МИР: Сначала отключите два замка. Я подожду здесь. На главном маршруте слишком много заражённых.' },
      { type:'defend', title:'ЗАПУСТИТЕ ВЕНТИЛЯЦИЮ КОРИДОРА', target:'turn', entry:'hub', seconds:55, count:7, types:['spitter','grunt'], radio:'МИР: В проходе токсин. Удерживайте распределитель, пока фильтры очищают воздух.' },
      { type:'reach', title:'ВЕРНИТЕСЬ ЗА ИНЖЕНЕРОМ', target:'clinic', entry:'turn', radio:'МИР: Вентиляция работает. Заберите меня, один я через коридор не пройду.' },
      { type:'escort', title:'СОПРОВОДИТЕ ИНЖЕНЕРА', target:'evac', entry:'clinic', route:['clinic','hub','turn','gate','evac'], count:7, types:['crawler','grunt'], radio:'МИР: Идите рядом. Если отстанете слишком далеко, я остановлюсь. Не подпускайте рой.' },
      { type:'defend', title:'ЗАЩИТИТЕ ЭВАКУАЦИОННЫЙ ШЛЮЗ', target:'evac', entry:'evac', seconds:75, count:8, types:['grunt','spitter'], radio:'ЛИНА: Инженер внутри. Прикройте шлюз до прибытия транспорта.' }
    ] },
  { id:4, key:'reactor', title:'ПЕРЕЗАПУСК', subtitle:'Реактор · диверсия', sector:2, size:50,
    briefing:'Три регулятора питают заражённый реактор. Отключайте их между выбросами, затем уничтожьте осадный организм в ядре.',
    ending:'МИР: Основное питание снято, но колония переключилась на резерв. Защитите два маршрута, пока мы выводим людей.',
    rooms:[[20,36,11,10],[17,18,16,14],[19,3,12,10],[3,18,10,12],[37,18,10,12],[37,3,10,10]],
    links:[[0,1],[1,2],[1,3],[1,4],[2,5],[4,5]], points:{start:0,core:1,nodeA:2,nodeB:3,nodeC:4,exit:5},
    stages:[
      { type:'clear', title:'ЗАХВАТИТЕ РЕАКТОРНЫЙ ЗАЛ', target:'core', entry:'start', count:32, batch:10, types:['grunt','spitter','brute'], radio:'МИР: Мои коды откроют реактор, но сначала очистите центральный зал.' },
      { type:'interact', title:'ЗАПУСТИТЕ АВАРИЙНУЮ ДИАГНОСТИКУ', target:'core', entry:'core', radio:'МИР: Введите коды в консоль. Диагностика подсветит три неисправных регулятора.' },
      { type:'collect', title:'ОТКЛЮЧИТЕ ТРИ РЕГУЛЯТОРА', targets:['nodeA','nodeB','nodeC'], entry:'core', count:24, types:['spitter','grunt','brute'], hazards:true, guarded:true, radio:'МИР: Янтарное кольцо предупреждает о выбросе. Переждите импульс и отключите регулятор.' },
      { type:'defend', title:'УДЕРЖИВАЙТЕ КОНТУР ОХЛАЖДЕНИЯ', target:'nodeC', entry:'nodeC', seconds:80, count:9, types:['brute','spitter','grunt'], radio:'МИР: Давление растёт. Защитите контур охлаждения — нельзя дать рою вернуть питание.' },
      { type:'clear', title:'РАЗРУШЬТЕ КОЛОНИЮ В ЯДРЕ', target:'core', entry:'nodeC', count:36, batch:12, types:['brute','grunt','spitter'], radio:'ЛИНА: Главная масса выходит из ядра. Уничтожьте охрану перед перезапуском.' },
      { type:'boss', title:'УНИЧТОЖЬТЕ ОСАДНЫЙ ОРГАНИЗМ', target:'core', entry:'nodeC', boss:'siege', radio:'ЛИНА: Он прорвался из защитного кожуха. Не стойте перед ним во время разгона.' },
      { type:'interact', title:'ПЕРЕЗАПУСТИТЕ РЕАКТОР', target:'core', entry:'core', radio:'МИР: Контур свободен. Запустите перезагрузку вручную. Основное питание колонии отключится.' },
      { type:'reach', title:'ВЫЙДИТЕ ИЗ РЕАКТОРНОГО БЛОКА', target:'exit', entry:'core', radio:'МИР: Давление стабилизировалось. Уходите через северо-восточный технический выход.' }
    ] },
  { id:5, key:'holdout', title:'ПРОРЫВ', subtitle:'Транспортный узел · оборона', sector:0, size:48,
    briefing:'Эвакуация идёт по двум маршрутам. Сначала удержите западный шлюз, затем смените позицию и прикройте восточный.',
    ending:'ЛИНА: Последний транспорт ушёл. Источник сигнала обнаружен под станцией. Остался только мозг колонии.',
    rooms:[[18,34,12,10],[18,20,12,10],[3,4,13,13],[3,20,13,10],[32,4,13,13],[32,20,13,10],[19,4,10,11]],
    links:[[0,1],[1,3],[3,2],[1,5],[5,4],[2,6],[4,6]], points:{start:0,hub:1,west:2,westRoute:3,east:4,eastRoute:5,exit:6},
    stages:[
      { type:'clear', title:'РАЗБЛОКИРУЙТЕ ТРАНСПОРТНЫЙ УЗЕЛ', target:'hub', entry:'start', count:36, batch:10, types:['brute','grunt','spitter'], radio:'ЛИНА: Два конвоя ждут открытия маршрутов. Расчистите транспортный узел.' },
      { type:'collect', title:'СОБЕРИТЕ КЛЮЧИ МАРШРУТИЗАТОРОВ', targets:['westRoute','eastRoute'], entry:'hub', count:24, types:['grunt','spitter'], guarded:true, radio:'МИР: Переключатели в двух служебных коридорах. Без обоих ключей конвои останутся на станции.' },
      { type:'defend', title:'УДЕРЖИВАЙТЕ ЗАПАДНЫЙ МАРШРУТ', target:'west', entry:'hub', seconds:100, count:9, types:['grunt','spitter','crawler'], radio:'ЛИНА: Западный конвой выходит первым. Пока противник стоит у шлюза, передача блокируется.' },
      { type:'clear', title:'ПРОБЕЙТЕСЬ К ВОСТОЧНОМУ МАРШРУТУ', target:'eastRoute', entry:'west', count:38, batch:12, types:['brute','spitter','grunt'], radio:'ЛИНА: Запад прошёл. Восточный коридор заблокирован новой группой — смените позицию.' },
      { type:'defend', title:'ЗАЩИТИТЕ ВОСТОЧНЫЙ ШЛЮЗ', target:'east', entry:'eastRoute', seconds:110, count:10, types:['brute','grunt','spitter'], radio:'ЛИНА: Последний конвой начал движение. Прикройте восточный шлюз до выхода людей.' },
      { type:'clear', title:'ЗАЧИСТИТЕ ПОДХОД К ШАХТЕ', target:'exit', entry:'east', count:32, batch:10, types:['brute','spitter','crawler'], radio:'МИР: Источник глубже. Последняя группа защищает спуск в ядро.' },
      { type:'reach', title:'ДОБЕРИТЕСЬ ДО ШАХТЫ', target:'exit', entry:'east', radio:'МИР: Люди в безопасности. Вход к источнику между двумя шлюзами.' }
    ] },
  { id:6, key:'overmind', title:'СЕРДЦЕ СТАНЦИИ', subtitle:'Нижнее ядро · финал', sector:2, size:52,
    briefing:'Отключите три синаптических узла, уничтожьте Сверхразум и доберитесь до последнего эвакуационного маяка.',
    ending:'ЛИНА: Вижу ваш маяк. Станция свободна. МИР: Мы запомним тех, кто не вышел. Конец операции «Затмение».',
    rooms:[[20,40,12,9],[19,26,14,10],[3,25,11,11],[38,25,11,11],[21,19,10,8],[15,3,22,16],[39,3,10,12]],
    links:[[0,1],[1,2],[1,3],[1,4],[4,5],[5,6],[3,6]], points:{start:0,hub:1,nodeA:2,nodeB:3,nodeC:4,core:5,evac:6,exit:6},
    stages:[
      { type:'clear', title:'ПРОЙДИТЕ ЗАЩИТНЫЙ ПЕРИМЕТР', target:'hub', entry:'start', count:40, batch:12, types:['brute','spitter','grunt'], radio:'ЛИНА: Центральная колония защищает спуск. Уничтожьте внешний периметр.' },
      { type:'collect', title:'ОТКЛЮЧИТЕ СИНАПТИЧЕСКИЕ УЗЛЫ', targets:['nodeA','nodeB','nodeC'], entry:'hub', count:30, types:['brute','spitter','grunt'], guarded:true, radio:'МИР: Сигнал идёт через три узла. Разорвите связь, чтобы открыть центральную камеру.' },
      { type:'defend', title:'УДЕРЖИВАЙТЕ РАЗРЫВ СВЯЗИ', target:'nodeC', entry:'nodeC', seconds:85, count:10, types:['brute','spitter','grunt'], radio:'МИР: Сверхразум восстанавливает узлы. Защитите северный разрыв, пока я изолирую контур.' },
      { type:'clear', title:'ПРОРВИТЕСЬ В ЦЕНТРАЛЬНУЮ КАМЕРУ', target:'core', entry:'nodeC', count:42, batch:12, types:['brute','spitter','grunt'], radio:'ЛИНА: Камера открыта. Охрана выходит вам навстречу. Сохраните тяжёлые боеприпасы для источника.' },
      { type:'boss', title:'УНИЧТОЖЬТЕ СВЕРХРАЗУМ', target:'core', entry:'hub', boss:'overmind', radio:'ЛИНА: Он меняет форму. Следите за фазами и зонами на полу. Это наш последний бой.' },
      { type:'interact', title:'ОТПРАВЬТЕ СИГНАЛ ЭВАКУАЦИИ', target:'evac', entry:'core', count:14, types:['crawler','spitter'], guarded:true, radio:'ЛИНА: На северо-восток, к маяку! Подайте сигнал — транспорт не видит вас сквозь помехи.' },
      { type:'evac', title:'ДОЖДИТЕСЬ ЭВАКУАЦИИ', target:'evac', entry:'evac', seconds:90, count:9, types:['crawler','spitter','grunt'], radio:'ЛИНА: Камера рушится. Удерживайте площадку до прибытия транспорта. Последний рывок!' }
    ] }
]);

function normalizeCampaignMissionId(value) {
  const named = CAMPAIGN_MISSIONS.find(m => m.key === value);
  return named ? named.id : Math.max(1, Math.min(6, Math.floor(Number(value)) || 1));
}
function campaignProgress() {
  let value; try { value = JSON.parse(store.get('campaign', '{}')); } catch (_) { value = {}; }
  return normalizeCampaignProgress(value) || { unlocked:1, completed:[], logs:[], checkpoint:null };
}

function createCampaignLevel(seed, missionId) {
  const mission = CAMPAIGN_MISSIONS[normalizeCampaignMissionId(missionId) - 1];
  const level = new LevelMap(mission.size, mission.size, seed, mission.sector);
  level.grid.fill(T_WALL); level.rooms = []; level.lamps = []; level.spawnPoints = []; level.propSpots = [];
  level.campaignId = mission.id;
  level.sector = Object.assign({}, SECTOR_DEFS[mission.sector], { name: mission.title, subtitle: mission.subtitle });
  for (const [i, spec] of mission.rooms.entries()) {
    const [x,z,w,h] = spec;
    const room = {x,z,w,h,cx:x + Math.floor(w/2),cz:z + Math.floor(h/2),number:i+1,kind:['cargo','lab','power'][mission.sector]};
    level.rooms.push(room); level._carveRect(x,z,w,h);
  }
  // Authored connectivity, three tiles wide throughout. Cosmetic variation
  // never touches this navigable spine or an objective's interaction radius.
  for (const [a,b] of mission.links) {
    const from = level.rooms[a], to = level.rooms[b];
    level._carveRect(Math.min(from.cx,to.cx)-1,from.cz-1,Math.abs(from.cx-to.cx)+3,3);
    level._carveRect(to.cx-1,Math.min(from.cz,to.cz)-1,3,Math.abs(from.cz-to.cz)+3);
  }
  const rng = makeRng(seed ^ 0x43414d50);
  for (const room of level.rooms) {
    // Cover stays beside the main axes; large bosses retain a broad path.
    if (room.w >= 12 && room.h >= 11) {
      for (const [dx,dz] of [[2,2],[room.w-3,2],[2,room.h-3],[room.w-3,room.h-3]])
        level.grid[level.idx(room.x+dx,room.z+dz)] = T_WALL;
    }
    level.lamps.push({x:level.tileToWorldX(room.cx),z:level.tileToWorldZ(room.cz),hue:level.sector.lampColor,phase:rng()*6.28,flicker:false});
    for (const [dx,dz] of [[1,1],[room.w-2,room.h-2]]) {
      const x = level.tileToWorldX(room.x+dx), z = level.tileToWorldZ(room.z+dz);
      level.spawnPoints.push({x,z});
      // Alternate corners hold small props, never the central walk route.
      if (rng() < 0.55) level.propSpots.push({x:level.tileToWorldX(room.x+(dx===1?room.w-2:1)),z,rot:rng()*Math.PI*2});
    }
  }
  level.campaignPoints = {};
  for (const [name,index] of Object.entries(mission.points)) {
    const room = level.rooms[index];
    level.campaignPoints[name] = {id:name,x:level.tileToWorldX(room.cx),z:level.tileToWorldZ(room.cz),room:index};
    level._carveRect(room.cx-2,room.cz-2,5,5);
  }
  level.start = Object.assign({}, level.campaignPoints.start);
  level.startRoom = level.rooms[0];
  level._initNavRouting();
  level.rebuildNav(level.start.x,level.start.z);
  return level;
}

function campaignPath(level, from, to) {
  const start = level.idx(level.worldToTileX(from.x),level.worldToTileZ(from.z));
  const goal = level.idx(level.worldToTileX(to.x),level.worldToTileZ(to.z));
  const prev = new Int32Array(level.w*level.h).fill(-1), queue = new Int32Array(prev.length);
  let read=0,write=0; queue[write++]=start; prev[start]=start;
  while(read<write && prev[goal]<0) {
    const at=queue[read++],x=at%level.w,z=Math.floor(at/level.w);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=x+dx,nz=z+dz;if(level.isWallTile(nx,nz))continue;
      const next=level.idx(nx,nz);if(prev[next]>=0)continue;prev[next]=at;queue[write++]=next;
    }
  }
  if(prev[goal]<0)return [];
  const path=[];for(let at=goal;at!==start;at=prev[at])path.push({x:level.tileToWorldX(at%level.w),z:level.tileToWorldZ(Math.floor(at/level.w))});
  return path.reverse();
}

const CAMPAIGN_PLAYER_BONUSES = ['damageMultiplier','reloadMultiplier','critScale','critPower','speedScale','dashCooldown',
  'burnScale','splashScale','chainBonus','pierceBonus','burnChains','grenadeCooldown'];

class CampaignDirector {
  constructor(game, options = {}) {
    this.game=game;this.options=options;this.missionId=normalizeCampaignMissionId(options.missionId || 1);
    this.def=CAMPAIGN_MISSIONS[this.missionId-1];this.stageIndex=0;this.phase='idle';
    this.progress=campaignProgress();this.collected=new Set();this.killed=new Set();this.stageClock=0;
    this.encounterClock=0;this.hazardClock=0;this.radio='';this.radioTime=0;this.npc=null;this.visuals=null;
    this.markerMeshes=[];this.boss=null;this.bossDefeated=false;this.finished=false;this.lastHint='';
  }
  get stage(){return this.def.stages[this.stageIndex];}
  point(id){return this.game.level.campaignPoints[id] || this.game.level.start;}
  begin() {
    const saved=this.options.resume && this.progress.checkpoint;
    if(saved && saved.missionId===this.missionId && saved.stageIndex<this.def.stages.length) {
      this.stageIndex=saved.stageIndex;this.restoreLoadout(saved);
    }
    this.placeAtEntry();this.saveCheckpoint();this.beginStage();
    return this;
  }
  placeAtEntry(){const p=this.game.player,at=this.point(this.stage.entry||'start');p.x=at.x;p.z=at.z;p.vx=p.vz=0;p.invuln=2;p.alive=true;
    if(p.root)p.root.position.set(p.x,0,p.z);if(this.game.level.rebuildNav)this.game.level.rebuildNav(p.x,p.z);}
  announce(text) {this.radio=text;this.radioTime=9;if(this.game.hud && this.game.hud.popup)this.game.hud.popup('НОВАЯ ЗАДАЧА', '#7cf4df');}
  beginStage() {
    this.phase='active';this.finished=false;this.stageClock=0;this.encounterClock=0;this.hazardClock=3;
    this.collected.clear();this.killed.clear();this.boss=null;this.bossDefeated=false;this.remainingSpawns=0;
    this.game.wave=this.missionId*2+this.stageIndex;this.game.waveState='mission';
    this.game.activeBoss=null;this.clearVisuals();this.npc=null;
    this.announce(this.stage.radio);
    if(this.stage.count){const first=this.stage.batch||this.stage.count;
      const made=this.spawnEncounter(Math.min(first,this.stage.count),this.stage.types||['grunt']);
      if(this.stage.type==='clear')this.remainingSpawns=Math.max(0,this.stage.count-made);}
    if(this.stage.type==='boss') {
      const at=this.point(this.stage.target);
      this.boss=this.game.enemies.spawn(this.stage.boss,at.x,at.z,{hp:0.72+this.missionId*.065,dmg:.7+this.missionId*.05,speed:1});
      if(this.boss){this.boss.missionStage=this.stageIndex;this.game.activeBoss=this.boss;}
    }
    if(this.stage.type==='escort' || this.stage.npc) {
      const at=this.point(this.stage.entry || this.stage.target);
      this.npc={x:at.x,z:at.z,hp:140,maxHp:140,routeIndex:1,path:[],pathIndex:0,damageClock:0,phase:0};
      if(this.stage.type==='escort')this.npc.path=campaignPath(this.game.level,at,this.point(this.stage.route[1]));
    }
    this.buildVisuals();this.supplyStage();
  }
  supplyStage(){const p=this.game.player,g=this.game;if(!g.pickups)return;
    const at=this.point(this.stage.entry||'start');g.pickups.spawn('health',at.x+2,at.z);
    const list=typeof p.ownedList==='function'?p.ownedList():[];
    for(const index of list){const w=typeof WEAPONS!=='undefined'?WEAPONS[index]:null;if(w && w.ammo!=='none')g.pickups.spawn('ammo',at.x-2,at.z,w.ammo);}
  }
  spawnEncounter(count, types) {
    const g=this.game,target=this.point(this.stage.target || this.stage.targets?.[0] || this.stage.entry || 'start');
    const spots=g.level.spawnPoints.slice().sort((a,b)=>Math.hypot(a.x-target.x,a.z-target.z)-Math.hypot(b.x-target.x,b.z-target.z));
    let made=0;
    for(let i=0;i<count;i++) {
      const spot=spots[i%Math.max(1,Math.min(spots.length,6))] || target;
      const x=spot.x+(i%2)*1.1,z=spot.z+((i>>1)%2)*1.1;
      const safe=Math.hypot(x-g.player.x,z-g.player.z)>6 ? {x,z} : spots.find(s=>Math.hypot(s.x-g.player.x,s.z-g.player.z)>9) || spot;
      const enemy=g.enemies.spawn(types[i%types.length],safe.x,safe.z,{hp:.86+this.missionId*.06,dmg:.7+this.missionId*.05,speed:1});
      if(enemy){enemy.missionStage=this.stageIndex;made++;}
    }
    this.spawned=(this.spawned||0)+made;return made;
  }
  living(){return this.game.enemies.list.filter(e=>e.hp>0 && (typeof S_DYING==='undefined'||e.state!==S_DYING));}
  onEnemyKilled(enemy){if(this.phase!=='active')return;if(enemy.missionStage===this.stageIndex)this.killed.add(enemy.id);
    if(enemy===this.boss || enemy.def?.id===this.stage.boss)this.bossDefeated=true;}
  isCheckpointSafe(){return this.phase==='checkpoint';}
  activeTargets(){if(!this.stage)return[];const keys=this.stage.targets||[this.stage.target];
    return keys.filter(Boolean).filter(k=>!this.collected.has(k)).map(k=>Object.assign({label:k},this.point(k)));}
  interact(){
    if(this.phase==='checkpoint'){this.saveCheckpoint();this.beginStage();return true;}
    if(this.phase!=='active' || !['interact','collect'].includes(this.stage.type))return false;
    const p=this.game.player,target=this.activeTargets().find(t=>Math.hypot(t.x-p.x,t.z-p.z)<=4.8);
    if(!target)return false;
    if(this.stage.guarded && this.living().some(e=>Math.hypot(e.x-target.x,e.z-target.z)<8)){
      this.radio='Терминал заблокирован. Устраните противников в радиусе восьми метров.';this.radioTime=5;return false;}
    this.collected.add(target.id);
    if(this.stage.logs){const index=this.stage.targets.indexOf(target.id),log=this.stage.logs[index];
      if(log && !this.progress.logs.includes(log))this.progress.logs.push(log);
      this.radio=['ЖУРНАЛ 01: Карантин включён вручную. Доступ подтверждён директором станции.',
        'ЖУРНАЛ 02: Реактор питает неизвестную ткань. Отключение системы блокируется из ядра.',
        'ЖУРНАЛ 03: Инженер Мир заперт в медблоке. Его коды — последний способ остановить реактор.'][index];
      this.radioTime=10;store.set('campaign',this.progress);
    }
    if(typeof sfx!=='undefined' && sfx.ui)sfx.ui('select');
    this.updateMarkerStates();return true;
  }
  update(dt){
    if(this.finished || this.phase==='failed')return;
    this.radioTime=Math.max(0,this.radioTime-dt);
    if(this.phase==='checkpoint'){this.updateVisuals(dt);return;}
    if(this.phase!=='active')return;
    const p=this.game.player;if(!p.alive)return;
    const stage=this.stage,at=this.point(stage.target||stage.entry||'start');
    const nearby=Math.hypot(p.x-at.x,p.z-at.z)<(stage.type==='reach'?4.2:8);
    this.encounterClock+=dt;this.hazardClock-=dt;
    if(stage.type==='clear' && this.remainingSpawns>0 && this.living().length<14 && (this.encounterClock>=12 || this.living().length<=2)){
      const amount=Math.min(stage.batch||8,this.remainingSpawns,14-this.living().length);
      this.remainingSpawns-=this.spawnEncounter(amount,stage.types||['grunt']);this.encounterClock=0;}
    if(stage.hazards && this.hazardClock<=0){this.hazardClock=6;
      for(const target of this.activeTargets())if(this.game.hazards)this.game.hazards.spawn(target.x,target.z,3.1,3.7,10,0xffb45a);}
    if(stage.type==='reach' && nearby)this.completeStage();
    else if(stage.type==='clear' && !this.remainingSpawns && this.killed.size>=stage.count && this.living().length===0)this.completeStage();
    else if(['interact','collect'].includes(stage.type) && this.collected.size>=(stage.targets?.length||1))this.completeStage();
    else if(stage.type==='boss' && this.bossDefeated)this.completeStage();
    else if(stage.type==='escort')this.updateEscort(dt);
    else if(stage.type==='defend' || stage.type==='evac') {
      this.contested=this.living().some(e=>Math.hypot(e.x-at.x,e.z-at.z)<4.5);
      if(nearby && !this.contested)this.stageClock+=dt;
      if(this.encounterClock>=6 && this.living().length<14){this.encounterClock=0;this.spawnEncounter(stage.type==='evac'?2:3,stage.types);}
      if(this.stageClock>=stage.seconds)this.completeStage();
    }
    this.updateVisuals(dt);
  }
  updateEscort(dt){
    const npc=this.npc,p=this.game.player;if(!npc)return;
    const near=Math.hypot(p.x-npc.x,p.z-npc.z)<=12;
    npc.damageClock-=dt;
    const attackers=this.living().filter(e=>Math.hypot(e.x-npc.x,e.z-npc.z)<(e.def?.ranged?9:2.8) && this.game.level.lineOfSight(e.x,e.z,npc.x,npc.z));
    if(attackers.length && npc.damageClock<=0){npc.damageClock=.9;npc.hp=Math.max(0,npc.hp-Math.min(14,attackers.length*3.5));}
    if(npc.hp<=0){this.onPlayerDeath('Инженер Мир погиб. Вернитесь к контрольной точке и держитесь рядом.');return;}
    if(near && !attackers.some(e=>Math.hypot(e.x-npc.x,e.z-npc.z)<2.4)){
      const target=npc.path[npc.pathIndex];
      if(target){const dx=target.x-npc.x,dz=target.z-npc.z,len=Math.hypot(dx,dz),step=Math.min(len,dt*4.4);
        if(len>.001){npc.x+=dx/len*step;npc.z+=dz/len*step;npc.angle=Math.atan2(dx,dz);npc.phase+=dt*8;}
        if(len<.25)npc.pathIndex++;
      } else {
        npc.routeIndex++;npc.pathIndex=0;
        if(npc.routeIndex>=this.stage.route.length){this.completeStage();return;}
        npc.path=campaignPath(this.game.level,npc,this.point(this.stage.route[npc.routeIndex]));
      }
      this.game.level.resolveCircle(npc,.45);if(this.game.props?.resolve)this.game.props.resolve(npc,.45);
    }
    if(this.encounterClock>=10 && this.living().length<10){this.encounterClock=0;this.spawnEncounter(3,this.stage.types);}
  }
  clearEncounter(){const g=this.game;g.enemies.reset();if(g.projectiles?.clear)g.projectiles.clear();if(g.hazards?.clear)g.hazards.clear();g.activeBoss=null;}
  completeStage(){
    if(this.phase!=='active')return;
    this.clearEncounter();this.clearVisuals();this.npc=null;this.stageIndex++;
    const g=this.game;g.money+=70+this.missionId*20;g.sampleYield+=8;
    if(this.stageIndex>=this.def.stages.length){this.completeMission();return;}
    this.phase='checkpoint';g.waveState='prep';g.prepTimer=0;g.shopStock=[];g.shopRerolls=0;
    g.player.hp=Math.max(g.player.hp,Math.round(g.player.maxHp*.7));g.player.armor=Math.min(g.player.maxArmor,g.player.armor+15);
    this.radio='Этап завершён. Контрольная точка сохранена. Пополните снаряжение; взаимодействуйте, чтобы продолжить.';this.radioTime=12;
    this.saveCheckpoint();
    if(this.stageIndex%2===0 && g.offerPerks && !this.options.headless)g.offerPerks();
  }
  captureCheckpoint(missionId=this.missionId,stageIndex=this.stageIndex){
    const g=this.game,p=g.player,bonuses={};for(const key of CAMPAIGN_PLAYER_BONUSES)if(Number.isFinite(p[key])||typeof p[key]==='boolean')bonuses[key]=Number(p[key]);
    return {missionId,stageIndex,seed:g.runSeed>>>0,money:g.money,score:g.score,time:g.time,sampleYield:g.sampleYield,
      perks:Object.assign({},g.perks),upgrades:Object.assign({},g.upgrades),stats:Object.assign({},g.stats),
      player:{hp:p.hp,maxHp:p.maxHp,armor:p.armor,maxArmor:p.maxArmor,owned:Object.keys(p.owned||{}).filter(k=>p.owned[k]),
        weaponId:p.weapon?.id||'pistol',meleeId:p.meleeId||'knife',ammo:Object.assign({},p.ammo),mags:Object.assign({},p.mags),bonuses}};
  }
  saveCheckpoint(){this.progress=campaignProgress();this.progress.unlocked=Math.max(this.progress.unlocked,this.missionId);
    this.progress.checkpoint=this.captureCheckpoint();this.checkpointPersistent=store.set('campaign',this.progress);return this.progress.checkpoint;}
  restoreLoadout(c){
    const g=this.game,p=g.player,s=c.player;g.money=c.money;g.score=c.score;g.time=c.time;g.sampleYield=c.sampleYield;
    g.perks={};for(const [id,rank] of Object.entries(c.perks||{}))if(typeof PERK_BY_ID==='undefined'||PERK_BY_ID[id])g.perks[id]=typeof PERK_BY_ID==='undefined'?rank:Math.min(rank,PERK_BY_ID[id].max);
    g.upgrades={};for(const [id,rank] of Object.entries(c.upgrades||{}))if(typeof FIELD_UPGRADES==='undefined'||FIELD_UPGRADES.some(u=>u.id===id))g.upgrades[id]=rank;
    g.stats=Object.assign({kills:0,shots:0,hits:0,waveKills:0},c.stats);
    p.maxHp=s.maxHp;p.hp=Math.min(s.maxHp,s.hp);p.maxArmor=s.maxArmor;p.armor=Math.min(s.maxArmor,s.armor);
    for(const key of CAMPAIGN_PLAYER_BONUSES)if(Number.isFinite(s.bonuses[key]))p[key]=key==='burnChains'?!!s.bonuses[key]:s.bonuses[key];
    p.owned={};for(const id of s.owned)if(typeof WEAPON_BY_ID==='undefined'||WEAPON_BY_ID[id])p.owned[id]=true;
    if(!Object.keys(p.owned).length)p.owned.pistol=true;p.meleeId=s.meleeId||'knife';p.ammo=Object.assign({},p.ammo,s.ammo);p.mags=Object.assign({},s.mags);
    if(typeof WEAPONS!=='undefined' && p.setWeapon){const index=WEAPONS.findIndex(w=>w.id===s.weaponId && p.owned[w.id]);p.setWeapon(index>=0?index:WEAPONS.findIndex(w=>p.owned[w.id]));}
  }
  completeMission(){
    this.finished=true;this.phase='complete';this.clearEncounter();this.clearVisuals();
    const g=this.game;this.progress=campaignProgress();
    if(!this.progress.completed.includes(this.missionId))g.sampleYield+=40+this.missionId*20;
    const earned=g.bankRun?g.bankRun():0;g.sampleYield=0;
    this.progress=campaignProgress();if(!this.progress.completed.includes(this.missionId))this.progress.completed.push(this.missionId);
    this.progress.unlocked=Math.max(this.progress.unlocked,Math.min(6,this.missionId+1));
    this.progress.checkpoint=this.missionId<6?this.captureCheckpoint(this.missionId+1,0):null;
    store.set('campaign',this.progress);g.state='campaignComplete';
    this.setText('campaignCompleteTitle',this.missionId===6?'ОПЕРАЦИЯ ЗАВЕРШЕНА':'МИССИЯ ЗАВЕРШЕНА');
    this.setText('campaignCompleteStory',this.def.ending);this.setText('campaignCompleteStats','Миссия '+this.missionId+' / 6 · устранения: '+g.stats.kills+' · образцы: +'+earned);
    if(typeof document!=='undefined'){document.body.classList.remove('playing');document.getElementById('campaignComplete')?.classList.add('show');
      const next=document.getElementById('campaignNextBtn');if(next)next.hidden=this.missionId===6;}
    if(typeof sfx!=='undefined' && sfx.ui)sfx.ui('wave');
  }
  onPlayerDeath(reason){
    if(this.finished)return;this.phase='failed';this.finished=true;this.game.state='campaignFailed';
    this.setText('campaignFailedReason',typeof reason==='string'?reason:'Оператор выведен из строя. Снаряжение восстановится на последней контрольной точке.');
    if(typeof document!=='undefined'){document.body.classList.remove('playing');document.getElementById('campaignFailed')?.classList.add('show');}
    if(typeof sfx!=='undefined'){sfx.flameStop?.();sfx.spinup?.(false,0);}
  }
  setText(id,value){if(typeof document!=='undefined'){const el=document.getElementById(id);if(el)el.textContent=value;}}
  hudState(){
    const s=this.stage || this.def.stages[this.def.stages.length-1];let progress=0,counter='',hint='';
    if(this.phase==='checkpoint')return {title:this.checkpointPersistent===false?'КОНТРОЛЬНАЯ ТОЧКА · ЭТА СЕССИЯ':'КОНТРОЛЬНАЯ ТОЧКА',objective:'Пополните снаряжение перед следующим этапом',counter:'ЭТАП '+this.stageIndex+' / '+this.def.stages.length,progress:1,radio:this.checkpointPersistent===false?'Браузер не разрешил запись. Контрольная точка доступна до закрытия этой вкладки.':this.radioTime>0?this.radio:'',targets:[],checkpoint:true,stage:this.stageIndex+1,stages:this.def.stages.length,missionId:this.missionId};
    if(s.type==='clear'){progress=this.killed.size/s.count;counter=this.killed.size+' / '+s.count+' целей';}
    else if(s.type==='collect'||s.type==='interact'){const total=s.targets?.length||1;progress=this.collected.size/total;counter=this.collected.size+' / '+total+' объектов';
      if(this.activeTargets().some(t=>Math.hypot(t.x-this.game.player.x,t.z-this.game.player.z)<=4.8))hint='V · ВЗАИМОДЕЙСТВОВАТЬ';}
    else if(s.type==='defend'||s.type==='evac'){progress=this.stageClock/s.seconds;counter=Math.max(0,Math.ceil(s.seconds-this.stageClock))+' с · '+(this.contested?'ЗОНА ОСПАРИВАЕТСЯ':'УДЕРЖИВАЙТЕ ПЛОЩАДКУ');}
    else if(s.type==='escort' && this.npc){progress=(this.npc.routeIndex-1)/(s.route.length-1);counter='МИР '+Math.ceil(this.npc.hp)+' / '+this.npc.maxHp+' · '+(Math.hypot(this.game.player.x-this.npc.x,this.game.player.z-this.npc.z)>12?'ПОДОЖДЁТ ВАС':'СЛЕДУЕТ ПО МАРШРУТУ');}
    else if(s.type==='boss'){progress=this.boss?1-this.boss.hp/this.boss.maxHp:0;counter='БОСС · '+(this.boss?.def.label||s.boss);}
    else {const t=this.point(s.target);counter=Math.ceil(Math.hypot(t.x-this.game.player.x,t.z-this.game.player.z))+' м ДО ЦЕЛИ';}
    return {title:s.title,objective:s.text||'Следуйте к отмеченной цели',counter,progress:Math.max(0,Math.min(1,progress)),hint,
      stage:this.stageIndex+1,stages:this.def.stages.length,missionId:this.missionId,radio:this.radioTime>0?this.radio:'',targets:this.activeTargets(),npc:this.npc};
  }
  buildVisuals(){
    if(this.options.headless || typeof THREE==='undefined' || !this.game.scene)return;
    this.visuals=new THREE.Group();this.game.scene.add(this.visuals);this.markerMeshes=[];
    for(const target of this.activeTargets()){
      const group=new THREE.Group();group.position.set(target.x,0,target.z);
      const material=new THREE.MeshBasicMaterial({color:0xffc271,transparent:true,opacity:.7,depthWrite:false});
      const ring=new THREE.Mesh(new THREE.RingGeometry(1.15,1.3,36),material);ring.rotation.x=-Math.PI/2;ring.position.y=.06;group.add(ring);
      const post=new THREE.Mesh(new THREE.CylinderGeometry(.18,.28,1.8,12),new THREE.MeshStandardMaterial({color:0x385c64,emissive:0x173938,roughness:.5,metalness:.35}));post.position.y=.9;group.add(post);
      const cap=new THREE.Mesh(new THREE.OctahedronGeometry(.32),new THREE.MeshBasicMaterial({color:0xffc271}));cap.position.y=2.25;group.add(cap);
      group.userData.targetId=target.id;group.userData.cap=cap;this.visuals.add(group);this.markerMeshes.push(group);
    }
    if(this.npc && typeof buildPlayer==='function'){
      const look=Object.assign({},loadLook(),{jacket:0xd3ccae,pants:0x364e59,vest:false,backpack:false,helmet:'none',accent:0x7cf4df});
      this.npcModel=buildPlayer(look);this.visuals.add(this.npcModel.root);
    }
  }
  updateMarkerStates(){for(const marker of this.markerMeshes)marker.visible=!this.collected.has(marker.userData.targetId);}
  updateVisuals(dt){for(const marker of this.markerMeshes){marker.userData.cap.rotation.y+=dt*.8;}
    if(this.npc && this.npcModel){const m=this.npcModel,n=this.npc;m.root.position.set(n.x,0,n.z);m.root.rotation.y=n.angle||0;
      m.legL.rotation.x=Math.sin(n.phase)*.2;m.legR.rotation.x=-Math.sin(n.phase)*.2;}}
  clearVisuals(){if(this.visuals){this.game.scene.remove(this.visuals);const geometries=new Set(),materials=new Set();
      this.visuals.traverse(o=>{if(o.geometry && !o.geometry.userData.shared)geometries.add(o.geometry);
        if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])if(!m.userData?.shared)materials.add(m);});
      for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}
    this.visuals=null;this.npcModel=null;this.markerMeshes=[];}
  dispose(){this.clearVisuals();this.finished=true;}
}
