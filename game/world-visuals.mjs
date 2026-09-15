/** Code-native obstacle art. World rules and falling motion remain scene-owned. */
export const WORLD_VISUALS = Object.freeze({
  rock: Object.freeze({ name: '矿晶岩石', maxHp: 3, color: 0xffd264, size: 68 }),
  crate: Object.freeze({ name: 'TATTU 补给箱', maxHp: 2, color: 0xf5bd63, size: 67 }),
  battery: Object.freeze({ name: '黑金能量罐', maxHp: 2, color: 0xffd33f, size: 65 }),
  prism: Object.freeze({ name: '紫晶能源', maxHp: 1, color: 0xc092ff, size: 68 }),
});

const SIZE = 128;
const INK = 0x34545c;
const IVORY = 0xfff5cc;
const point = (x, y) => ({ x, y });

function face(g, vertices, color, alpha = 1, outline = 0, width = 2) {
  g.fillStyle(color, alpha).fillPoints(vertices.map(([x, y]) => point(x, y)), true);
  if (outline) stroke(g, [...vertices, vertices[0]], outline, width);
}

function stroke(g, vertices, color, width = 2, alpha = 1) {
  g.lineStyle(width, color, alpha).beginPath();
  vertices.forEach(([x, y], i) => { if (i) g.lineTo(x, y); else g.moveTo(x, y); });
  g.strokePath();
}

function shadow(g, width = 92) {
  g.fillStyle(0x315c59, .18).fillEllipse(65, 111, width, 18);
  g.fillStyle(0x315c59, .09).fillEllipse(65, 113, width + 12, 14);
}

function bolt(g, x, y, scale = 1, color = IVORY) {
  face(g, [[x + 5 * scale, y - 22 * scale], [x - 15 * scale, y + 2 * scale], [x - 2 * scale, y + 2 * scale], [x - 8 * scale, y + 21 * scale], [x + 18 * scale, y - 7 * scale], [x + 3 * scale, y - 7 * scale]], color);
}

function mineralCrack(g, vertices, hp, width = 2) {
  stroke(g, vertices, 0x3c4c51, width + (hp === 1 ? 4 : 2), .9);
  stroke(g, vertices, hp === 1 ? 0xffcd56 : 0xf6d47e, width, 1);
  if (hp === 1) stroke(g, vertices, 0xfff5c9, Math.max(1, width * .35), .95);
}

function rock(g, hp) {
  shadow(g, 98);
  const hull = [[22, 98], [12, 68], [28, 26], [61, 13], [100, 30], [116, 70], [102, 103], [63, 115]];
  face(g, hull, 0x688a8e, 1, INK, 5);
  face(g, [[28, 26], [61, 13], [100, 30], [72, 45], [44, 47]], 0xb4c8bc);
  face(g, [[12, 68], [28, 26], [44, 47], [38, 76], [22, 98]], 0x94b4ad);
  face(g, [[44, 47], [72, 45], [92, 71], [66, 91], [38, 76]], 0x8daaa5);
  face(g, [[100, 30], [116, 70], [92, 71], [72, 45]], 0x759497);
  face(g, [[38, 76], [66, 91], [63, 115], [22, 98]], 0x698d8b);
  face(g, [[92, 71], [116, 70], [102, 103], [63, 115], [66, 91]], 0x58787e);
  stroke(g, [[28, 28], [61, 16], [94, 31]], 0xe7eed7, 3, .83);
  stroke(g, [[19, 68], [30, 34]], 0xc8d9c8, 2, .7);
  g.fillStyle(0xa2ba80, .9).fillEllipse(37, 33, 15, 6).fillEllipse(33, 38, 10, 5);
  mineralCrack(g, [[66, 29], [59, 43], [70, 56], [59, 73]], hp, hp === 3 ? 1.6 : 3);
  if (hp <= 2) {
    mineralCrack(g, [[70, 56], [88, 53], [96, 36]], hp, 2.6);
    mineralCrack(g, [[59, 73], [66, 89], [56, 107]], hp, 2.8);
    mineralCrack(g, [[59, 73], [42, 66], [24, 78]], hp, 2.3);
  }
  if (hp === 1) {
    mineralCrack(g, [[66, 29], [68, 16]], hp, 3.1);
    mineralCrack(g, [[42, 66], [34, 51], [20, 49]], hp, 2.5);
    mineralCrack(g, [[66, 89], [86, 86], [101, 102]], hp, 3.1);
    mineralCrack(g, [[88, 53], [99, 65], [112, 71]], hp, 2.5);
    mineralCrack(g, [[42, 66], [40, 90], [29, 100]], hp, 2.3);
    face(g, [[15, 95], [23, 100], [18, 107], [10, 103]], 0x739698, 1, INK, 1.5);
    face(g, [[103, 107], [110, 97], [116, 106], [111, 112]], 0xadc3b5, 1, INK, 1.5);
  }
}

