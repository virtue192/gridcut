/* SPDX-License-Identifier: MIT */
"use strict";
const $ = (id) => document.getElementById(id);
const state = {
  image: null,
  format: "png",
  view: "original",
  busy: false,
  sourceUrl: null,
  version: 0,
  previewUrls: [],
  detail: null,
  loading: false,
};
const controls = ["rows", "cols", "marginX", "marginY", "gapX", "gapY"];
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
function notify(message, error = false) {
  $("status").textContent = message;
  $("status").className = "status show" + (error ? " error" : "");
}
function clearStatus() {
  $("status").className = "status";
}
function number(id, min, max) {
  const el = $(id);
  const n = Number(el.value);
  if (el.value.trim() === "" || !Number.isInteger(n) || n < min || n > max)
    throw new Error(
      `${el.closest("label").childNodes[0].textContent.trim()}需要填写 ${min}–${max} 的整数。`,
    );
  return n;
}
function geometry() {
  if (!state.image) throw new Error("请先选择一张图片。");
  return GridcutCore.computeGrid({
    width: state.image.naturalWidth,
    height: state.image.naturalHeight,
    rows: number("rows", 1, 30),
    cols: number("cols", 1, 30),
    marginX: number("marginX", 0, 10000),
    marginY: number("marginY", 0, 10000),
    gapX: number("gapX", 0, 10000),
    gapY: number("gapY", 0, 10000),
  });
}
function releasePreviews() {
  state.previewUrls.forEach(URL.revokeObjectURL);
  state.previewUrls = [];
}
function setBusy(busy) {
  state.busy = busy;
  document.body.classList.toggle("busy", busy);
  document
    .querySelectorAll(".settings button,.settings input,.view-switch button")
    .forEach((el) => (el.disabled = busy));
  $("singleDownload").disabled = busy;
  $("progress").classList.toggle("show", busy);
  if (!busy) {
    $("downloadText").textContent = "切分并下载 ZIP";
    $("progressBar").style.width = "0%";
    update(false);
  }
}
function filePrefix() {
  return (
    $("prefix")
      .value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/[. ]+$/g, "")
      .trim() || "photo"
  );
}
function fileName(cell) {
  return `${filePrefix()}_${String(cell.index).padStart(3, "0")}_r${cell.r}_c${cell.c}.${state.format}`;
}
function cropCanvas(cell) {
  const canvas = document.createElement("canvas");
  canvas.width = cell.w;
  canvas.height = cell.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器无法创建图片画布，请换用较新的浏览器。");
  if (state.format === "jpg") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cell.w, cell.h);
  }
  ctx.drawImage(
    state.image,
    cell.x,
    cell.y,
    cell.w,
    cell.h,
    0,
    0,
    cell.w,
    cell.h,
  );
  return canvas;
}
async function encodeCell(cell) {
  const canvas = cropCanvas(cell);
  const type = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[
    state.format
  ];
  try {
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, type, Number($("quality").value) / 100),
    );
    if (!blob) throw new Error("图片生成失败，请减少单张图片尺寸。");
    if (blob.type !== type)
      throw new Error(
        `当前浏览器不支持导出 ${state.format.toUpperCase()}，请切换为 PNG。`,
      );
    return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
