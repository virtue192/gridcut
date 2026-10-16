/* SPDX-License-Identifier: MIT */
(function (root) {
  "use strict";

  /** Divide integer pixels cumulatively, preserving every usable pixel. */
  function computeGrid({
    width,
    height,
    rows,
    cols,
    marginX = 0,
    marginY = 0,
    gapX = 0,
    gapY = 0,
  }) {
    if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0)) {
      throw new Error("图片宽高必须为正整数。");
    }
    if (![rows, cols].every((n) => Number.isInteger(n) && n >= 1 && n <= 30)) {
      throw new Error("行数和列数需要填写 1–30 的整数。");
    }
    if (rows * cols > 400)
      throw new Error("一次最多切分 400 张，请减少行数或列数。");
    if (
      ![marginX, marginY, gapX, gapY].every(
        (n) => Number.isInteger(n) && n >= 0 && n <= 10000,
      )
    ) {
      throw new Error("边距和间距需要填写 0–10000 的整数。");
    }
    const usableWidth = width - 2 * marginX - (cols - 1) * gapX;
    const usableHeight = height - 2 * marginY - (rows - 1) * gapY;
    if (usableWidth < cols || usableHeight < rows) {
      throw new Error("边距或间距过大，每一格至少需要保留 1 × 1 像素。");
    }
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = Math.round((c * usableWidth) / cols);
        const x1 = Math.round(((c + 1) * usableWidth) / cols);
        const y0 = Math.round((r * usableHeight) / rows);
        const y1 = Math.round(((r + 1) * usableHeight) / rows);
        cells.push({
          x: marginX + x0 + c * gapX,
          y: marginY + y0 + r * gapY,
          w: x1 - x0,
          h: y1 - y0,
          r: r + 1,
          c: c + 1,
          index: cells.length + 1,
        });
      }
    }
    return { rows, cols, cells, w: width, h: height };
  }

  // ZIP (stored entries): no third-party libraries, no network requests.
  const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function header(size, fields) {
    const data = new Uint8Array(size),
      view = new DataView(data.buffer);
    for (const [offset, n, value] of fields) {
      if (n === 2) view.setUint16(offset, value, true);
      else view.setUint32(offset, value, true);
    }
    return data;
  }
  function createZip(files) {
    const utf8 = new TextEncoder(),
      local = [],
      central = [];
    let offset = 0,
      centralSize = 0;
    const now = new Date(),
      date =
        ((now.getFullYear() - 1980) << 9) |
        ((now.getMonth() + 1) << 5) |
        now.getDate(),
      time =
        (now.getHours() << 11) |
        (now.getMinutes() << 5) |
        (now.getSeconds() >> 1);
    for (const f of files) {
      const name = utf8.encode(f.name),
        size = f.data.length,
        crc = crc32(f.data);
      const lh = header(30, [
        [0, 4, 0x04034b50],
        [4, 2, 20],
        [6, 2, 0x800],
        [8, 2, 0],
        [10, 2, time],
        [12, 2, date],
        [14, 4, crc],
        [18, 4, size],
        [22, 4, size],
        [26, 2, name.length],
        [28, 2, 0],
      ]);
      local.push(lh, name, f.data);
      const ch = header(46, [
        [0, 4, 0x02014b50],
        [4, 2, 20],
        [6, 2, 20],
        [8, 2, 0x800],
        [10, 2, 0],
        [12, 2, time],
        [14, 2, date],
        [16, 4, crc],
        [20, 4, size],
        [24, 4, size],
        [28, 2, name.length],
        [30, 2, 0],
        [32, 2, 0],
        [34, 2, 0],
        [36, 2, 0],
        [38, 4, 0],
        [42, 4, offset],
      ]);
      central.push(ch, name);
      offset += 30 + name.length + size;
      centralSize += 46 + name.length;
    }
    const end = header(22, [
      [0, 4, 0x06054b50],
      [4, 2, 0],
      [6, 2, 0],
      [8, 2, files.length],
      [10, 2, files.length],
      [12, 4, centralSize],
      [16, 4, offset],
      [20, 2, 0],
    ]);
    return new Blob([...local, ...central, end], { type: "application/zip" });
  }

  const api = Object.freeze({ computeGrid, createZip, crc32 });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GridcutCore = api;
})(globalThis);