function crate(g, hp) {
  shadow(g, 94);
  // A three-quarter wood supply crate with industrial corner protectors.
  face(g, [[22, 38], [44, 19], [111, 31], [93, 49]], 0xe8bf75, 1, 0x5d6251, 4);
  face(g, [[22, 38], [93, 49], [93, 111], [22, 99]], 0xc59453, 1, 0x5d6251, 4);
  face(g, [[93, 49], [111, 31], [111, 94], [93, 111]], 0x92764c, 1, 0x5d6251, 4);
  face(g, [[29, 47], [86, 56], [86, 101], [29, 91]], 0xd7ac66);
  stroke(g, [[27, 62], [88, 72]], 0xb18448, 2);
  stroke(g, [[27, 78], [88, 88]], 0xb18448, 2);
  stroke(g, [[37, 31], [101, 41]], 0xf4d991, 3);
  stroke(g, [[52, 25], [47, 40]], 0xb58e52, 2);
  stroke(g, [[78, 29], [72, 44]], 0xb58e52, 2);
  face(g, [[28, 42], [39, 44], [87, 94], [87, 105], [78, 102], [28, 54]], 0xedc980, 1, 0xab8447, 2);
  face(g, [[79, 49], [88, 51], [88, 64], [37, 96], [27, 94], [28, 83]], 0xe7c279, 1, 0xab8447, 2);
  for (const [x, y] of [[25, 43], [86, 53], [25, 92], [86, 102]]) {
    g.fillStyle(0x486975).fillRoundedRect(x - 6, y - 6, 15, 15, 3);
    g.fillStyle(0x99beb6).fillCircle(x + 1, y + 1, 2.4);
  }
  face(g, [[43, 59], [76, 64], [76, 84], [43, 78]], 0x38535e, 1, 0xf5d992, 2);
  // TATTU stencil lettering stays crisp without a font or external texture.
  for (let i = 0; i < 5; i++) {
    const x = 48 + i * 5, y = 66 + i * .75;
    if (i === 1) {
      stroke(g, [[x - 1.8, y + 6], [x, y], [x + 1.8, y + 6]], 0xffe382, 1.3);
      stroke(g, [[x - 1.1, y + 3.5], [x + 1.1, y + 3.5]], 0xffe382, 1.2);
    } else if (i === 4) {
      stroke(g, [[x - 1.8, y], [x - 1.8, y + 5], [x, y + 6], [x + 1.8, y + 5], [x + 1.8, y]], 0xffe382, 1.3);
    } else {
      stroke(g, [[x - 1.8, y], [x + 1.8, y]], 0xffe382, 1.4);
      stroke(g, [[x, y], [x, y + 6]], 0xffe382, 1.4);
    }
  }
  if (hp === 1) {
    stroke(g, [[57, 42], [49, 55], [58, 64]], 0x6d563a, 3.6);
    stroke(g, [[66, 87], [58, 94], [60, 104]], 0x6d563a, 3.6);
    stroke(g, [[105, 58], [99, 68], [106, 75], [99, 87]], 0x554f40, 3);
    face(g, [[28, 86], [34, 88], [29, 97], [22, 93]], 0xf3d28d);
  }
}

