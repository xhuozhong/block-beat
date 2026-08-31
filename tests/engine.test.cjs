const test = require('node:test');
const assert = require('node:assert/strict');
const {Game, Bag, SHAPES, rotated} = require('../engine.js');
const create = () => { const game = new Game(); game.start(20260831); game.drain(); return game; };
function scenario(rows, lines=0) {
  const game = create();
  for (let y=20-rows;y<20;y++) game.board[y] = Array.from({length:10},(_,x)=>x===4?null:'J');
  game.spawn('I'); game.active.matrix=rotated(SHAPES.I,1);game.active.x=2;game.active.y=-1;game.active.rotation=1;
  game.lines=lines;game.level=Math.floor(lines/10)+1;game.drain();return game;
}
test('each seven-piece bag contains every kind exactly once across 100 bags',()=>{
  const bag = new Bag(19);
  for(let i=0;i<100;i++)assert.deepEqual(Array.from({length:7},()=>bag.next()).sort(),Object.keys(SHAPES).sort());
});
test('same seed and input trace reproduce score and board',()=>{
  const a=create(), b=create();
  for(const game of [a,b])for(let i=0;i<20;i++){game.move(i%2?1:-1);game.rotate();game.tick(80);game.hardDrop();game.drain();}
  assert.deepEqual(a.snapshot(),b.snapshot());
});
test('all four rotations restore each shape',()=>{
  for(const shape of Object.values(SHAPES)){let m=shape;for(let i=0;i<4;i++)m=rotated(m,1);assert.deepEqual(m,shape);assert.deepEqual(rotated(rotated(shape,1),-1),shape);}
});
test('pieces cannot cross left/right walls or floor',()=>{
  const game=create();for(let i=0;i<20;i++)game.move(-1);assert(game.cells().every(c=>c.x>=0));assert.equal(game.move(-1),false);
  for(let i=0;i<20;i++)game.move(1);assert(game.cells().every(c=>c.x<10));assert.equal(game.move(1),false);
  while(game.step());assert(game.cells().every(c=>c.y<20));assert.equal(game.step(),false);
});
test('simplified wall kick keeps a rotated I inside board',()=>{
  const game=create();game.spawn('I');game.rotate();while(game.move(-1));assert.equal(game.rotate(),true);assert(game.cells().every(c=>c.x>=0&&c.x<10));
});
test('rotation is rejected when all kick positions are blocked',()=>{
  const game=create();game.spawn('T');game.active.y=6;
  game.board=Array.from({length:20},()=>Array(10).fill('O'));
  for(const c of game.cells())game.board[c.y][c.x]=null;
  const original=JSON.stringify(game.active);assert.equal(game.rotate(),false);assert.equal(JSON.stringify(game.active),original);
});
for(const rows of [1,2,3,4])test(`${rows}-line clear awards correct points once and collapses board`,()=>{
  const game=scenario(rows),distance=game.ghostY()-game.active.y,pieceId=game.active.id;
  game.hardDrop();const events=game.drain(),clears=events.filter(e=>e.type==='clear');
  assert.equal(game.score,distance*2+[0,100,300,500,800][rows]);assert.equal(game.lines,rows);
  assert.equal(clears.length,1);assert.equal(clears[0].pieceId,pieceId);assert.equal(clears[0].count,rows);
  assert.equal(game.board.flat().filter(Boolean).length,4-rows);assert.equal(game.board.length,20);
  const score=game.score;game.tick(400);assert.equal(game.score,score);assert.equal(game.drain().filter(e=>e.type==='clear').length,0);
});
test('score ledger equals all drop and clear rewards',()=>{
  const game=scenario(4,10);game.step(true);game.step(true);game.hardDrop();
  const rewards=game.drain().filter(e=>['soft','drop','clear'].includes(e.type)).reduce((total,e)=>total+e.points,0);
  assert.equal(game.score,rewards);assert.equal(game.lines,14);assert.equal(game.level,2);
});
test('crossing ten lines increases level after applying old-level clear score',()=>{
  const game=scenario(1,9),distance=game.ghostY()-game.active.y;game.hardDrop();
  assert.equal(game.level,2);assert.equal(game.lines,10);assert.equal(game.score,100+distance*2);assert.equal(game.interval,640);
});
test('soft drop grants one point per cell and none when blocked',()=>{
  const game=create(),startY=game.active.y;let moved=0;while(game.step(true))moved++;
  assert.equal(game.score,moved);assert.equal(game.active.y-startY,moved);game.step(true);assert.equal(game.score,moved);
});
test('hold is allowed once per falling piece and resets on lock',()=>{
  const game=create(),first=game.active.type,next=game.next[0];assert.equal(game.hold(),true);
  assert.equal(game.held,first);assert.equal(game.active.type,next);const current=game.active.id;
  assert.equal(game.hold(),false);assert.equal(game.active.id,current);game.hardDrop();assert.equal(game.holdUsed,false);assert.equal(game.hold(),true);assert.equal(game.active.type,first);
});
test('swapping held piece does not consume preview and resets rotation',()=>{
  const game=create();game.hold();game.hardDrop();game.rotate();const next=game.next.slice();game.hold();assert.deepEqual(game.next,next);assert.equal(game.active.rotation,0);
});
test('paused game rejects all movement, score changes and timer updates',()=>{
  const game=create();game.tick(200);game.pause();game.drain();const snapshot=game.snapshot();
  game.tick(1000);game.move(1);game.rotate();game.step(true);game.hardDrop();game.hold();assert.deepEqual(game.snapshot(),snapshot);
  game.pause();game.tick(100);assert.equal(game.elapsed,300);
});
test('grounded pieces lock at 450ms, never one tick early',()=>{
  const game=create();game.spawn('O');game.active.y=18;const id=game.active.id;
  game.tick(449);assert.equal(game.active.id,id);game.tick(1);assert.notEqual(game.active.id,id);assert.equal(game.board.flat().filter(Boolean).length,4);
});
test('lock delay cannot be reset by unlimited side-to-side moves',()=>{
  const game=create();game.spawn('O');game.active.y=18;const id=game.active.id;
  for(let i=0;i<15;i++){game.tick(440);assert.equal(game.active.id,id);assert(game.move(i%2?-1:1));}
  assert.equal(game.resets,15);game.tick(440);game.move(-1);game.tick(10);assert.notEqual(game.active.id,id);
});
test('spawn collision ends game and no later input can score',()=>{
  const game=create();game.board[0].fill('J');game.spawn('O');assert.equal(game.status,'over');
  const score=game.score;game.hardDrop();game.step(true);game.tick(1000);assert.equal(game.score,score);
});
test('lock-out above top does not partially write an invalid piece',()=>{
  const game=create();game.spawn('O');game.active.y=-1;game.board[1].fill('J');const before=JSON.stringify(game.board);
  game.hardDrop();assert.equal(game.status,'over');assert.equal(JSON.stringify(game.board),before);
});
test('restart clears hold, board, score, pause and piece lifecycle',()=>{
  const game=scenario(4);game.hardDrop();game.hold();game.pause();game.start(20260831);
  assert.equal(game.score,0);assert.equal(game.lines,0);assert.equal(game.held,null);assert.equal(game.holdUsed,false);assert.equal(game.status,'running');assert.equal(game.active.id,1);assert(game.board.flat().every(c=>c===null));
});
test('bad timing input is ignored and long background gaps are capped',()=>{
  const game=create();for(const value of [NaN,Infinity,-1,0])game.tick(value);assert.equal(game.elapsed,0);game.tick(100000);assert.equal(game.elapsed,1000);
});