function update(report = true) {
  state.version++;
  releasePreviews();
  $("tileView").replaceChildren();
  try {
    const g = geometry();
    $("downloadBtn").disabled = state.busy || state.loading;
    $("previewTag").textContent = `${g.rows} × ${g.cols} 宫格`;
    $("gridCount").textContent = `共 ${g.cells.length} 张独立图片`;
    $("outputCount").textContent = `将生成 ${g.cells.length} 张图片`;
    const widths = g.cells.map((c) => c.w),
      heights = g.cells.map((c) => c.h);
    const range = (a) =>
      Math.min(...a) === Math.max(...a)
        ? Math.min(...a)
        : `${Math.min(...a)}–${Math.max(...a)}`;
    $("cellSize").textContent =
      `单张 ${range(widths)} × ${range(heights)} px · 原尺寸`;
    $("gridOverlay").replaceChildren();
    for (const cell of g.cells) {
      const frame = document.createElement("div");
      frame.className = "cell-frame";
      Object.assign(frame.style, {
        left: `${(cell.x / g.w) * 100}%`,
        top: `${(cell.y / g.h) * 100}%`,
        width: `${(cell.w / g.w) * 100}%`,
        height: `${(cell.h / g.h) * 100}%`,
      });
      if ($("showNumbers").checked) {
        const num = document.createElement("span");
        num.className = "cell-number";
        num.textContent = String(cell.index).padStart(2, "0");
        frame.append(num);
      }
      $("gridOverlay").append(frame);
    }
    document.querySelectorAll(".preset").forEach((b) => {
      const active =
        Number(b.dataset.rows) === g.rows && Number(b.dataset.cols) === g.cols;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    if (report) clearStatus();
    if (state.view === "tiles") renderTiles(g, state.version);
  } catch (e) {
    $("downloadBtn").disabled = true;
    $("gridOverlay").replaceChildren();
    $("gridCount").textContent = "请检查切分设置";
    $("outputCount").textContent = "参数待调整";
    if (report) notify(e.message, true);
  }
}
async function renderTiles(g, version) {
  try {
    for (const cell of g.cells) {
      if (version !== state.version) return;
      const srcCanvas = cropCanvas(cell);
      const thumb = document.createElement("canvas");
      const scale = Math.min(1, 220 / Math.max(cell.w, cell.h));
      thumb.width = Math.max(1, Math.round(cell.w * scale));
      thumb.height = Math.max(1, Math.round(cell.h * scale));
      thumb
        .getContext("2d")
        .drawImage(srcCanvas, 0, 0, thumb.width, thumb.height);
      srcCanvas.width = 0;
      srcCanvas.height = 0;
      const blob = await new Promise((r) => thumb.toBlob(r, "image/png"));
      thumb.width = 0;
      thumb.height = 0;
      if (version !== state.version) return;
      if (!blob) throw new Error("预览生成失败。");
      const url = URL.createObjectURL(blob);
      state.previewUrls.push(url);
      const button = document.createElement("button");
      button.className = "tile";
      button.setAttribute("aria-label", `查看第 ${cell.index} 张图片`);
      const img = new Image();
      img.src = url;
      img.alt = `第 ${cell.r} 行，第 ${cell.c} 列`;
      const caption = document.createElement("span");
      caption.append(
        document.createTextNode(String(cell.index).padStart(2, "0")),
      );
      const size = document.createElement("small");
      size.textContent = `${cell.w} × ${cell.h}`;
      caption.append(size);
      button.append(img, caption);
      button.addEventListener("click", () => openDetail(cell));
      $("tileView").append(button);
    }
  } catch (e) {
    notify(e.message, true);
  }
}
function setView(view) {
  state.view = view;
  $("imageWrap").hidden = view !== "original" || !state.image;
  $("tileView").hidden = view !== "tiles";
  $("originalView").classList.toggle("active", view === "original");
  $("tilesView").classList.toggle("active", view === "tiles");
  $("originalView").setAttribute("aria-pressed", String(view === "original"));
  $("tilesView").setAttribute("aria-pressed", String(view === "tiles"));
  update(false);
}
async function loadImage(file, isDemo = false) {
  if (state.busy || state.loading) return;
  if (
    !file ||
    !(
      /^image\/(png|jpeg|webp|bmp|x-ms-bmp|gif)$/i.test(file.type) ||
      /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name || "")
    )
  ) {
    notify("请选择 PNG、JPG、WebP、BMP 或 GIF 图片。", true);
    return;
  }
  if (file.size > 60 * 1024 * 1024) {
    notify("图片超过 60 MB，请先缩小文件。", true);
    return;
  }
  state.loading = true;
  $("downloadBtn").disabled = true;
  let url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (img.naturalWidth * img.naturalHeight > 60000000)
      throw new Error("图片超过 6000 万像素，请先缩小图片。");
    if (file.type === "image/gif" || /\.gif$/i.test(file.name)) {
      const bitmap = await createImageBitmap(file);
      const still = document.createElement("canvas");
      still.width = bitmap.width;
      still.height = bitmap.height;
      still.getContext("2d").drawImage(bitmap, 0, 0);
      bitmap.close();
      const frozen = await new Promise((resolve) =>
        still.toBlob(resolve, "image/png"),
      );
      still.width = 0;
      still.height = 0;
      if (!frozen) throw new Error("GIF 解码失败");
      URL.revokeObjectURL(url);
      url = URL.createObjectURL(frozen);
      img.src = url;
      await img.decode();
    }
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    state.sourceUrl = url;
    url = null;
    state.image = img;
    $("sourceImage").src = img.src;
    $("sourceName").textContent = isDemo ? "示例 · 4×4 几何拼图" : file.name;
    $("sourceName").title = file.name;
    $("sourceSize").textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
    $("empty").hidden = true;
    for (const id of ["marginX", "marginY", "gapX", "gapY"]) $(id).value = 0;
    $("detailDialog").close();
    setView(state.view);
    if (!isDemo) notify("图片已载入。请按实际排版设置行数和列数。");
  } catch (e) {
    notify(
      e.message.includes("像素")
        ? e.message
        : "这张图片无法读取，请选择有效的图片文件。",
      true,
    );
  } finally {
    if (url) URL.revokeObjectURL(url);
    state.loading = false;
    update(false);
  }
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function openDetail(cell) {
  if (state.busy) return;
  setBusy(true);
  try {
    const blob = await encodeCell(cell);
    if (state.detail) URL.revokeObjectURL(state.detail.url);
    const url = URL.createObjectURL(blob);
    state.detail = { blob, url, name: fileName(cell) };
    $("detailImage").src = url;
    $("detailTitle").textContent =
      `第 ${String(cell.index).padStart(2, "0")} 张图片`;
    $("detailSize").textContent =
      `第 ${cell.r} 行，第 ${cell.c} 列 · ${cell.w} × ${cell.h} px · ${state.format.toUpperCase()}`;
    $("detailDialog").showModal();
  } catch (e) {
    notify(e.message, true);
  } finally {
    setBusy(false);
  }
}
async function downloadAll() {
  if (state.busy || state.loading) return;
  let g;
  try {
    g = geometry();
  } catch (e) {
    notify(e.message, true);
    return;
  }
  setBusy(true);
  clearStatus();
  try {
    const files = [];
    let total = 0;
    for (const cell of g.cells) {
      $("downloadText").textContent =
        `正在切分 ${cell.index} / ${g.cells.length}`;
      $("progressBar").style.width = `${(cell.index / g.cells.length) * 90}%`;
      const blob = await encodeCell(cell);
      total += blob.size;
      if (total > 200 * 1024 * 1024)
        throw new Error(
          "生成图片总量超过 200 MB。请改用 JPG / WebP，或降低质量后重试。",
        );
      files.push({
        name: fileName(cell),
        data: new Uint8Array(await blob.arrayBuffer()),
      });
      await pause();
    }
    $("downloadText").textContent = "正在打包…";
    await pause();
    const zip = GridcutCore.createZip(files);
    $("progressBar").style.width = "100%";
    saveBlob(zip, `${filePrefix()}_${g.rows}x${g.cols}.zip`);
    notify(
      `已生成 ${g.cells.length} 张 ${state.format.toUpperCase()} 图片，ZIP 下载已开始。`,
    );
  } catch (e) {
    notify(e.message || "导出失败，请重试或换用 PNG 格式。", true);
  } finally {
    setBusy(false);
  }
}
controls.forEach((id) =>
  $(id).addEventListener("input", () => {
    if (!state.busy) update();
  }),
);
document.querySelectorAll(".preset").forEach((b) =>
  b.addEventListener("click", () => {
    $("rows").value = b.dataset.rows;
    $("cols").value = b.dataset.cols;
    update();
  }),
);
document.querySelectorAll(".format").forEach((b) =>
  b.addEventListener("click", () => {
    state.format = b.dataset.format;
    document.querySelectorAll(".format").forEach((el) => {
      el.classList.toggle("active", el === b);
      el.setAttribute("aria-pressed", String(el === b));
    });
    $("qualityWrap").hidden = state.format === "png";
    $("formatHint").textContent = {
      png: "无损画质 · 保留透明背景",
      jpg: "更小体积 · 透明区域填充白色",
      webp: "轻量画质 · 保留透明背景",
    }[state.format];
    update();
  }),
);
$("quality").addEventListener("input", () => {
  $("qualityValue").value = $("quality").value + "%";
});
$("uploadBtn").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", (e) => {
  loadImage(e.target.files[0]);
  e.target.value = "";
});
document.addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    $("uploadBtn").classList.add("drag");
  }
});
document.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) $("uploadBtn").classList.remove("drag");
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  $("uploadBtn").classList.remove("drag");
  const files = [...e.dataTransfer.files];
  if (files.length) loadImage(files[0]);
});
document.addEventListener("paste", (e) => {
  const item = [...e.clipboardData.items].find((i) =>
    i.type.startsWith("image/"),
  );
  if (item) {
    e.preventDefault();
    loadImage(item.getAsFile());
  }
});
$("originalView").addEventListener("click", () => setView("original"));
$("tilesView").addEventListener("click", () => setView("tiles"));
$("showNumbers").addEventListener("change", () => update(false));
$("downloadBtn").addEventListener("click", downloadAll);
$("singleDownload").addEventListener("click", () => {
  if (state.detail) saveBlob(state.detail.blob, state.detail.name);
});
$("helpBtn").addEventListener("click", () => $("helpDialog").showModal());
document
  .querySelectorAll("[data-close]")
  .forEach((b) =>
    b.addEventListener("click", () => $(b.dataset.close).close()),
  );
