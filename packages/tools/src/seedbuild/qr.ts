/**
 * Browser-side QR encoder + subscription wiring, inlined into the feed
 * landing page (`index.html`).
 *
 * Two constraints shape this module:
 *
 * 1. The landing page is static and dependency-free — no CDN script, no
 *    reader-side build step.
 * 2. The feed's own hosted URL is only knowable at runtime: the page knows
 *    where it is served from (`window.location`), the build does not. The
 *    subscription deep links therefore resolve in the page, not at build
 *    time.
 *
 * So the QR encoder ships as inline JavaScript inside the page. It is a
 * compact, dependency-free QR implementation (byte mode, error correction
 * level M, versions 1–20) that renders an SVG matrix.
 */

/** Canonical Wod.Wiki app origin the landing page deep-links into. */
export const APP_ORIGIN = 'https://wod.wiki';

/** Element id of the inlined script (tests and the page both key on it). */
export const QR_SCRIPT_ID = 'wod-feed-qr';

/**
 * The inline script for the landing page. `__APP_ORIGIN__` is replaced with
 * the app origin so the page and the build agree on one value.
 */
export function qrInlineScript(appOrigin: string = APP_ORIGIN): string {
  return SCRIPT.replace('__APP_ORIGIN__', appOrigin);
}

/**
 * QR encoder + subscribe wiring.
 *
 * Written as plain ES5-compatible JavaScript inside a template literal: it
 * runs untranspiled in the reader's browser, so it cannot use TypeScript
 * syntax or template literals of its own.
 */
