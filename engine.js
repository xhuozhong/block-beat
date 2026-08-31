(function (root) {
  'use strict';
  const SHAPES = {
    I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    O: [[1,1],[1,1]],
    T: [[0,1,0],[1,1,1],[0,0,0]],
    J: [[1,0,0],[1,1,1],[0,0,0]],
    L: [[0,0,1],[1,1,1],[0,0,0]],
    S: [[0,1,1],[1,1,0],[0,0,0]],
    Z: [[1,1,0],[0,1,1],[0,0,0]]
  };
  const copy = matrix => matrix.map(row => row.slice());
  function random(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let t = value;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  class Bag {
    constructor(seed) { this.rng = random(seed); this.items = []; }
    next() {
      if (!this.items.length) {
        this.items = Object.keys(SHAPES);
        for (let i = 6; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
        }
      }
      return this.items.pop();
    }
  }
  function rotated(matrix, direction) {
    const n = matrix.length;
    return matrix.map((row, y) => row.map((_, x) => direction > 0 ? matrix[n-1-x][y] : matrix[x][n-1-y]));
  }
  class Game {
    constructor() {
      this.status = 'ready'; this.board = Array.from({length:20}, () => Array(10).fill(null));
      this.active = null; this.next = []; this.held = null; this.holdUsed = false;
      this.score = 0; this.lines = 0; this.level = 1; this.elapsed = 0;
      this.events = []; this.eventId = 0; this.pieceId = 0; this.lastClear = 0;
      this.gravity = 0; this.grounded = 0; this.resets = 0;
    }
    start(seed = Date.now()) {
      Object.assign(this, new Game()); this.seed = seed >>> 0;
      this.bag = new Bag(this.seed); this.status = 'running';
      while (this.next.length < 5) this.next.push(this.bag.next());
      this.spawn(); this.emit('start');
    }
    emit(type, data = {}) { this.events.push({id:++this.eventId, type, pieceId:this.active?.id, ...data}); }
    drain() { return this.events.splice(0); }
    get interval() { return Math.max(80, 800 * Math.pow(.8, this.level - 1)); }
    cells(piece = this.active, matrix = piece?.matrix) {
      if (!piece) return [];
      return matrix.flatMap((row,y) => row.flatMap((value,x) => value ? [{x:piece.x+x,y:piece.y+y}] : []));
    }
    fits(matrix, x, y) {
      return matrix.every((row,dy) => row.every((value,dx) => !value || (
        x+dx >= 0 && x+dx < 10 && y+dy >= -4 && y+dy < 20 && (y+dy < 0 || !this.board[y+dy][x+dx])
      )));
    }
    spawn(type) {
      const kind = type || this.next.shift();
      while (this.next.length < 5) this.next.push(this.bag.next());
      const matrix = copy(SHAPES[kind]);
      this.active = {type:kind, matrix, x:Math.floor((10-matrix.length)/2), y:-1, rotation:0, id:++this.pieceId};
      this.gravity = 0; this.grounded = 0; this.resets = 0;
      if (!this.fits(matrix, this.active.x, this.active.y)) this.end();
    }
    end() { this.status = 'over'; this.emit('over', {score:this.score}); }
    isGrounded() { return this.active && !this.fits(this.active.matrix, this.active.x, this.active.y + 1); }
    resetLock(wasGrounded) {
      if (wasGrounded && this.resets < 15) { this.grounded = 0; this.resets++; }
    }
    move(dx) {
      if (this.status !== 'running') return false;
      const p = this.active, was = this.isGrounded();
      if (!this.fits(p.matrix, p.x+dx, p.y)) return false;
      p.x += dx; this.resetLock(was); this.emit('move'); return true;
    }
    rotate(direction = 1) {
      if (this.status !== 'running' || this.active.type === 'O') return false;
      const p = this.active, matrix = rotated(p.matrix, direction), was = this.isGrounded();
      const kicks = [[0,0],[-1,0],[1,0],[-2,0],[2,0],[0,-1],[-1,-1],[1,-1],[0,-2]];
      for (const [dx,dy] of kicks) {
        if (!this.fits(matrix,p.x+dx,p.y+dy)) continue;
        p.matrix = matrix; p.x += dx; p.y += dy; p.rotation = (p.rotation + direction + 4) % 4;
        this.resetLock(was); this.emit('rotate'); return true;
      }
      return false;
    }
    step(soft = false) {
      if (this.status !== 'running') return false;
      const p = this.active;
      if (!this.fits(p.matrix,p.x,p.y+1)) return false;
      p.y++; this.grounded = 0;
      if (soft) { this.score++; this.emit('soft', {points:1}); this.gravity = 0; }
      return true;
    }
    ghostY() {
      if (!this.active) return 0;
      let y = this.active.y;
      while (this.fits(this.active.matrix,this.active.x,y+1)) y++;
      return y;
    }
    hardDrop() {
      if (this.status !== 'running') return false;
      const from = this.active.y, to = this.ghostY(), distance = to-from;
      this.active.y = to; this.score += distance*2;
      this.emit('drop', {distance, points:distance*2, cells:this.cells()}); this.lock(); return true;
    }
    hold() {
      if (this.status !== 'running' || this.holdUsed) return false;
      const previous = this.held; this.held = this.active.type;
      this.spawn(previous || undefined); this.holdUsed = true;
      this.emit('hold'); return true;
    }
    lock() {
      if (this.status !== 'running') return;
      const p = this.active, cells = this.cells();
      // Lock-out is evaluated before writing to avoid partially placing an invalid piece.
      if (cells.some(cell => cell.y < 0)) { this.end(); return; }
      for (const cell of cells) this.board[cell.y][cell.x] = p.type;
      this.emit('lock', {cells, color:p.type});
      const rows = this.board.flatMap((row,y) => row.every(Boolean) ? [y] : []);
      this.lastClear = rows.length;
      if (rows.length) {
        const points = [0,100,300,500,800][rows.length] * this.level;
        this.board = this.board.filter((_,y) => !rows.includes(y));
        while (this.board.length < 20) this.board.unshift(Array(10).fill(null));
        this.score += points; this.lines += rows.length;
        const previousLevel = this.level; this.level = Math.floor(this.lines/10)+1;
        this.emit('clear', {count:rows.length, rows, points, score:this.score});
        if (this.level > previousLevel) this.emit('level', {level:this.level});
      }
      this.holdUsed = false; this.spawn();
    }
    pause() {
      if (this.status === 'running') { this.status = 'paused'; this.emit('pause'); }
      else if (this.status === 'paused') { this.status = 'running'; this.emit('resume'); }
    }
    tick(dt) {
      if (this.status !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
      // Bounded simulation steps preserve lock timing across frame rates and avoid runaway catch-up.
      let remaining = Math.min(dt,1000);
      while (remaining > 0 && this.status === 'running') {
        const slice = Math.min(10, remaining); remaining -= slice; this.elapsed += slice;
        this.gravity += slice;
        while (this.gravity >= this.interval) { this.gravity -= this.interval; if (!this.step()) break; }
        if (this.isGrounded()) { this.grounded += slice; if (this.grounded >= 450) this.lock(); }
      }
    }
    snapshot() {
      return {status:this.status, score:this.score, lines:this.lines, level:this.level, elapsed:Math.floor(this.elapsed),
        held:this.held, holdUsed:this.holdUsed, next:this.next.slice(0,3), seed:this.seed,
        active:this.active ? {type:this.active.type, x:this.active.x, y:this.active.y, rotation:this.active.rotation,
          id:this.active.id, cells:this.cells(), ghostY:this.ghostY()} : null,
        board:this.board.map(row => row.map(cell => cell || '.').join('')), lastClear:this.lastClear};
    }
  }
  const api = {Game, Bag, SHAPES, rotated};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BlockEngine = api;
})(typeof window !== 'undefined' ? window : this);
