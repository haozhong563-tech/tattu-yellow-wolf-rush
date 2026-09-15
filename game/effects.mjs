import Phaser from 'phaser';

const BOARD = { left: 56, right: 664, top: 295, bottom: 979 };
const WHITE = 0xffffff;
const GOLD = 0xffdc55;
const CYAN = 0x65eaff;
const PREFIX = 'tata-fx-';
const LIMIT = 320;
const DECORATION_LIMIT = 264;

/** Short, cell-local effects. All objects are owned by this helper. */
export class Effects {
  constructor(scene, { reduced = false } = {}) {
    this.scene = scene;
    this.reduced = reduced;
    this.nodes = new Set();
    this.jobs = new Set();
    this.dead = false;
    this.lastBeat = -1000;
    this.lastShake = -1000;
    this._textures();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  _textures() {
    const scene = this.scene;
    const draw = (name, size, painter) => {
      if (scene.textures.exists(PREFIX + name)) return;
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      painter(g, size);
      g.generateTexture(PREFIX + name, size, size);
      g.destroy();
    };
    draw('star', 40, g => {
      g.fillStyle(WHITE, 1);
      g.beginPath();
      [[20, 0], [25, 14], [40, 20], [25, 25], [20, 40], [14, 25], [0, 20], [14, 14]].forEach(([x, y], i) => {
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.closePath(); g.fillPath();
    });
    draw('dot', 24, g => {
      g.fillStyle(WHITE, 1); g.fillCircle(12, 12, 9);
    });
    draw('shard', 32, g => {
      g.fillStyle(WHITE, 1);
      g.fillTriangle(5, 1, 29, 10, 10, 31);
    });
    draw('glow', 96, g => {
      for (let r = 46; r >= 2; r -= 2) {
        g.fillStyle(WHITE, .018 + .035 * (1 - r / 46));
        g.fillCircle(48, 48, r);
      }
    });
    draw('ring', 128, g => {
      g.lineStyle(5, WHITE, .17); g.strokeCircle(64, 64, 56);
      g.lineStyle(2.5, WHITE, 1); g.strokeCircle(64, 64, 54);
    });
    draw('confetti', 24, g => {
      g.fillStyle(WHITE, 1); g.fillRoundedRect(4, 1, 16, 22, 3);
    });
    draw('rim', 128, g => {
      g.lineStyle(9, WHITE, 1); g.strokeCircle(64, 64, 54);
    });
    draw('smoke', 96, g => {
      for (let r = 44; r >= 6; r -= 3) {
        g.fillStyle(WHITE, .026);
        g.fillCircle(47, 51, r);
        g.fillCircle(33, 38, r * .62);
        g.fillCircle(62, 37, r * .6);
      }
    });
    draw('streak', 64, g => {
      g.fillStyle(WHITE, 1); g.fillTriangle(1, 32, 63, 27, 63, 37);
    });
  }

  _color(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const hex = value.replace('#', '');
      const parsed = Number.parseInt(hex.length === 3 ? [...hex].map(c => c + c).join('') : hex, 16);
      return Number.isFinite(parsed) ? parsed : GOLD;
    }
    return GOLD;
  }

  _own(node, critical = true) {
    if (this.dead) { node.destroy(); return null; }
    if (this.nodes.size >= LIMIT) {
      const oldest = [...this.nodes].find(item => !item._fxCritical) ?? this.nodes.values().next().value;
      for (const job of [...this.jobs]) if (job.node === oldest) { job.cancelled = true; job.tween?.stop(); job.finish(); }
      this._remove(oldest);
    }
    node._fxCritical = critical;
    this.nodes.add(node);
    node.setDepth(80);
    return node;
  }

  _sprite(name, x, y, color = WHITE, scale = 1, additive = true, critical = false) {
    if (this.dead || (!critical && this.nodes.size >= DECORATION_LIMIT)) return null;
    const node = this._own(this.scene.add.image(x, y, PREFIX + name), critical);
    node.setTint(this._color(color)).setScale(scale);
    if (additive) node.setBlendMode(Phaser.BlendModes.ADD);
    return node;
  }

  _remove(node) {
    if (!node) return;
    this.nodes.delete(node);
    if (node.scene) node.destroy();
  }

  _animate(node, config, dispose = true) {
    if (!node || this.dead) return Promise.resolve();
    return new Promise(resolve => {
      let finished = false;
      const job = { finish: null, tween: null, node };
      job.finish = () => {
        if (finished) return;
        finished = true;
        this.jobs.delete(job);
        if (dispose || this.dead) this._remove(node);
        resolve();
      };
      this.jobs.add(job);
      job.tween = this.scene.tweens.add({ targets: node, ...config, onComplete: job.finish });
    });
  }

  _ring(x, y, color, size = 1, duration = 340, delay = 0, critical = false) {
    const rim = this._sprite('rim', x, y, 0x264b5d, .08, false, critical);
    const ring = this._sprite('ring', x, y, color, .08, false, critical);
    rim?.setAlpha(.48);
    return Promise.all([rim, ring].map(node => this._animate(node, { scale: size, alpha: 0, duration, delay, ease: 'Cubic.Out' })));
  }

  _shake(duration = 120, intensity = .003) {
    if (this.reduced || this.dead || this.scene.time.now - this.lastShake < 180) return;
    this.lastShake = this.scene.time.now;
    this.scene.cameras.main.shake(Math.min(170, duration), Math.min(.004, intensity));
  }

  _smoke(x, y, color = 0x537e88, scale = 1, count = 5) {
    const jobs = [];
    for (let i = 0; i < (this.reduced ? 2 : count); i++) {
      const angle = i / count * Math.PI * 2;
      const puff = this._sprite('smoke', x + Math.cos(angle) * 12, y + Math.sin(angle) * 12, color, .2 * scale, false);
      if (!puff) break;
      puff.setAlpha(.35);
      jobs.push(this._animate(puff, { x: x + Math.cos(angle) * 72 * scale, y: y + Math.sin(angle) * 34 * scale - 25, scale: .9 * scale, alpha: 0, duration: this.reduced ? 220 : 640, ease: 'Cubic.Out' }));
    }
    return Promise.all(jobs);
  }

  _radial(x, y, color, radius = 160, count = 12) {
    const jobs = [];
    const amount = this.reduced ? Math.min(4, count) : count;
    for (let i = 0; i < amount; i++) {
      const angle = i / amount * Math.PI * 2 + .11;
      const streak = this._sprite('streak', x + Math.cos(angle) * 10, y + Math.sin(angle) * 10, color, 1, false);
      if (!streak) break;
      streak.setRotation(angle).setScale(.25, .55).setAlpha(.92);
      jobs.push(this._animate(streak, { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius, scaleX: 1.3, scaleY: 0, alpha: 0, duration: 340, ease: 'Cubic.Out' }));
    }
    return Promise.all(jobs);
  }

  _lightning(from, to, color = CYAN, width = 3, duration = 340) {
    if (this.dead) return Promise.resolve();
    const line = this._own(this.scene.add.graphics());
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1;
    const count = Math.max(3, Math.min(12, Math.ceil(length / 34)));
    const points = Array.from({ length: count + 1 }, (_, i) => {
      const offset = i && i < count ? (i % 2 ? 1 : -1) * (8 + Math.random() * 14) : 0;
      return { x: from.x + dx * i / count - dy / length * offset, y: from.y + dy * i / count + dx / length * offset };
    });
    for (const [size, tint, alpha] of [[width * 3.6, 0x244354, .7], [width * 2, color, 1], [Math.max(1.2, width * .5), 0xffffe5, 1]]) {
      line.lineStyle(size, tint, alpha); line.beginPath();
      points.forEach((point, i) => { if (i) line.lineTo(point.x, point.y); else line.moveTo(point.x, point.y); });
      line.strokePath();
    }
    return this._animate(line, { alpha: 0, delay: 40, duration: this.reduced ? 130 : duration, ease: 'Cubic.In' });
  }

  burst(x, y, color = GOLD, scale = 1) {
    if (this.dead) return Promise.resolve();
    const tint = this._color(color);
    const jobs = [];
    const flash = this._sprite('glow', x, y, WHITE, .25 * scale);
    jobs.push(this._animate(flash, { scale: 1.15 * scale, alpha: 0, duration: 180, ease: 'Cubic.Out' }));
    jobs.push(this._ring(x, y, tint, .58 * scale, 300));
    const count = this.reduced ? 3 : 10;
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2 + .2;
      const distance = (30 + Math.random() * 42) * scale;
      const star = this._sprite(i % 3 === 0 ? 'star' : i % 3 === 1 ? 'shard' : 'dot', x, y, i % 3 === 0 ? WHITE : tint, (.12 + Math.random() * .21) * scale, i % 3 !== 1);
      if (!star) break;
      star.setAngle(Math.random() * 180);
      jobs.push(this._animate(star, {
        x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance + 16,
        scale: 0, alpha: 0, angle: star.angle + 90, duration: 280 + Math.random() * 160,
        ease: 'Cubic.Out',
      }));
    }
    return Promise.all(jobs);
  }

  beam(x, y, orientation = 'row') {
    if (this.dead) return Promise.resolve();
    const row = orientation !== 'column';
    const ends = row ? [[BOARD.left, y], [BOARD.right, y]] : [[x, BOARD.top], [x, BOARD.bottom]];
    const jobs = [this.burst(x, y, CYAN, 1.45), this._ring(x, y, GOLD, 1.25, 360, 0, true)];
    for (const [endX, endY] of ends) {
      const length = Math.hypot(endX - x, endY - y);
      const angle = Math.atan2(endY - y, endX - x);
      for (const [height, tint, opacity, additive] of [[42, 0x184456, .58, false], [28, 0x30bad9, .94, false], [13, 0xbaf9f2, .95, false], [4, WHITE, .95, true]]) {
        const ray = this._own(this.scene.add.rectangle(x, y, length, height, tint, 1));
        ray.setOrigin(0, .5).setRotation(angle).setScale(.01, 1).setAlpha(opacity);
        if (additive) ray.setBlendMode(Phaser.BlendModes.ADD);
        jobs.push(this._animate(ray, {
          scaleX: { from: .01, to: 1, duration: this.reduced ? 60 : 110 },
          scaleY: { from: 1, to: .2, duration: 220, delay: 80 },
          alpha: { from: opacity, to: 0, duration: 230, delay: this.reduced ? 30 : 80 },
          duration: 310, ease: 'Cubic.Out',
        }));
      }
      jobs.push(this._lightning({ x, y }, { x: endX, y: endY }, GOLD, 2.4, 370));
      if (!this.reduced) for (let n = 1; n <= Math.min(7, Math.ceil(length / 65)); n++) {
        const t = n / Math.max(1, Math.ceil(length / 65));
        const spark = this._sprite('star', x + (endX - x) * t, y + (endY - y) * t, WHITE, .12);
        jobs.push(this._animate(spark, { scale: .48, angle: 90, alpha: 0, duration: 230, delay: n * 14, ease: 'Cubic.Out' }));
      }
    }
    this._smoke(x, y, 0x416c81, 1.15, 4);
    this._shake(100, .0027);
    return Promise.all(jobs);
  }

  nova(x, y, targets = []) {
    if (this.dead) return Promise.resolve();
    const jobs = [this._ring(x, y, GOLD, 2.7, 480, 0, true), this._ring(x, y, CYAN, 2, 420, 60, true), this._radial(x, y, 0xb98cff, 210, 18), this.burst(x, y, GOLD, 2.1)];
    const max = this.reduced ? 8 : 30;
    const stride = Math.max(1, Math.ceil(targets.length / max));
    targets.filter((_, i) => i % stride === 0).slice(0, max).forEach((target, i) => {
      jobs.push(this._lightning({ x, y }, target, [GOLD, CYAN, 0xbd98ff][i % 3], 2, 340 + i * 5));
      const spark = this._sprite('star', target.x, target.y, GOLD, .2, false);
      jobs.push(this._animate(spark, { scale: .75, angle: 100, alpha: 0, delay: 60 + i * 7, duration: 260, ease: 'Cubic.Out' }));
    });
    this._smoke(x, y, 0x7571a2, 1.65, 6);
    this._shake(155, .0037);
    return Promise.all(jobs);
  }

  bomb(x, y) {
    if (this.dead) return Promise.resolve();
    const flash = this._sprite('glow', x, y, 0xffd48b, .2, false, true);
    this._shake(130, .0035);
    this._smoke(x, y, 0x7a7268, 1.65, 7);
    return Promise.all([
      this._animate(flash, { scale: this.reduced ? 1.6 : 2.9, alpha: 0, duration: 280, ease: 'Cubic.Out' }),
      this._ring(x, y, 0xffb957, 2.6, 440, 0, true), this._ring(x, y, 0xfff4bc, 1.9, 350, 35, true),
      this._radial(x, y, 0xf09a53, 185, 16), this.burst(x, y, 0xff996c, 2.05),
    ]);
  }

  /** A brief readable anticipation before a special or rewarded board attack. */
  windup(x, y, type = 'hammer') {
    if (this.dead) return Promise.resolve();
    const color = /rift|nova|portal|rainbow/.test(type) ? 0xb994ff : /drone|beam|column/.test(type) ? CYAN : GOLD;
    const duration = this.reduced ? 70 : 170;
    const jobs = [];
    for (const [size, tint, angle] of [[1.45, 0x344759, .1], [1.18, color, -.2]]) {
      const ring = this._sprite('ring', x, y, tint, size, false, true);
      ring.setAlpha(.9).setRotation(angle);
      jobs.push(this._animate(ring, { scale: .15, alpha: .1, rotation: angle + .8, duration, ease: 'Cubic.In' }));
    }
    const count = this.reduced ? 4 : 14;
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2, distance = 55 + (i % 3) * 23;
      const mote = this._sprite(i % 3 ? 'dot' : 'star', x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, color, i % 3 ? .18 : .3, false);
      jobs.push(this._animate(mote, { x, y, scale: .05, alpha: .3, duration, ease: 'Cubic.In' }));
    }
    return Promise.all(jobs);
  }