function battery(g, hp) {
  shadow(g, 81);
  g.fillStyle(0x344b59).fillRoundedRect(30, 23, 70, 89, 19);
  g.fillStyle(0x202f3d).fillRoundedRect(35, 28, 61, 79, 16);
  g.fillStyle(0x536874).fillRoundedRect(37, 33, 11, 68, 5);
  g.fillStyle(0x2d4250).fillRoundedRect(82, 36, 9, 61, 4);
  g.fillStyle(0xe5ad32).fillRoundedRect(27, 23, 76, 23, 10);
  g.fillStyle(0xffd34c).fillRoundedRect(31, 20, 68, 19, 8);
  g.fillStyle(0xffed9a).fillRoundedRect(36, 22, 56, 6, 3);
  g.fillStyle(0xe1ad36).fillRoundedRect(29, 94, 72, 17, 7);
  g.fillStyle(0xffd150).fillRoundedRect(33, 95, 64, 8, 3);
  g.fillStyle(0x2c4555).fillRoundedRect(52, 10, 27, 13, 4);
  g.fillStyle(0xb9d0be).fillRoundedRect(55, 10, 21, 6, 3);
  g.fillStyle(0xe6bd4c).fillRoundedRect(48, 48, 34, 40, 8);
  g.fillStyle(0x182e3f).fillRoundedRect(52, 51, 26, 34, 5);
  bolt(g, 64, 68, .64, 0xffd44e);
  g.fillStyle(0x6cd8ad).fillCircle(85, 49, 3);
  for (let i = 0; i < 3; i++) g.fillStyle(0x718480).fillRoundedRect(39, 77 + i * 5, 6, 2, 1);
  if (hp === 1) {
    stroke(g, [[48, 33], [45, 43], [50, 52], [43, 63]], 0xffcf4d, 2.5);
    stroke(g, [[82, 85], [87, 77], [83, 65]], 0xffdf72, 2.5);
    stroke(g, [[25, 68], [19, 58], [26, 60], [22, 49]], 0xf4cd52, 2.8);
    stroke(g, [[105, 50], [111, 58], [104, 62], [110, 73]], 0xf4cd52, 2.8);
    g.fillStyle(0xffe76e).fillCircle(85, 49, 3.5);
  }
}

function prism(g, hp) {
  shadow(g, 96);
  // A large faceted central crystal with two smaller shards in a metal cradle.
  face(g, [[22, 96], [14, 69], [24, 46], [42, 72], [40, 106]], 0x9674c9, 1, 0x595977, 3);
  face(g, [[14, 69], [24, 46], [27, 76], [22, 96]], 0xceacf0);
  face(g, [[89, 109], [88, 65], [103, 44], [118, 74], [108, 99]], 0x7955b5, 1, 0x595977, 3);
  face(g, [[88, 65], [103, 44], [102, 78], [89, 109]], 0xb88be4);
  face(g, [[43, 100], [33, 46], [63, 8], [90, 42], [82, 104], [63, 117]], 0x9570d9, 1, 0x55537c, 4);
  face(g, [[33, 46], [63, 8], [59, 51]], 0xebcfff);
  face(g, [[63, 8], [90, 42], [59, 51]], 0xc79af1);
  face(g, [[33, 46], [59, 51], [63, 117], [43, 100]], 0xb989e6);
  face(g, [[59, 51], [90, 42], [82, 104], [63, 117]], 0x7d58bf);
  face(g, [[37, 47], [54, 50], [54, 78], [43, 69]], 0xf1d9ff, .58);
  stroke(g, [[63, 12], [37, 46], [46, 96]], 0xfbedff, 2.7, .9);
  stroke(g, [[60, 55], [64, 106]], 0xe2baff, 1.8, .75);
  face(g, [[30, 103], [60, 112], [94, 101], [99, 109], [64, 122], [27, 112]], 0x566878, 1, 0x385563, 2);
  stroke(g, [[34, 106], [63, 116], [91, 106]], 0xd2c9e6, 3);
  if (hp === 1) {
    stroke(g, [[61, 34], [54, 48], [66, 60], [53, 79], [61, 103]], 0x614385, 5);
    stroke(g, [[61, 34], [54, 48], [66, 60], [53, 79], [61, 103]], 0xfbe0ff, 2);
    stroke(g, [[66, 60], [80, 62], [86, 48]], 0xf5cbff, 2.3);
    stroke(g, [[53, 79], [41, 82]], 0xf5cbff, 2.3);
    face(g, [[94, 30], [98, 36], [94, 42], [91, 36]], 0xeac7ff);
  }
}

const PAINTERS = { rock, crate, battery, prism };

