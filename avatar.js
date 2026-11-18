/* Deterministic pixel-art avatars. The same seed always draws the same face.
   window.pixelAvatar(seed, label) returns an SVG string (16 x 16 pixels, crisp edges). */
(function () {
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var SKIN = ["#f5d0b0", "#e8b98a", "#d29a6a", "#b87a4b", "#8d5a37", "#5e3b24"];
  var HAIR = ["#0b0b0b", "#2b1a10", "#5a3418", "#a0522d", "#e4001b", "#f6e27a", "#3b6fd1", "#d6479a", "#8b8b8b"];
  var BG = ["#a8c5ec", "#f4b6d0", "#f6e27a", "#c8ecd2", "#d9c9f2", "#ffd0b0", "#ffffff"];
  var SHIRT = ["#e4001b", "#0b0b0b", "#10244a", "#3b6fd1", "#d6479a", "#1f8a5b", "#f6e27a", "#ffffff"];
  var DARK = "#0b0b0b";

  function pixelAvatar(seed, label) {
    var r = rng(hash(String(seed)));
    var pick = function (a) { return a[Math.floor(r() * a.length)]; };
    var g = []; for (var y = 0; y < 16; y++) g.push(new Array(16).fill(null));
    var set = function (x, y, c) { if (x >= 0 && x < 16 && y >= 0 && y < 16) g[y][x] = c; };
    var sym = function (x, y, c) { set(x, y, c); set(15 - x, y, c); };
    var bg = pick(BG), skin = pick(SKIN), hair = pick(HAIR), shirt = pick(SHIRT);
    if (shirt === bg) shirt = DARK;
    for (y = 0; y < 16; y++) for (var x = 0; x < 16; x++) set(x, y, bg);
    // shoulders and neck
    for (y = 13; y < 16; y++) for (x = 2; x < 14; x++) if (!(y === 13 && (x === 2 || x === 13))) set(x, y, shirt);
    for (x = 6; x < 10; x++) set(x, 12, skin);
    // head
    for (y = 3; y <= 11; y++) { var half = (y === 3 || y === 11) ? 3 : 4; for (x = 8 - half; x <= 7 + half; x++) set(x, y, skin); }
    // hair
    var style = Math.floor(r() * 6), x2;
    if (style === 0) { for (x = 5; x <= 10; x++) set(x, 2, hair); for (x = 4; x <= 11; x++) set(x, 3, hair); sym(4, 4, hair); sym(5, 4, hair); }
    else if (style === 1) { for (x = 5; x <= 10; x++) set(x, 2, hair); for (x = 4; x <= 11; x++) set(x, 3, hair); for (y = 4; y <= 11; y++) { sym(3, y, hair); sym(4, y, hair); } sym(5, 4, hair); }
    else if (style === 2) { for (y = 0; y <= 3; y++) { set(7, y, hair); set(8, y, hair); } }
    else if (style === 3) { set(6, 4, "#ffffff"); set(7, 4, "#ffffff"); }
    else if (style === 4) { for (x = 4; x <= 11; x++) { set(x, 2, shirt); set(x, 3, shirt); } for (x = 3; x <= 12; x++) set(x, 4, shirt); }
    else { for (x = 4; x <= 11; x++) set(x, 1, hair); for (x = 3; x <= 12; x++) { set(x, 2, hair); set(x, 3, hair); } sym(3, 4, hair); sym(4, 4, hair); sym(3, 5, hair); }
    // eyes
    var eyes = Math.floor(r() * 4);
    if (eyes === 0) { sym(6, 7, DARK); }
    else if (eyes === 1) { sym(5, 7, DARK); sym(6, 7, DARK); sym(6, 6, DARK); sym(5, 6, "#ffffff"); }
    else if (eyes === 2) { sym(5, 7, DARK); sym(6, 7, DARK); }
    else { for (x = 4; x <= 11; x++) set(x, 6, DARK); for (x = 5; x <= 10; x++) set(x, 7, DARK); set(7, 6, DARK); set(8, 6, DARK); }
    if (eyes !== 3 && r() < 0.3) { for (x = 5; x <= 6; x++) { set(x, 6, DARK); set(15 - x, 6, DARK); set(x, 8, DARK); set(15 - x, 8, DARK); } set(4, 7, DARK); set(11, 7, DARK); set(7, 7, DARK); set(8, 7, DARK); }
    // mouth
    var mouth = Math.floor(r() * 4);
    if (mouth === 0) { set(6, 9, DARK); set(9, 9, DARK); set(7, 10, DARK); set(8, 10, DARK); }
    else if (mouth === 1) { for (x = 6; x <= 9; x++) set(x, 10, DARK); }
    else if (mouth === 2) { for (y = 9; y <= 10; y++) { set(7, y, DARK); set(8, y, DARK); } set(7, 10, "#e4001b"); set(8, 10, "#e4001b"); }
    else { for (x = 6; x <= 8; x++) set(x, 10, DARK); set(9, 9, DARK); }
    if (r() < 0.4) { set(5, 9, "#f4a3b9"); set(10, 9, "#f4a3b9"); }
    // SVG, merging horizontal runs
    var out = "";
    for (y = 0; y < 16; y++) {
      x = 0;
      while (x < 16) {
        var c = g[y][x]; if (!c) { x++; continue; }
        x2 = x; while (x2 + 1 < 16 && g[y][x2 + 1] === c) x2++;
        out += '<rect x="' + x + '" y="' + y + '" width="' + (x2 - x + 1) + '" height="1" fill="' + c + '"/>';
        x = x2 + 1;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" role="img" aria-label="' + String(label || "Avatar").replace(/"/g, "") + '">' + out + "</svg>";
  }
  window.pixelAvatar = pixelAvatar;
  window.slugify = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); };
})();