  // Alias for scene choreography that calls a charge before its own portrait cut-in.
  charge(x, y, type = 'hammer') { return this.windup(x, y, type); }

  _cracks(x, y, power = 1) {
    if (this.dead) return Promise.resolve();
    const cracks = this._own(this.scene.add.graphics());
    const branches = this.reduced ? 4 : 8;
    const paths = Array.from({ length: branches }, (_, i) => {
      const a = i / branches * Math.PI * 2 + .21;
      const length = (60 + i % 3 * 19) * power;
      return [
        { x, y },
        { x: x + Math.cos(a) * length * .28, y: y + Math.sin(a) * length * .18 },
        { x: x + Math.cos(a + .22) * length * .61, y: y + Math.sin(a + .22) * length * .42 },
        { x: x + Math.cos(a) * length, y: y + Math.sin(a) * length * .72 },
      ];
    });
    for (const [width, tint, alpha] of [[7, 0x334856, .86], [3, 0xffc65b, 1], [1, 0xffffcb, 1]]) {
      cracks.lineStyle(width, tint, alpha);
      paths.forEach(path => {
        cracks.beginPath(); path.forEach((point, i) => { if (i) cracks.lineTo(point.x, point.y); else cracks.moveTo(point.x, point.y); }); cracks.strokePath();
      });
    }
    return this._animate(cracks, { alpha: 0, duration: this.reduced ? 180 : 440, delay: 70, ease: 'Cubic.In' });
  }

