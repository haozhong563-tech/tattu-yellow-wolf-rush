import Phaser from 'phaser';

const BOARD = { left: 56, right: 664, top: 295, bottom: 979 };
const WHITE = 0xffffff;
const GOLD = 0xffdc55;
const CYAN = 0x65eaff;
const PREFIX = 'tata-fx-';
const LIMIT = 240;

/** Short, cell-local effects. All objects are owned by this helper. */
export class Effects {
  constructor(scene, { reduced = false } = {}) {
    this.scene = scene;
    this.reduced = reduced;
    this.nodes = new Set();
    this.jobs = new Set();
    this.dead = false;
    this.lastBeat = -1000;
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
  }

  _color(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const hex = value.replace('#', '');
      return Number.parseInt(hex.length === 3 ? [...hex].map(c => c + c).join('') : hex, 16) || GOLD;
    }
    return GOLD;
  }

  _own(node) {
    if (this.dead) { node.destroy(); return null; }
    this.nodes.add(node);
    node.setDepth(80);
    return node;
  }

  _sprite(name, x, y, color = WHITE, scale = 1, additive = true) {
    if (this.dead || this.nodes.size >= LIMIT) return null;
    const node = this._own(this.scene.add.image(x, y, PREFIX + name));
    node.setTint(this._color(color)).setScale(scale);
    if (additive) node.setBlendMode(Phaser.BlendModes.ADD);
    return node;
  }

  _remove(node) {
    if (!node) return;
    this.nodes.delete(node);
    if (node.scene) node.destroy();
  }

  _animate(node, config) {
    if (!node || this.dead) return Promise.resolve();
    return new Promise(resolve => {
      let finished = false;
      const job = { finish: null, tween: null };
      job.finish = () => {
        if (finished) return;
        finished = true;
        this.jobs.delete(job);
        this._remove(node);
        resolve();
      };
      this.jobs.add(job);
      job.tween = this.scene.tweens.add({ targets: node, ...config, onComplete: job.finish });
    });
  }

  _ring(x, y, color, size = 1, duration = 340, delay = 0) {
    const ring = this._sprite('ring', x, y, color, .08);
    return this._animate(ring, { scale: size, alpha: 0, duration, delay, ease: 'Cubic.Out' });
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
    const jobs = [this.burst(x, y, CYAN, 1.2)];
    for (const [endX, endY] of ends) {
      const length = Math.hypot(endX - x, endY - y);
      const angle = Math.atan2(endY - y, endX - x);
      for (const [height, tint, opacity] of [[32, CYAN, .16], [15, CYAN, .38], [5, WHITE, .95]]) {
        if (this.nodes.size >= LIMIT) break;
        const ray = this._own(this.scene.add.rectangle(x, y, length, height, tint, 1));
        ray.setOrigin(0, .5).setRotation(angle).setBlendMode(Phaser.BlendModes.ADD).setScale(.01, 1).setAlpha(opacity);
        jobs.push(this._animate(ray, {
          scaleX: { from: .01, to: 1, duration: this.reduced ? 60 : 110 },
          scaleY: { from: 1, to: .2, duration: 220, delay: 80 },
          alpha: { from: opacity, to: 0, duration: 230, delay: this.reduced ? 30 : 80 },
          duration: 310, ease: 'Cubic.Out',
        }));
      }
      if (!this.reduced) for (let n = 1; n <= Math.min(7, Math.ceil(length / 65)); n++) {
        const t = n / Math.max(1, Math.ceil(length / 65));
        const spark = this._sprite('star', x + (endX - x) * t, y + (endY - y) * t, WHITE, .12);
        jobs.push(this._animate(spark, { scale: .48, angle: 90, alpha: 0, duration: 230, delay: n * 14, ease: 'Cubic.Out' }));
      }
    }
    if (!this.reduced) this.scene.cameras.main.shake(90, .0018);
    return Promise.all(jobs);
  }

  nova(x, y, targets = []) {
    if (this.dead) return Promise.resolve();
    const jobs = [this._ring(x, y, GOLD, 2, 450), this._ring(x, y, CYAN, 1.5, 400, 45), this.burst(x, y, GOLD, 1.8)];
    const max = this.reduced ? 8 : 30;
    const stride = Math.max(1, Math.ceil(targets.length / max));
    targets.filter((_, i) => i % stride === 0).slice(0, max).forEach((target, i) => {
      if (this.nodes.size >= LIMIT) return;
      const line = this._own(this.scene.add.graphics());
      line.setBlendMode(Phaser.BlendModes.ADD);
      const mx = (x + target.x) / 2 + ((i % 3) - 1) * 20;
      const my = (y + target.y) / 2 + ((i % 2) - .5) * 28;
      for (const [width, tint, opacity] of [[10, GOLD, .12], [4, CYAN, .5], [1.5, WHITE, 1]]) {
        line.lineStyle(width, tint, opacity);
        line.beginPath(); line.moveTo(x, y); line.lineTo(mx, my); line.lineTo(target.x, target.y); line.strokePath();
      }
      jobs.push(this._animate(line, { alpha: 0, delay: i * 7, duration: 320, ease: 'Cubic.In' }));
      const spark = this._sprite('star', target.x, target.y, GOLD, .2);
      jobs.push(this._animate(spark, { scale: .75, angle: 100, alpha: 0, delay: 60 + i * 7, duration: 260, ease: 'Cubic.Out' }));
    });
    if (!this.reduced) this.scene.cameras.main.shake(150, .0028);
    return Promise.all(jobs);
  }

  bomb(x, y) {
    if (this.dead) return Promise.resolve();
    const flash = this._sprite('glow', x, y, 0xfff4a0, .2);
    if (!this.reduced) this.scene.cameras.main.shake(120, .0025);
    return Promise.all([
      this._animate(flash, { scale: this.reduced ? 1.6 : 2.9, alpha: 0, duration: 280, ease: 'Cubic.Out' }),
      this._ring(x, y, 0xffb957, 2.25, 440), this._ring(x, y, WHITE, 1.6, 350, 35),
      this.burst(x, y, 0xff996c, 1.85),
    ]);
  }

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
    if (this.dead || !this.scene.textures.exists(textureKey) || this.nodes.size >= LIMIT) {
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
      const job = { tween: null, finish: null };
      job.finish = () => {
        if (finished) return;
        finished = true;
        this.jobs.delete(job);
        this._remove(node);
        if (!this.dead) {
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
