const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeGrid, createZip, crc32 } = require("../core.js");

test("odd dimensions cover the entire source without overlap or missing pixels", () => {
  const { cells } = computeGrid({
    width: 1254,
    height: 1254,
    rows: 4,
    cols: 4,
  });
  assert.equal(cells.length, 16);
  assert.equal(
    cells.reduce((sum, c) => sum + c.w * c.h, 0),
    1254 * 1254,
  );
  assert.deepEqual(
    cells.slice(0, 4).map((c) => c.w),
    [314, 313, 314, 313],
  );
  for (const cell of cells) {
    assert.ok(cell.w > 0 && cell.h > 0);
    if (cell.c < 4) assert.equal(cell.x + cell.w, cells[cell.index].x);
    else assert.equal(cell.x + cell.w, 1254);
    if (cell.r < 4) assert.equal(cell.y + cell.h, cells[cell.index + 3].y);
    else assert.equal(cell.y + cell.h, 1254);
  }
});

test("rectangular grids exclude only specified margins and gaps", () => {
  const { cells } = computeGrid({
    width: 35,
    height: 27,
    rows: 2,
    cols: 3,
    marginX: 1,
    marginY: 2,
    gapX: 2,
    gapY: 3,
  });
  assert.deepEqual(
    cells.map((c) => [c.x, c.y, c.w, c.h]),
    [
      [1, 2, 10, 10],
      [13, 2, 9, 10],
      [24, 2, 10, 10],
      [1, 15, 10, 10],
      [13, 15, 9, 10],
      [24, 15, 10, 10],
    ],
  );
  assert.deepEqual(
    cells.map((c) => [c.index, c.r, c.c]),
    [
      [1, 1, 1],
      [2, 1, 2],
      [3, 1, 3],
      [4, 2, 1],
      [5, 2, 2],
      [6, 2, 3],
    ],
  );
});

test("small dimensions remain fully covered across grid shapes", () => {
  for (let width = 1; width <= 25; width++)
    for (let height = 1; height <= 19; height++) {
      for (let rows = 1; rows <= Math.min(height, 5); rows++)
        for (let cols = 1; cols <= Math.min(width, 5); cols++) {
          const { cells } = computeGrid({ width, height, rows, cols });
          const covered = new Uint8Array(width * height);
          for (const c of cells)
            for (let y = c.y; y < c.y + c.h; y++)
              for (let x = c.x; x < c.x + c.w; x++) covered[y * width + x]++;
          assert.ok(
            covered.every((count) => count === 1),
            `${width}x${height}, ${rows}x${cols}`,
          );
        }
    }
});

test("invalid dimensions, grid counts and margins are rejected", () => {
  const valid = { width: 100, height: 100, rows: 4, cols: 4 };
  for (const bad of [
    { width: 0 },
    { height: NaN },
    { rows: 0 },
    { cols: 31 },
    { rows: 2.5 },
    { rows: 30, cols: 30 },
    { marginX: -1 },
    { gapX: 0.5 },
    { marginY: 10001 },
    { marginX: 50 },
    { gapY: 34 },
    { width: 3 },
  ])
    assert.throws(() => computeGrid({ ...valid, ...bad }));
  assert.equal(
    computeGrid({ width: 1, height: 1, rows: 1, cols: 1 }).cells[0].w,
    1,
  );
});

test("CRC32 matches standard check vectors", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test("ZIP local entries, UTF-8 names, CRCs and central offsets agree", async () => {
  const input = [
    { name: "中文照片_001.png", data: new Uint8Array([0, 1, 2, 3, 255]) },
    { name: "empty.txt", data: new Uint8Array() },
  ];
  const blob = createZip(input);
  assert.equal(blob.type, "application/zip");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const u16 = (offset) => view.getUint16(offset, true);
  const u32 = (offset) => view.getUint32(offset, true);
  let offset = 0;
  const offsets = [];
  for (const file of input) {
    offsets.push(offset);
    assert.equal(u32(offset), 0x04034b50);
    assert.equal(u16(offset + 6), 0x800);
    assert.equal(u16(offset + 8), 0);
    assert.equal(u32(offset + 14), crc32(file.data));
    assert.equal(u32(offset + 18), file.data.length);
    const length = u16(offset + 26);
    assert.equal(
      new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + length)),
      file.name,
    );
    assert.deepEqual(
      bytes.slice(
        offset + 30 + length,
        offset + 30 + length + file.data.length,
      ),
      file.data,
    );
    offset += 30 + length + file.data.length;
  }
  const centralStart = offset;
  input.forEach((file, i) => {
    assert.equal(u32(offset), 0x02014b50);
    assert.equal(u32(offset + 42), offsets[i]);
    assert.equal(u32(offset + 16), crc32(file.data));
    const length = u16(offset + 28);
    assert.equal(
      new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + length)),
      file.name,
    );
    offset += 46 + length;
  });
  assert.equal(u32(offset), 0x06054b50);
  assert.equal(u16(offset + 8), input.length);
  assert.equal(u16(offset + 10), input.length);
  assert.equal(u32(offset + 12), offset - centralStart);
  assert.equal(u32(offset + 16), centralStart);
  assert.equal(offset + 22, bytes.length);
});

test("empty ZIP remains a valid end-of-central-directory record", async () => {
  const bytes = await createZip([]).arrayBuffer();
  assert.equal(bytes.byteLength, 22);
  assert.equal(new DataView(bytes).getUint32(0, true), 0x06054b50);
});