document.querySelectorAll("dialog").forEach((d) =>
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        d.close();
    }
  }),
);
// Build a small, original demo locally; no bundled or remote images.
function createDemo() {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1200;
  const ctx = canvas.getContext("2d");
  const palettes = [
    ["#ddd0f6", "#7955db"],
    ["#ffebad", "#e9a236"],
    ["#c5eefa", "#389fc0"],
    ["#ffd8ca", "#dc886d"],
    ["#fae8d3", "#b8886b"],
    ["#d4eee3", "#6ba98d"],
    ["#e9d9f4", "#9e77c0"],
    ["#e2ebc9", "#9aa663"],
    ["#d7dcf4", "#7580b5"],
    ["#cde9ed", "#4a9aa7"],
    ["#f3d1dd", "#c07291"],
    ["#dfdaf7", "#8f7bbe"],
    ["#cfe1fa", "#6999d0"],
    ["#fae8b0", "#c39b48"],
    ["#f7d6ce", "#d59080"],
    ["#d8ebd2", "#82a779"],
  ];
  palettes.forEach(([bg, fg], i) => {
    const x = (i % 4) * 300;
    const y = Math.floor(i / 4) * 300;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, 300, 300);
    ctx.save();
    ctx.translate(x + 150, y + 135);
    ctx.rotate(((i % 4) * Math.PI) / 8);
    ctx.fillStyle = fg;
    if (i % 3 === 0) {
      ctx.beginPath();
      ctx.arc(0, 0, 73, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(0, 0, 35, 0, Math.PI * 2);
      ctx.fill();
    } else if (i % 3 === 1) {
      ctx.fillRect(-60, -60, 120, 120);
      ctx.fillStyle = "#ffffff88";
      ctx.fillRect(-35, -35, 70, 70);
    } else {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const r = k % 2 ? 40 : 80;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = fg;
    ctx.font = "500 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      "GRIDCUT / " + String(i + 1).padStart(2, "0"),
      x + 150,
      y + 260,
    );
  });
  canvas.toBlob((blob) => {
    if (blob)
      loadImage(
        new File([blob], "gridcut-demo.png", { type: "image/png" }),
        true,
      );
  }, "image/png");
}
createDemo();
