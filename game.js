(() => {
  'use strict';
  const {Game, SHAPES, rotated} = window.BlockEngine;
  const game = new Game();
  const $ = id => document.getElementById(id);
  const COLORS = {I:'#65c9c8',O:'#e5ce6f',T:'#b298d4',J:'#7faee5',L:'#e8a36d',S:'#afd38b',Z:'#db8984'};
  const board = $('board'), ctx = board.getContext('2d');
  const qa = new URLSearchParams(location.search).get('qa') === '1';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    read(key, fallback) { try { const value = localStorage.getItem('block-beat.v1.'+key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } },
    write(key, value) { try { localStorage.setItem('block-beat.v1.'+key, JSON.stringify(value)); } catch { /* Private mode and file URLs may deny storage. */ } }
  };
  const savedBest = store.read('best',0);
  let best = Number.isSafeInteger(savedBest) && savedBest >= 0 ? savedBest : 0;
  let muted = store.read('muted',false) === true;
  let fixture = null, lastState = '', effects = [], flashRows = [], flashUntil = 0, toastUntil = 0;
  let trail = [], trailUntil = 0, timeline = [], audioContext = null, audioUnavailable = false, cueCount = 0;
  let previousFrame = performance.now(), lastHUD = 0, pausedForHelp = false;
  const voices = new Set(), heldInputs = new Map();

  function audioUnlock() {
    if (muted || audioUnavailable) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) { audioUnavailable = true; return; }
      if (!audioContext) audioContext = new Audio();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => { audioUnavailable = true; });
    } catch { audioUnavailable = true; }
  }
  function stopAudio() {
    for (const oscillator of voices) { try { oscillator.stop(); } catch {} }
    voices.clear();
  }
  function tone(freq, length=.09, delay=0, volume=.045, wave='triangle') {
    if (muted || !audioContext || audioContext.state !== 'running' || voices.size >= 12) return;
    try {
      const now = audioContext.currentTime + delay;
      const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
      oscillator.type = wave; oscillator.frequency.setValueAtTime(freq,now);
      gain.gain.setValueAtTime(0,now); gain.gain.linearRampToValueAtTime(volume,now+.008);
      gain.gain.exponentialRampToValueAtTime(.001,now+length);
      oscillator.connect(gain); gain.connect(audioContext.destination); voices.add(oscillator);
      oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(now); oscillator.stop(now+length+.02);
    } catch { audioUnavailable = true; }
  }
  function cue(event) {
    if (muted || !audioContext || audioContext.state !== 'running') return;
    const table = {start:[330,440,660], rotate:[440], hold:[392,523], lock:[130], clear:[523,659,784,1047], level:[659,784,988], over:[330,262,196]};
    const notes = table[event.type];
    if (!notes) return;
    cueCount++;
    notes.forEach((note,i) => tone(note,event.type === 'over' ? .2 : .1,i*.055,event.type === 'lock' ? .028 : .045));
  }
  function message(text) { $('toast').textContent = text; toastUntil = performance.now()+1100; $('live').textContent = text; }
  function processEvents() {
    for (const event of game.drain()) {
      timeline.push(event); if (timeline.length > 50) timeline.shift();
      if (event.type === 'pause' || event.type === 'over') { clearInputs(); stopAudio(); }
      cue(event);
      if (event.type === 'drop') { trail = event.cells; trailUntil = performance.now()+160; }
      if (event.type === 'clear') {
        flashRows = event.rows; flashUntil = performance.now()+200;
        message(`${['','SINGLE','DOUBLE','TRIPLE','FOUR LINES!'][event.count]}  +${event.points}`);
        if (!reducedMotion) for (const row of event.rows) for (let x=0; x<10; x++) for (let n=0; n<2; n++) {
          effects.push({x:x*30+15,y:row*30+15,vx:(Math.random()-.5)*140,vy:-Math.random()*150-30,age:0,color:Object.values(COLORS)[x%7]});
        }
      }
      if (event.type === 'level') message(`LEVEL ${event.level}  /  节奏升级`);
      if (event.type === 'over') $('live').textContent = `本局结束，得分 ${game.score}，消除 ${game.lines} 行。`;
      if (event.type === 'hold') $('live').textContent = `已暂存 ${game.held} 型方块。`;
    }
    if (!fixture && game.score > best) { best = game.score; store.write('best',best); }
    updateHUD();
  }
  function updateHUD() {
    $('score').textContent = String(game.score).padStart(6,'0');
    $('best').textContent = String(best);
    $('level').textContent = String(game.level).padStart(2,'0');
    $('lines').textContent = String(game.lines).padStart(2,'0');
    const seconds = Math.floor(game.elapsed/1000);
    $('clock').textContent = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    $('progress-fill').style.width = `${game.lines%10*10}%`;
    $('level-progress').setAttribute('aria-valuenow',String(game.lines%10));
    $('progress-label').textContent = `再消 ${10-game.lines%10} 行，节奏升级`;
    $('hold-note').textContent = game.holdUsed ? '放下当前方块后可再交换' : '给下一步留个选择';
    $('sound').textContent = audioUnavailable ? '♪ 音效不可用' : muted ? '♪ 音效关' : '♪ 音效开';
    $('sound').setAttribute('aria-pressed',String(!muted && !audioUnavailable));
    const names = {ready:'准备就绪',running:'进行中',paused:'已暂停',over:'本局结束'};
    $('status').textContent = names[game.status]; $('status-dot').className = game.status;
    $('pause').disabled = game.status === 'ready' || game.status === 'over';
    $('pause').innerHTML = game.status === 'paused' ? '▶ 继续 <kbd>P</kbd>' : 'Ⅱ 暂停 <kbd>P</kbd>';
    document.querySelectorAll('[data-action]').forEach(button => { button.disabled = game.status !== 'running' || (button.dataset.action === 'hold' && game.holdUsed); });
    if (lastState !== game.status) {
      lastState = game.status; $('overlay').hidden = game.status === 'running';
      const copy = {
        ready:['READY WHEN YOU ARE','落下第一块。','移动、旋转、填满一行。<br>一小局，换一个好心情。','开始游戏'],
        paused:['TAKE YOUR TIME','休息一个节拍。','棋盘和时间都已停下。<br>准备好了，就接着来。','继续游戏'],
        over:['ONE MORE ROUND?','下一局，会更好。',`本局 ${game.score} 分 · 消除 ${game.lines} 行<br>每一次落下，都是新的选择。`,'再来一局']
      }[game.status];
      if (copy) { $('overlay-tag').textContent=copy[0]; $('overlay-title').textContent=copy[1]; $('overlay-copy').innerHTML=copy[2]; $('play').innerHTML=copy[3]+' <span aria-hidden="true">↗</span>'; }
    }
    if (qa) $('game-state').textContent = JSON.stringify({...game.snapshot(),fixture,best,muted,
      audio:{state:audioContext?.state || (audioUnavailable?'unavailable':'not-created'),cueCount,voices:voices.size},
      lastEvents:timeline.slice(-8)},null,2);
  }
  function roundRect(context,x,y,w,h,r) { context.beginPath(); context.roundRect(x,y,w,h,r); }
  function tile(context,x,y,size,color,ghost=false) {
    const gap = size*.052;
    if (ghost) {
      context.globalAlpha=.47; context.strokeStyle=color; context.lineWidth=1.1;
      roundRect(context,x+gap+1,y+gap+1,size-gap*2-2,size-gap*2-2,3); context.stroke(); context.globalAlpha=1; return;
    }
    context.fillStyle=color; roundRect(context,x+gap,y+gap,size-gap*2,size-gap*2,3); context.fill();
    context.fillStyle='#ffffff3b'; context.fillRect(x+gap+3,y+gap+2,size-gap*2-6,2);
    context.fillStyle='#102b221c'; context.fillRect(x+gap+3,y+size-gap-4,size-gap*2-6,2);
  }
  function renderPreview(canvas, types, dim=false) {
    const context = canvas.getContext('2d'); context.clearRect(0,0,canvas.width,canvas.height);
    const rowHeight = canvas.height/types.length;
    types.forEach((type,index) => {
      if (!type) {
        context.strokeStyle='#bcc5b0'; context.lineWidth=1; context.setLineDash([3,4]);
        roundRect(context,canvas.width/2-36,index*rowHeight+rowHeight/2-22,72,44,6); context.stroke(); context.setLineDash([]); return;
      }
      const cells = SHAPES[type].flatMap((row,y)=>row.flatMap((v,x)=>v?[{x,y}]:[]));
      const minX=Math.min(...cells.map(c=>c.x)), maxX=Math.max(...cells.map(c=>c.x));
      const minY=Math.min(...cells.map(c=>c.y)), maxY=Math.max(...cells.map(c=>c.y));
      const size=26, startX=(canvas.width-(maxX-minX+1)*size)/2, startY=index*rowHeight+(rowHeight-(maxY-minY+1)*size)/2;
      if (dim) context.globalAlpha=.45;
      for(const cell of cells) tile(context,startX+(cell.x-minX)*size,startY+(cell.y-minY)*size,size,COLORS[type]);
      context.globalAlpha=1;
      if (index<types.length-1) { context.strokeStyle='#d6dccc'; context.lineWidth=.6; context.beginPath(); context.moveTo(30,(index+1)*rowHeight); context.lineTo(canvas.width-30,(index+1)*rowHeight); context.stroke(); }
    });
  }
  function render(now,dt) {
    ctx.setTransform(2,0,0,2,0,0); ctx.clearRect(0,0,300,600); ctx.fillStyle='#172923'; ctx.fillRect(0,0,300,600);
    ctx.strokeStyle='#d6e7bb0b'; ctx.lineWidth=.5;
    for(let x=0;x<=10;x++){ctx.beginPath();ctx.moveTo(x*30,0);ctx.lineTo(x*30,600);ctx.stroke();}
    for(let y=0;y<=20;y++){ctx.beginPath();ctx.moveTo(0,y*30);ctx.lineTo(300,y*30);ctx.stroke();}
    for(let y=0;y<20;y++) for(let x=0;x<10;x++) if(game.board[y][x]) tile(ctx,x*30,y*30,30,COLORS[game.board[y][x]]);
    if(game.active && game.status !== 'over') {
      const ghost={...game.active,y:game.ghostY()};
      for(const cell of game.cells(ghost)) tile(ctx,cell.x*30,cell.y*30,30,COLORS[game.active.type],true);
      for(const cell of game.cells()) tile(ctx,cell.x*30,cell.y*30,30,COLORS[game.active.type]);
    }
    if(now < trailUntil && !reducedMotion) { ctx.fillStyle=`rgba(226,242,190,${(trailUntil-now)/160*.15})`; for(const cell of trail) ctx.fillRect(cell.x*30,Math.max(0,cell.y*30-150),30,150); }
    if(now < flashUntil) {ctx.fillStyle=`rgba(237,250,200,${(flashUntil-now)/200*.8})`;for(const row of flashRows)ctx.fillRect(0,row*30,300,30);}
    effects=effects.filter(p=>p.age<.6); for(const p of effects){p.age+=dt/1000;p.x+=p.vx*dt/1000;p.y+=p.vy*dt/1000;p.vy+=350*dt/1000;ctx.globalAlpha=1-p.age/.6;ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,4,4);}ctx.globalAlpha=1;
    $('toast').classList.toggle('show',now<toastUntil && game.status==='running');
    renderPreview($('next'),game.next.length?game.next.slice(0,3):['T','S','I']);
    renderPreview($('hold'),[game.held],game.holdUsed); renderPreview($('mobile-hold'),[game.held],game.holdUsed);
  }
  function newGame(seed) {
    clearInputs(); stopAudio(); fixture=null; effects=[]; trail=[]; flashUntil=toastUntil=0; timeline=[];
    game.start(seed); processEvents(); previousFrame=performance.now(); board.focus({preventScroll:true});
  }
  function action(name) {
    if (game.status !== 'running') return;
    if(name==='left')game.move(-1); if(name==='right')game.move(1); if(name==='down')game.step(true);
    if(name==='rotate')game.rotate(1); if(name==='counter')game.rotate(-1); if(name==='drop')game.hardDrop(); if(name==='hold')game.hold();
    processEvents();
  }
  function pause() { game.pause(); clearInputs(); processEvents(); previousFrame=performance.now(); }
  function clearInputs() { heldInputs.clear(); }
  function beginInput(key,name) {
    if(heldInputs.has(key))return;
    heldInputs.set(key,{name,next:performance.now()+(name==='down'?45:145)}); action(name);
  }
  function repeatInputs(now) {
    for(const input of heldInputs.values()) if(['left','right','down'].includes(input.name) && now>=input.next) {
      action(input.name); input.next=now+(input.name==='down'?38:45);
    }
  }
  const keys={ArrowLeft:'left',ArrowRight:'right',ArrowDown:'down',ArrowUp:'rotate',KeyX:'rotate',KeyZ:'counter',Space:'drop',KeyC:'hold',ShiftLeft:'hold',ShiftRight:'hold'};
  document.addEventListener('keydown',event=>{
    if($('help-dialog').open)return;
    if(['KeyP','Escape'].includes(event.code)){event.preventDefault();if(!event.repeat)pause();return;}
    if(event.target instanceof HTMLButtonElement && ['Space','Enter'].includes(event.code))return;
    const name=keys[event.code]; if(!name)return;event.preventDefault();if(event.repeat)return;
    audioUnlock();beginInput(event.code,name);
  });
  document.addEventListener('keyup',event=>{heldInputs.delete(event.code);});
  document.querySelectorAll('[data-action]').forEach(button=>{
    button.addEventListener('pointerdown',event=>{event.preventDefault();audioUnlock();button.setPointerCapture(event.pointerId);beginInput('pointer'+event.pointerId,button.dataset.action);});
    const release=event=>{heldInputs.delete('pointer'+event.pointerId);};
    button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
    button.addEventListener('click',event=>{if(event.detail===0){audioUnlock();action(button.dataset.action);}});
  });
  $('play').addEventListener('click',()=>{audioUnlock();if(game.status==='paused')pause();else newGame();board.focus({preventScroll:true});});
  $('restart').addEventListener('click',()=>{audioUnlock();newGame();});
  $('pause').addEventListener('click',()=>{audioUnlock();pause();if(game.status==='running')board.focus({preventScroll:true});});
  $('sound').addEventListener('click',()=>{muted=!muted;store.write('muted',muted);if(muted)stopAudio();else audioUnlock();updateHUD();if(game.status==='running')board.focus({preventScroll:true});});
  function backgroundPause(){clearInputs();if(game.status==='running')pause();stopAudio();}
  window.addEventListener('blur',backgroundPause);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)backgroundPause();});
  $('help').addEventListener('click',()=>{pausedForHelp=game.status==='running';if(pausedForHelp)pause();$('help-dialog').showModal();});
  function closeHelp(){ $('help-dialog').close(); }
  $('close-help').addEventListener('click',closeHelp);$('help-done').addEventListener('click',closeHelp);
  $('help-dialog').addEventListener('close',()=>{if(pausedForHelp){pausedForHelp=false;board.focus({preventScroll:true});} });

  // Visible diagnostic controls only at ?qa=1. Synthetic scenarios never affect the best score.
  if(qa){
    $('qa-panel').hidden=false;$('qa-panel').open=true;
    $('qa-cleanup').addEventListener('click',()=>{
      clearInputs();stopAudio();Object.assign(game,new Game());fixture=null;timeline=[];effects=[];
      best=0;muted=false;store.write('best',0);store.write('muted',false);lastState='';updateHUD();
    });
    document.querySelectorAll('[data-fixture]').forEach(button=>button.addEventListener('click',()=>{
      audioUnlock();newGame(20260831);fixture=button.dataset.fixture;
      game.board=Array.from({length:20},()=>Array(10).fill(null));
      if(fixture==='four'){
        for(let y=16;y<20;y++)game.board[y]=Array.from({length:10},(_,x)=>x===4?null:['J','S','L','T'][y-16]);
        game.spawn('I');game.active.matrix=rotated(SHAPES.I,1);game.active.rotation=1;game.active.x=2;game.active.y=-1;
      }else if(fixture==='over'){
        for(let x=3;x<7;x++)game.board[0][x]='J';game.spawn('O');game.active.y=-2;game.status='running';
      }else{
        game.board[19]=Array.from({length:10},(_,x)=>x===4||x===5?null:(x%2?'S':'J'));game.spawn('O');game.active.x=4;game.active.y=-1;
        if(fixture==='level'){game.lines=9;game.level=1;}
      }
      game.events=[];timeline=[];lastState='';updateHUD();board.focus({preventScroll:true});
    }));
  }
  window.render_game_to_text=()=>JSON.stringify(game.snapshot());
  function frame(now){
    const dt=Math.max(0,Math.min(100,now-previousFrame));previousFrame=now;
    if(game.status==='running'){repeatInputs(now);game.tick(dt);if(game.events.length)processEvents();}
    if(now-lastHUD>100){updateHUD();lastHUD=now;}
    render(now,dt);requestAnimationFrame(frame);
  }
  updateHUD();requestAnimationFrame(frame);
})();