const SCRIPT = `(function () {
  'use strict';

  var APP_ORIGIN = '__APP_ORIGIN__';

  // Error correction level M: [ecc codewords per block, block count] for
  // versions 1..20.
  var ECC_TABLE = [
    [10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4], [18, 4], [22, 4],
    [22, 5], [26, 5], [30, 5], [22, 8], [22, 9], [24, 9], [24, 10],
    [28, 10], [28, 11], [26, 13], [26, 14], [22, 18]
  ];
  var MAX_VERSION = ECC_TABLE.length;
  var MODE_BYTE = 4;
  var FORMAT_BITS_M = 0;

  // ── GF(256) arithmetic (Reed-Solomon) ────────────────────────────────────

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }

  function rsDivisor(degree) {
    var result = [];
    for (var i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }

  function rsRemainder(data, divisor) {
    var result = divisor.map(function () { return 0; });
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ (result.shift() & 0xff);
      result.push(0);
      for (var j = 0; j < divisor.length; j++) result[j] ^= gfMul(divisor[j], factor);
    }
    return result;
  }

  // ── Version geometry ─────────────────────────────────────────────────────

  function numRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function numDataCodewords(ver) {
    var t = ECC_TABLE[ver - 1];
    return Math.floor(numRawDataModules(ver) / 8) - t[0] * t[1];
  }

  function alignmentPositions(ver) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var size = ver * 4 + 17;
    var result = [6];
    for (var pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  // ── Bit stream ───────────────────────────────────────────────────────────

  function utf8Bytes(text) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return out;
  }

  function buildCodewords(text, ver) {
    var bytes = utf8Bytes(text);
    var ccBits = ver <= 9 ? 8 : 16;
    var bits = [];
    function push(value, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    }
    push(MODE_BYTE, 4);
    push(bytes.length, ccBits);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    var capacity = numDataCodewords(ver) * 8;
    push(0, Math.min(4, capacity - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (var pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
    var codewords = [];
    for (var i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      codewords.push(b);
    }
    return codewords;
  }

  function splitBlocks(data, ver) {
    var t = ECC_TABLE[ver - 1];
    var eccLen = t[0];
    var numBlocks = t[1];
    var rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    var numShort = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);
    var divisor = rsDivisor(eccLen);
    var blocks = [];
    var k = 0;
    for (var i = 0; i < numBlocks; i++) {
      var dataLen = shortBlockLen - eccLen + (i < numShort ? 0 : 1);
      var dat = data.slice(k, k + dataLen);
      k += dataLen;
      blocks.push({ data: dat, ecc: rsRemainder(dat, divisor) });
    }
    return blocks;
  }

  function interleave(blocks) {
    var out = [];
    var maxData = 0;
    var eccLen = blocks[0].ecc.length;
    for (var b = 0; b < blocks.length; b++) {
      if (blocks[b].data.length > maxData) maxData = blocks[b].data.length;
    }
    for (var i = 0; i < maxData; i++) {
      for (var j = 0; j < blocks.length; j++) {
        if (i < blocks[j].data.length) out.push(blocks[j].data[i]);
      }
    }
    for (var i = 0; i < eccLen; i++) {
      for (var j = 0; j < blocks.length; j++) out.push(blocks[j].ecc[i]);
    }
    return out;
  }

  // ── Matrix ───────────────────────────────────────────────────────────────

  function newMatrix(size) {
    var modules = [];
    var isFunction = [];
    for (var y = 0; y < size; y++) {
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }
    return { modules: modules, isFunction: isFunction, size: size };
  }

  function setFunction(m, x, y, dark) {
    m.modules[y][x] = dark;
    m.isFunction[y][x] = true;
  }

  function drawFinder(m, cx, cy) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var x = cx + dx;
        var y = cy + dy;
        if (x < 0 || x >= m.size || y < 0 || y >= m.size) continue;
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(m, x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  function drawAlignment(m, cx, cy) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        setFunction(m, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  function drawFunctionPatterns(m, ver) {
    for (var i = 0; i < m.size; i++) {
      setFunction(m, 6, i, i % 2 === 0);
      setFunction(m, i, 6, i % 2 === 0);
    }
    drawFinder(m, 3, 3);
    drawFinder(m, m.size - 4, 3);
    drawFinder(m, 3, m.size - 4);
    var pos = alignmentPositions(ver);
    for (var i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        var corner = (i === 0 && j === 0) ||
          (i === 0 && j === pos.length - 1) ||
          (i === pos.length - 1 && j === 0);
        if (!corner) drawAlignment(m, pos[i], pos[j]);
      }
    }
    drawFormatBits(m, 0);
    drawVersionBits(m, ver);
  }

  function drawFormatBits(m, mask) {
    var data = (FORMAT_BITS_M << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    for (var i = 0; i <= 5; i++) setFunction(m, 8, i, ((bits >>> i) & 1) !== 0);
    setFunction(m, 8, 7, ((bits >>> 6) & 1) !== 0);
    setFunction(m, 8, 8, ((bits >>> 7) & 1) !== 0);
    setFunction(m, 7, 8, ((bits >>> 8) & 1) !== 0);
    for (var i = 9; i < 15; i++) setFunction(m, 14 - i, 8, ((bits >>> i) & 1) !== 0);
    for (var i = 0; i < 8; i++) setFunction(m, m.size - 1 - i, 8, ((bits >>> i) & 1) !== 0);
    for (var i = 8; i < 15; i++) setFunction(m, 8, m.size - 15 + i, ((bits >>> i) & 1) !== 0);
    setFunction(m, 8, m.size - 8, true);
  }

  function drawVersionBits(m, ver) {
    if (ver < 7) return;
    var rem = ver;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    var bits = (ver << 12) | rem;
    for (var i = 0; i < 18; i++) {
      var dark = ((bits >>> i) & 1) !== 0;
      var a = m.size - 11 + (i % 3);
      var b = Math.floor(i / 3);
      setFunction(m, a, b, dark);
      setFunction(m, b, a, dark);
    }
  }

  function drawCodewords(m, codewords) {
    var bitIndex = 0;
    var total = codewords.length * 8;
    for (var right = m.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < m.size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? m.size - 1 - vert : vert;
          if (!m.isFunction[y][x] && bitIndex < total) {
            m.modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
            bitIndex++;
          }
        }
      }
    }
  }

  function maskAt(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    }
  }

  function applyMask(m, mask) {
    for (var y = 0; y < m.size; y++) {
      for (var x = 0; x < m.size; x++) {
        if (!m.isFunction[y][x] && maskAt(mask, x, y)) m.modules[y][x] = !m.modules[y][x];
      }
    }
  }

  function penalty(m) {
    var score = 0;
    var size = m.size;
    var x, y, i;
    // Rule 1: runs of five or more same-colour modules.
    for (y = 0; y < size; y++) {
      var runColor = m.modules[y][0];
      var runLen = 1;
      for (x = 1; x < size; x++) {
        if (m.modules[y][x] === runColor) {
          runLen++;
        } else {
          if (runLen >= 5) score += 3 + (runLen - 5);
          runColor = m.modules[y][x];
          runLen = 1;
        }
      }
      if (runLen >= 5) score += 3 + (runLen - 5);
    }
    for (x = 0; x < size; x++) {
      var colColor = m.modules[0][x];
      var colLen = 1;
      for (y = 1; y < size; y++) {
        if (m.modules[y][x] === colColor) {
          colLen++;
        } else {
          if (colLen >= 5) score += 3 + (colLen - 5);
          colColor = m.modules[y][x];
          colLen = 1;
        }
      }
      if (colLen >= 5) score += 3 + (colLen - 5);
    }
    // Rule 2: 2x2 blocks of one colour.
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = m.modules[y][x];
        if (c === m.modules[y][x + 1] && c === m.modules[y + 1][x] && c === m.modules[y + 1][x + 1]) score += 3;
      }
    }
    // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules beside.
    var pattern = [true, false, true, true, true, false, true];
    var hasPattern = function (get, at) {
      for (var k = 0; k < 7; k++) {
        if (get(at + k) !== pattern[k]) return false;
      }
      return true;
    };
    var lightRun = function (get, at, count) {
      for (var k = 1; k <= count; k++) {
        if (at - k < 0) return false;
        if (get(at - k) !== false) return false;
      }
      return true;
    };
    for (y = 0; y < size; y++) {
      for (x = 0; x <= size - 7; x++) {
        if (hasPattern(function (at) { return m.modules[y][at]; }, x)) {
          if (lightRun(function (at) { return m.modules[y][at]; }, x, 4)) score += 40;
          if (x + 11 <= size && lightRun(function (at) { return m.modules[y][at]; }, x + 7, 4)) score += 40;
        }
      }
    }
    for (x = 0; x < size; x++) {
      for (y = 0; y <= size - 7; y++) {
        if (hasPattern(function (at) { return m.modules[at][x]; }, y)) {
          if (lightRun(function (at) { return m.modules[at][x]; }, y, 4)) score += 40;
          if (y + 11 <= size && lightRun(function (at) { return m.modules[at][x]; }, y + 7, 4)) score += 40;
        }
      }
    }
    // Rule 4: deviation from a 50/50 dark ratio.
    var dark = 0;
    for (y = 0; y < size; y++) {
      for (x = 0; x < size; x++) if (m.modules[y][x]) dark++;
    }
    var ratio = Math.ceil(Math.abs(dark * 20 - size * size * 10) / (size * size)) - 1;
    score += ratio * 10;
    return score;
  }

  /**
   * Encode text as a QR module matrix: { size, modules } where modules[y][x]
   * is true for a dark module.
   */
  function qrMatrix(text) {
    var bytes = utf8Bytes(text);
    var ver = 0;
    for (var v = 1; v <= MAX_VERSION; v++) {
      var ccBits = v <= 9 ? 8 : 16;
      if (4 + ccBits + bytes.length * 8 <= numDataCodewords(v) * 8) { ver = v; break; }
    }
    if (!ver) throw new Error('QR payload too long');
    var codewords = interleave(splitBlocks(buildCodewords(text, ver), ver));
    var base = newMatrix(ver * 4 + 17);
    drawFunctionPatterns(base, ver);
    drawCodewords(base, codewords);
    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      var candidate = {
        modules: base.modules.map(function (row) { return row.slice(); }),
        isFunction: base.isFunction,
        size: base.size
      };
      applyMask(candidate, mask);
      drawFormatBits(candidate, mask);
      var score = penalty(candidate);
      if (!best || score < best.score) best = { score: score, matrix: candidate };
    }
    return { size: best.matrix.size, modules: best.matrix.modules };
  }

  /** Render text as an inline SVG QR code (no external assets). */
  function qrSvg(text) {
    var qr = qrMatrix(text);
    var margin = 4;
    var size = qr.size;
    var parts = [];
    for (var y = 0; y < size; y++) {
      var x = 0;
      while (x < size) {
        if (qr.modules[y][x]) {
          var run = 1;
          while (x + run < size && qr.modules[y][x + run]) run++;
          parts.push('M' + x + ' ' + y + 'h' + run + 'v1h-' + run + 'z');
          x += run;
        } else {
          x++;
        }
      }
    }
    var dim = size + margin * 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (-margin) + ' ' + (-margin) + ' ' + dim + ' ' + dim +
      '" shape-rendering="crispEdges" role="img" aria-label="Subscription QR code" class="qr-svg">' +
      '<rect x="' + (-margin) + '" y="' + (-margin) + '" width="' + dim + '" height="' + dim + '" fill="#ffffff"/>' +
      '<path d="' + parts.join('') + '" fill="#000000"/></svg>';
  }

  // ── Subscription deep links ──────────────────────────────────────────────

  /** The feed's own directory URL, as served. */
  function feedUrl() {
    return new URL('.', window.location.href).href;
  }

  /**
   * Subscription deep link for the whole feed, or for one notebook
   * (the chunk id's slug, e.g. notebook.cat1 → cat1).
   */
  function subscribeUrl(notebookId) {
    var url = APP_ORIGIN + '/subscribe?source=' + encodeURIComponent(feedUrl());
    if (notebookId) {
      url += '&notebook=' + encodeURIComponent(String(notebookId).replace(/^notebook\\./, ''));
    }
    return url;
  }

  function each(root, selector, fn) {
    var nodes = root.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) fn(nodes[i]);
  }

  function render(root) {
    var feed = subscribeUrl(null);
    each(root, '[data-subscribe-feed]', function (el) { el.setAttribute('href', feed); });
    each(root, '[data-subscribe-notebook]', function (el) {
      el.setAttribute('href', subscribeUrl(el.getAttribute('data-subscribe-notebook')));
    });
    each(root, '[data-qr-feed]', function (el) { el.innerHTML = qrSvg(feed); });
    each(root, '[data-qr-notebook]', function (el) {
      el.innerHTML = qrSvg(subscribeUrl(el.getAttribute('data-qr-notebook')));
    });
  }

  var api = { feedUrl: feedUrl, subscribeUrl: subscribeUrl, qrSvg: qrSvg, qrMatrix: qrMatrix, render: render };
  window.wodFeedLanding = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { render(document); });
    } else {
      render(document);
    }
  }
})();`;