/** Creates 13 fixed, reusable 128 px textures; safe to call on every scene restart. */
export function prepareWorldTextures(scene) {
  for (const [type, meta] of Object.entries(WORLD_VISUALS)) {
    for (let hp = meta.maxHp; hp >= 1; hp--) {
      for (const key of hp === meta.maxHp ? [`world-${type}`, `world-${type}-${hp}`] : [`world-${type}-${hp}`]) {
        if (scene.textures.exists(key)) continue;
        const g = scene.make.graphics({ x: 0, y: 0, add: false });
        PAINTERS[type](g, hp);
        g.generateTexture(key, SIZE, SIZE);
        g.destroy();
      }
    }
  }
}

/**
 * cell: {id,kind:-1,special:null,obstacle:'rock'|'crate'|'battery'|'prism',hp}.
 * node.icon is an Image; node.badge is its scene-owned Container.
 * Returns true for obstacles, false for a wolf cell so the caller can draw it.
 */
export function decorateObstacle(scene, node, cell) {
  const meta = WORLD_VISUALS[cell?.obstacle];
  if (!meta || !node?.icon || !node?.badge) {
    if (node) node._worldVisual = null;
    return false;
  }
  const hp = Math.min(meta.maxHp, Math.max(1, Math.floor(Number(cell.hp) || 1)));
  const key = `world-${cell.obstacle}-${hp}`;
  if (!scene.textures.exists(key)) prepareWorldTextures(scene);
  if (node._worldVisual === key && node.icon.texture?.key === key && node.badge.list?.length) return true;
  node._worldVisual = key;
  node.icon.setTexture(key).setDisplaySize(meta.size, meta.size).setPosition(0, -3).setAlpha(1).setAngle(0).clearTint();
  node.badge.removeAll(true);
  const badge = scene.add.graphics();
  const width = meta.maxHp * 12 + 12, left = -width / 2;
  badge.fillStyle(0x28454b, .94).fillRoundedRect(left, 25, width, 13, 6.5);
  badge.lineStyle(1.5, 0xf0e8bf, .85).strokeRoundedRect(left, 25, width, 13, 6.5);
  for (let i = 0; i < meta.maxHp; i++) {
    const x = (i - (meta.maxHp - 1) / 2) * 12;
    badge.fillStyle(i < hp ? meta.color : 0x53686c, 1).fillCircle(x, 31.5, i < hp ? 3.8 : 3);
    if (i < hp) badge.fillStyle(0xfff9d9, .9).fillCircle(x - .8, 30.4, 1.2);
  }
  node.badge.add(badge);
  return true;
}

function hitPoint(hit, pointValue) {
  if (Number.isFinite(pointValue?.x) && Number.isFinite(pointValue?.y)) return pointValue;
  const index = Number(hit?.index);
  if (!Number.isInteger(index) || index < 0 || index >= 72) return null;
  return { x: 56 + (index % 8) * 76 + 38, y: 295 + Math.floor(index / 8) * 76 + 38 };
}

/** Visual hit response only. Root owns HP accounting, removal and falling. */
export function obstacleImpact(scene, fx, hit, pointValue) {
  const meta = WORLD_VISUALS[hit?.cell?.obstacle], p = hitPoint(hit, pointValue);
  if (!meta || !p || !fx || fx.dead || scene.alive === false) return Promise.resolve();
  const hp = Math.max(0, Number(hit.hp) || 0);
  const node = scene.nodes?.get(hit.cell.id);
  if (hp > 0 && node?.active) decorateObstacle(scene, node, { ...hit.cell, hp });
  // All fragments go through the shared Effects cap; no extra timers or emitters.
  return fx.burst(p.x, p.y, meta.color, hp > 0 ? .68 : 1.12);
}

/** Optional landing puff; falling motion and impact audio stay scene-owned. */
export function worldDrop(scene, fx, cell, pointValue) {
  const meta = WORLD_VISUALS[cell?.obstacle];
  if (!meta || !fx || fx.dead || scene.alive === false || !Number.isFinite(pointValue?.x) || !Number.isFinite(pointValue?.y)) return Promise.resolve();
  return fx.burst(pointValue.x, pointValue.y + 18, meta.color, .36);
}