  impact(x, y, type = 'hammer', power = 1) {
    if (this.dead) return Promise.resolve();
    const force = Phaser.Math.Clamp(Number(power) || 1, .6, 2);
    if (/rift|nova|portal|rainbow/.test(type)) return this._rift(x, y, []);
    const drone = /drone|emp/.test(type);
    const color = drone ? CYAN : GOLD;
    const jobs = [
      this._ring(x, y, color, 2.25 * force, 460, 0, true),
      this._ring(x, y, drone ? 0xb4a1ff : 0xfff5ba, 1.6 * force, 370, 65, true),
      this._radial(x, y, drone ? 0x44c5de : 0xeea645, 170 * force, 18),
      this._cracks(x, y, force),
      this.burst(x, y, color, 1.8 * force),
    ];
    if (!drone) jobs.push(this._lightning({ x: x + 25, y: Math.max(BOARD.top - 25, y - 230) }, { x, y }, GOLD, 4.2, 290));
    this._smoke(x, y, drone ? 0x4e8090 : 0x8b7964, 1.8 * force, 8);
    this._shake(145, .0037);
    return Promise.all(jobs);
  }

  _hammer(x, y) {
    const node = this._own(this.scene.add.container(x, y));
    node.setDepth(105);
    const g = this.scene.add.graphics();
    // A physical battery-powered mallet: dark outline, grip, armored head and coil.
    g.fillStyle(0x263e4f).fillRoundedRect(-11, -18, 22, 91, 7);
    g.fillStyle(0xa97942).fillRoundedRect(-7, -14, 14, 84, 4);
    for (let n = 0; n < 5; n++) g.fillStyle(0x375565).fillRoundedRect(-9, 16 + n * 10, 18, 5, 2);
    g.fillStyle(0x243f52).fillRoundedRect(-54, -74, 108, 61, 13);
    g.fillStyle(0xffc344).fillRoundedRect(-48, -68, 96, 49, 9);
    g.fillStyle(0xffe894).fillRoundedRect(-42, -64, 84, 12, 5);
    g.fillStyle(0x416c7b).fillRoundedRect(-51, -64, 20, 39, 5).fillRoundedRect(31, -64, 20, 39, 5);
    g.fillStyle(0x9af3ee).fillRoundedRect(-45, -61, 8, 33, 3).fillRoundedRect(37, -61, 8, 33, 3);
    g.fillStyle(0xfffbd3).fillPoints([{ x: 4, y: -61 }, { x: -12, y: -43 }, { x: -1, y: -43 }, { x: -7, y: -26 }, { x: 14, y: -47 }, { x: 4, y: -47 }], true);
    node.add(g);
    return node;
  }

  _drone(x, y) {
    const node = this._own(this.scene.add.container(x, y));
    node.setDepth(105);
    const g = this.scene.add.graphics();
    g.lineStyle(12, 0x294656).lineBetween(-48, -27, 48, 27).lineBetween(48, -27, -48, 27);
    g.lineStyle(4, 0xffcc55).lineBetween(-48, -27, 48, 27).lineBetween(48, -27, -48, 27);
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const rx = a * 49, ry = b * 29;
      g.fillStyle(0x294858, .6).fillEllipse(rx, ry, 58, 23);
      g.lineStyle(3, 0x8bf2e3, .95).strokeEllipse(rx, ry, 58, 23);
      g.fillStyle(0xcffff8, .7).fillEllipse(rx, ry, 49, 7);
      g.fillStyle(0xffcb54).fillCircle(rx, ry, 7);
    }
    g.fillStyle(0x263e51).fillRoundedRect(-29, -27, 58, 54, 13);
    g.fillStyle(0xf5be42).fillRoundedRect(-24, -23, 48, 42, 10);
    g.fillStyle(0xffeaa3).fillRoundedRect(-19, -19, 38, 10, 4);
    g.fillStyle(0x284957).fillRoundedRect(-13, 7, 26, 21, 7);
    g.fillStyle(0x69e7ed).fillCircle(0, 17, 8);
    g.fillStyle(WHITE).fillCircle(-2, 15, 3);
    node.add(g);
    return node;
  }

  _travel(node, from, to, control, duration, dispose = false) {
    if (!node || this.dead) return Promise.resolve();
    node._travel = 0;
    return this._animate(node, {
      _travel: 1, duration: this.reduced ? Math.min(160, duration) : duration, ease: 'Cubic.InOut',
      onUpdate: () => {
        if (!node.active) return;
        const t = node._travel, a = 1 - t;
        node.setPosition(a * a * from.x + 2 * a * t * control.x + t * t * to.x, a * a * from.y + 2 * a * t * control.y + t * t * to.y);
        node.setRotation(Math.sin(t * Math.PI * 2) * (this.reduced ? .03 : .2));
      },
    }, dispose);
  }

  async _rift(x, y, targets, onImpact, waitForFade = true) {
    if (this.dead) return;
    await this.portalBloom(x,y,1.1);
    if (this.dead) return;
    const hole = this._own(this.scene.add.graphics());
    hole.setPosition(x, y).setDepth(84);
    hole.fillStyle(0x2d3159, .88).fillEllipse(0, 0, 145, 99);
    hole.lineStyle(11, 0x6660bd, 1).strokeEllipse(0, 0, 145, 99);
    hole.lineStyle(4, 0xd4a5ff, 1).strokeEllipse(0, 0, 148, 102);
    hole.lineStyle(2, 0xb6fcf2, 1).strokeEllipse(0, 0, 119, 82);
    const swirl = this._sprite('ring', x, y, 0xaaeeff, .8, false, true);
    if (swirl) { swirl.setScale(.95, .62); this._animate(swirl, { scaleX: .08, scaleY: .06, angle: 135, alpha: 0, duration: 210, ease: 'Cubic.In' }); }
    await this._animate(hole, { scale: .07, rotation: -.65, alpha: .6, duration: this.reduced ? 80 : 220, ease: 'Back.In' });
    if (this.dead) return;
    const fade = this.nova(x, y, targets);
    onImpact?.();
    if (waitForFade) return fade;
  }

  /** Physical reward attacks are visual-only; the scene remains owner of board rules. */
  portalBloom(x,y,power=1) {
    if(this.dead)return Promise.resolve();
    if(this.reduced)return this._ring(x,y,0xd9a7ff,1.35,150,0,true);
    const layer=this._own(this.scene.add.container(x,y));layer.setDepth(85).setScale(.08);
    const core=this.scene.add.graphics();
    for(let r=126;r>8;r-=7)core.fillStyle(0x17172f,r>100?.06:.13).fillCircle(0,0,r);
    core.fillStyle(0x18192d,.82).fillCircle(0,0,79);
    for(let i=9;i>0;i--)core.lineStyle(8,0x6450a8,.04+(9-i)*.025).strokeCircle(0,0,11*i);layer.add(core);
    // An irregular, layered gaseous rim hides geometric endpoints and gives depth.
    const vapor=this.scene.add.graphics();
    for(let i=0;i<30;i++){
      const a=i/30*Math.PI*2,r=107+Math.sin(i*2.7)*7,cx=Math.cos(a)*r,cy=Math.sin(a)*r;
      const size=16+(i%4)*4;
      vapor.fillStyle(0x222244,.55).fillCircle(cx,cy,size+5);
      for(let k=5;k>0;k--)vapor.fillStyle(i%3?0x9980d8:0x6979cd,.085).fillCircle(cx-3,cy-4,size*k/5);
      vapor.fillStyle(0xb2a1f1,.28).fillCircle(cx-7,cy-8,size*.46);
      vapor.fillStyle(0x6d549f,.3).fillCircle(cx+5,cy+7,size*.62);
    }
    layer.add(vapor);
    const corona=this.scene.add.graphics();
    for(let arc=0;arc<5;arc++)for(const [width,tint,alpha] of [[20,0x9278e0,.11],[8,0x9b80f5,.6],[2,0xd5ceff,.96]]){
      corona.lineStyle(width,tint,alpha).beginPath();
      for(let i=0;i<=24;i++){const a=arc*Math.PI*2/5+i/24*.87,r=94+Math.sin(a*9)*3;const px=Math.cos(a)*r,py=Math.sin(a)*r;if(i)corona.lineTo(px,py);else corona.moveTo(px,py);}corona.strokePath();
    }
    layer.add(corona);this.scene.tweens.add({targets:vapor,angle:-23,duration:700});this.scene.tweens.add({targets:corona,angle:44,duration:700});
    const makeSpiral=(color,offset)=>{const g=this.scene.add.graphics();for(let arm=0;arm<3;arm++){for(const [w,c,a]of [[15,0x323154,.9],[8,color,.85],[2,0xeeecff,.95]]){g.lineStyle(w,c,a).beginPath();for(let i=0;i<=45;i++){const t=i/45,angle=offset+arm*Math.PI*2/3+t*3.8,r=15+t*94;const px=Math.cos(angle)*r,py=Math.sin(angle)*r;if(i)g.lineTo(px,py);else g.moveTo(px,py);}g.strokePath();}}return g;};
    const outer=makeSpiral(0xb398ff,0),inner=makeSpiral(0x72dbff,1.2);inner.setScale(.68);layer.add([outer,inner]);
    for(let i=0;i<16;i++){const a=i/16*Math.PI*2,r=112+(i%3)*7,puff=this._sprite('smoke',x+Math.cos(a)*r,y+Math.sin(a)*r, i%2?0xa885d5:0x7277bb,.55,false);if(puff){puff.setAlpha(.58);this._animate(puff,{x:x+Math.cos(a+.35)*r*1.45,y:y+Math.sin(a+.35)*r*1.45,scale:1.08,alpha:0,duration:850,delay:i%3*35,ease:'Sine.Out'});}}
    this.scene.tweens.add({targets:outer,angle:155,duration:680});this.scene.tweens.add({targets:inner,angle:-210,duration:680});
    return this._animate(layer,{scale:power,duration:220,ease:'Back.Out'},false).then(()=>{if(this.dead||!layer.active)return;return this._animate(layer,{scale:.08,alpha:0,angle:50,duration:420,delay:120,ease:'Cubic.In'});});
  }

  obstacleRelease(type,x,y) {
    if(this.dead)return;
    if(type==='prism'){this.portalBloom(x,y,.8);this._radial(x,y,0xcda7ff,190,14);return;}
    if(type==='battery'){for(let i=0;i<6;i++){const a=i/6*Math.PI*2;this._lightning({x,y},{x:x+Math.cos(a)*130,y:y+Math.sin(a)*115},GOLD,3.4,420);}this._ring(x,y,CYAN,2.2,500);return;}
    const color=type==='rock'?0x7d9696:0xc29753;
    for(let i=0;i<(this.reduced?4:10);i++){const a=i/10*Math.PI*2,chunk=this._own(this.scene.add.graphics(),false);chunk.setPosition(x,y);chunk.fillStyle(0x29454d).fillTriangle(-12,-11,16,-4,-1,19);chunk.fillStyle(color).fillTriangle(-8,-9,12,-3,-1,13);const distance=55+(i%4)*24;this._animate(chunk,{x:x+Math.cos(a)*distance,y:y+Math.sin(a)*distance+36,angle:(i%2?1:-1)*160,scale:.1,alpha:0,duration:this.reduced?180:620,ease:'Cubic.Out'});}
    this._smoke(x,y,type==='rock'?0x759391:0xa78b66,1.1,7);this._cracks(x,y,.85);this._ring(x,y,GOLD,1.65,390);this._shake(100,.0027);
  }

  // Incoming projectiles use a readable glowing head and a tapered trail.
  async meteor(from,to) {
    if(this.dead)return;
    const node=this._own(this.scene.add.container(from.x,from.y));node.setDepth(102);const g=this.scene.add.graphics();
    g.fillStyle(0x75374e,.9).fillTriangle(-88,0,0,-19,0,19);g.fillStyle(0xffa941).fillTriangle(-69,0,0,-13,0,13);g.fillStyle(0xffe8a1).fillEllipse(0,0,31,25);g.fillStyle(0xfff7db).fillEllipse(4,-2,18,15);node.add(g);const angle=Math.atan2(to.y-from.y,to.x-from.x);node.setRotation(angle);
    await this._animate(node,{x:to.x,y:to.y,duration:this.reduced?70:190,ease:'Quad.In'});
  }

  async rewardAttack(type, targets = [], onImpact) {
    if (this.dead) return;
    const points = targets.filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
    if (!points.length) return;
    const first = points[0];
    await this.windup(first.x, first.y, type);
    if (this.dead) return;
    if (/rift|nova|portal|rainbow/.test(type)) return this._rift(first.x, first.y, points.slice(1), () => onImpact?.(first, 0, type), false);
    if (/drone|emp/.test(type)) {
      const start = { x: first.x < 360 ? -80 : 800, y: Math.max(180, first.y - 250) };
      return this._droneAttack(start, points, onImpact);
    }
    // One mallet can land on several reward cells in order, with bounded screen time.
    let index = 0;
    for (const target of points.slice(0, this.reduced ? 2 : 4)) {
      if (this.dead) return;
      const hammer = this._hammer(target.x + 80, target.y - 145);
      hammer.setRotation(-.7).setScale(.85);
      await this._animate(hammer, { x: target.x, y: target.y + 44, rotation: .08, scale: 1.08, duration: this.reduced ? 90 : 230, ease: 'Cubic.In' });
      if (this.dead) return;
      this.impact(target.x, target.y, 'hammer', 1.05);
      onImpact?.(target, index++, type);
    }
  }

  async _droneAttack(from, targets, onImpact) {
    if (this.dead || !targets.length) return;
    const target = targets[0], hover = { x: target.x, y: Math.max(210, target.y - 95) };
    const drone = this._drone(from.x, from.y);
    await this._travel(drone, from, hover, { x: 360, y: Math.min(from.y, hover.y) - 120 }, 410);
    if (this.dead || !drone.active) return;
    this._lightning({ x: hover.x, y: hover.y + 24 }, target, CYAN, 3.2, 240);
    for(const [index,point] of targets.slice(0, this.reduced ? 2 : 4).entries()) {
      await this.meteor({x:hover.x,y:hover.y+22},point);if(this.dead)return;
      this.impact(point.x, point.y, 'drone', .95);
      onImpact?.(point, index, 'drone');
    }
    const exit = { x: hover.x < 360 ? 800 : -80, y: hover.y - 190 };
    this._travel(drone, hover, exit, { x: 360, y: hover.y - 250 }, 420, true);
  }

  async droneFlight(from, to) {
    if (this.dead || !from || !to) return;
    await this.windup(to.x, to.y, 'drone');
    if (!this.dead) return this._droneAttack(from, [to]);
  }

  attack(type, targets, onImpact) { return this.rewardAttack(type, targets, onImpact); }

  floatText(text, x, y, color = '#fff', size = 38) {
    if (this.dead || this.nodes.size >= LIMIT) return;
    const label = this._own(this.scene.add.text(x, y, text, {
      fontFamily: 'Microsoft YaHei, Arial, sans-serif', fontSize: `${size}px`, fontStyle: 'bold',
      color, stroke: '#704120', strokeThickness: Math.max(3, size * .13),
      shadow: { offsetX: 0, offsetY: 3, color: '#3f4725', blur: 2, fill: true },
    }));
    label.setOrigin(.5).setDepth(130).setScale(.86);
    this._animate(label, { y: y - (this.reduced ? 20 : 48), scale: 1.04, alpha: 0, duration: 660, ease: 'Cubic.Out' });
  }

  collect(textureKey, x, y, toX, toY, onComplete) {
    if (this.dead) return Promise.resolve();
    if (!this.scene.textures.exists(textureKey)) {
      onComplete?.();
      return Promise.resolve();
    }
    const node = this._own(this.scene.add.image(x, y, textureKey));
    node.setDisplaySize(42, 42).setDepth(110);
    const startScaleX = node.scaleX, startScaleY = node.scaleY;
    const controlX = (x + toX) / 2 + (x > toX ? 70 : -70);
    const controlY = Math.min(y, toY) - 90;
    const state = { t: 0 };
    return new Promise(resolve => {
      let finished = false;
      const job = { tween: null, finish: null, node };
      job.finish = () => {
        if (finished) return;
        finished = true;
        this.jobs.delete(job);
        this._remove(node);
        if (!this.dead && !job.cancelled) {
          this._ring(toX, toY, GOLD, .42, 220);
          onComplete?.();
        }
        resolve();
      };
      this.jobs.add(job);
      job.tween = this.scene.tweens.add({
        targets: state, t: 1, duration: this.reduced ? 180 : 460, ease: 'Cubic.In',
        onUpdate: () => {
          const t = state.t, a = 1 - t;
          node.setPosition(a * a * x + 2 * a * t * controlX + t * t * toX, a * a * y + 2 * a * t * controlY + t * t * toY);
          const size = 1 - t * .34;
          node.setScale(startScaleX * size, startScaleY * size);
        },
        onComplete: job.finish,
      });
    });
  }

  celebrate() {
    if (this.dead) return Promise.resolve();
    const jobs = [];
    const palette = [GOLD, 0xff839c, CYAN, 0x98df79, 0xb99cff, WHITE];
    const count = this.reduced ? 12 : 70;
    for (let i = 0; i < count; i++) {
      const x = 40 + Math.random() * 640;
      const confetti = this._sprite(i % 5 ? 'confetti' : 'star', x, 120 + Math.random() * 220, palette[i % palette.length], .25 + Math.random() * .3, false);
      if (!confetti) break;
      confetti.setDepth(125).setAngle(Math.random() * 360);
      jobs.push(this._animate(confetti, {
        x: x + (Math.random() - .5) * 220, y: 660 + Math.random() * 450,
        angle: confetti.angle + (Math.random() - .5) * 750, alpha: 0,
        duration: this.reduced ? 650 : 1100 + Math.random() * 700, delay: Math.random() * 180,
        ease: 'Quad.In',
      }));
    }
    return Promise.all(jobs);
  }

  rushBeat(strength = 1) {
    if (this.dead || this.scene.time.now - this.lastBeat < 180) return Promise.resolve();
    this.lastBeat = this.scene.time.now;
    const jobs = [];
    for (const x of [BOARD.left - 7, BOARD.right + 7]) {
      const glow = this._sprite('glow', x, 636, GOLD, 1);
      if (!glow) continue;
      glow.setScale(.5, this.reduced ? 3 : 7).setAlpha(.17 + Math.min(1, strength) * .14);
      jobs.push(this._animate(glow, { alpha: 0, scaleX: .8, duration: 240, ease: 'Cubic.Out' }));
    }
    if (!this.reduced) {
      const x = Math.random() > .5 ? BOARD.left - 7 : BOARD.right + 7;
      const star = this._sprite('star', x, BOARD.top + Math.random() * 684, WHITE, .2);
      jobs.push(this._animate(star, { scale: .6, angle: 90, alpha: 0, duration: 230, ease: 'Cubic.Out' }));
    }
    return Promise.all(jobs);
  }

  setReduced(value) {
    this.reduced = Boolean(value);
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (const job of [...this.jobs]) {
      job.tween?.stop();
      job.finish();
    }
    for (const node of [...this.nodes]) this._remove(node);
    this.jobs.clear();
  }
}
