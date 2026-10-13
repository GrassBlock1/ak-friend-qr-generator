import jsQR from "jsqr";
import qrcodegen from "@ribpay/qr-code-generator";

const $ = (id) => document.getElementById(id);
const ECC = {
  L: qrcodegen.QrCode.Ecc.LOW,
  M: qrcodegen.QrCode.Ecc.MEDIUM,
  Q: qrcodegen.QrCode.Ecc.QUARTILE,
  H: qrcodegen.QrCode.Ecc.HIGH,
};
const BASE = "https://ak.hypergryph.com/special/friend-funnel/";
const LOGO_MAX_BYTES = 8 * 1024 * 1024;

const state = {
  url: "",
  qr: null,
  bgImage: null,
  logo: null,
  pos: { fx: 0.78, fy: 0.82 },
  pasteTarget: "bg",
};

let toastTimer = 0;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ---------- 1. 链接 ---------- */

// 已经过百分号编码的值不再二次编码
function encodeValue(v) {
  return /%[0-9a-fA-F]{2}/.test(v) ? v.replace(/[ ]/g, "%20") : encodeURIComponent(v);
}

// 选填参数：留空时使用游戏默认值，拼在必填参数之后
const OPTIONAL_PARAMS = [
  { key: "skinId", def: "nc" },
  { key: "skinTmpl", def: "1" },
  { key: "avatarId", def: "avatar" },
];

function buildUrl() {
  const uid = $("uid").value.trim();
  const name = $("nickName").value.trim();
  const num = $("nickNum").value.trim();
  const missing = [];
  if (!uid) missing.push("UID");
  if (!name) missing.push("昵称");
  if (!num) missing.push("编号");
  if (missing.length) return { missing: missing };
  const tail = OPTIONAL_PARAMS.map(
    ({ key, def }) => `${key}=${encodeValue($(key).value.trim() || def)}`,
  ).join("&");
  return {
    url: `${BASE}?uid=${encodeValue(uid)}&nickName=${encodeValue(name)}&nickNum=${encodeValue(num)}&${tail}`,
  };
}

// 从别人分享的完整链接里拆出字段（选填项不存在时保留 null，便于区分「没有」和「留空」）
function parseLink(text) {
  if (!/uid=/.test(text) || !/nickName=/.test(text)) return null;
  const q = text.indexOf("?");
  let params;
  try {
    params = new URLSearchParams(q >= 0 ? text.slice(q + 1) : text);
  } catch (err) {
    return null;
  }
  const uid = params.get("uid");
  const name = params.get("nickName");
  const num = params.get("nickNum");
  if (!uid && !name && !num) return null;
  return {
    uid: uid || "",
    name: name || "",
    num: num || "",
    extra: OPTIONAL_PARAMS.map(({ key }) => params.get(key)),
  };
}

// 把解析结果写入输入框（选填项在链接里缺失时，保留用户已填内容）
function applyParsedLink(parsed) {
  $("uid").value = parsed.uid;
  $("nickName").value = parsed.name;
  $("nickNum").value = parsed.num;
  let kept = 0;
  OPTIONAL_PARAMS.forEach(({ key }, i) => {
    const v = parsed.extra[i];
    if (v === null) return;
    $(key).value = v;
    kept++;
  });
  updateUrl();
  return kept;
}

/* ---------- 1b. 图片里的二维码识别 ---------- */

const QR_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

function setQrMsg(text, kind) {
  const el = $("qrMsg");
  el.className = "msg" + (kind ? " " + kind : "");
  el.textContent = text;
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片无法解码"));
    img.src = src;
  });
}

// 在若干缩放比例下尝试识别，返回二维码文本（识别不到时为空串）
function decodeQrFromImage(img) {
  const maxSide = 1600;
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const base = Math.min(1, maxSide / longest);
  const scales = [base];
  if (longest < 700) scales.push(base * 2); // 小图放大后再试
  if (img.naturalWidth * img.naturalHeight > maxSide * maxSide) scales.push(base * 0.5); // 大图降采样再试
  for (const scale of scales) {
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#ffffff"; // 透明 PNG 先补白
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h);
    const found = jsQR(pixels.data, w, h, { inversionAttempts: "attemptBoth" });
    if (found && found.data) return found.data;
  }
  return "";
}

async function recognizeQrImage(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setQrMsg("请选择图片文件（PNG / JPG / WebP）。", "err");
    return;
  }
  if (file.size > QR_IMAGE_MAX_BYTES) {
    setQrMsg("图片过大（超过 20MB），压缩后再试。", "err");
    return;
  }
  setQrMsg("正在识别…");
  await new Promise((r) => setTimeout(r, 0)); // 让提示先渲染出来
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    const text = decodeQrFromImage(img);
    if (!text) {
      setQrMsg("没有识别到二维码。换一张更清晰以及二维码更完整的图片再试。", "err");
      return;
    }
    const parsed = parseLink(text);
    if (!parsed) {
      const brief = text.length > 120 ? `${text.slice(0, 120)}…` : text;
      setQrMsg(`识别到二维码，但内容不是好友邀请链接：${brief}`, "warn");
      return;
    }
    const kept = applyParsedLink(parsed);
    setQrMsg("识别成功，已自动填入", "ok");
    toast("识别成功，已填入邀请信息");
  } catch (err) {
    setQrMsg(`识别失败：${err.message}`, "err");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function updateUrl() {
  const res = buildUrl();
  const msg = $("infoMsg");
  if (res.missing && res.missing.length === 3) {
    state.url = "";
    $("urlOut").value = "";
    msg.className = "msg hint";
    msg.textContent = "填入 UID、昵称、编号后会自动生成链接和对应的二维码。";
    render();
    return;
  }
  if (res.missing) {
    state.url = "";
    $("urlOut").value = "";
    msg.className = "msg err";
    msg.textContent = `缺少必填项：${res.missing.join("、")}`;
  } else {
    state.url = res.url;
    $("urlOut").value = res.url;
    const soft = [];
    if (!/^\d+$/.test($("uid").value.trim())) soft.push("UID 通常是一串数字");
    if (!/^\d+$/.test($("nickNum").value.trim())) soft.push("编号通常是数字");
    if (soft.length) {
      msg.className = "msg warn";
      msg.textContent = `已生成，但请注意：${soft.join("；")}。`;
    } else {
      msg.className = "msg ok";
      msg.textContent = "链接已生成，可直接复制链接分享，也可以在下一步美化后保存二维码。\n请注意：bilibili 服和官服共享同一个好友链接，所以请在分享链接或二维码时注明自己所在的服务器。";
    }
  }
  render();
}

/* ---------- 2. 绘制二维码 ---------- */

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(typeof r === "number" ? r : 0, Math.min(w, h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function roundRectCornersPath(ctx, x, y, w, h, radii) {
  const m = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.min(r, m));
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function relativeLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const v = parseInt(m[1], 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

function drawFinder(ctx, x0, y0, col, row, cell, style, fgPaint, holeFill) {
  const s = 7 * cell;
  const x = x0 + col * cell;
  const y = y0 + row * cell;
  const outerR = style === "circle" ? s / 2 : style === "rounded" ? s * 0.22 : 0;

  ctx.fillStyle = fgPaint;
  roundRectPath(ctx, x, y, s, s, outerR);
  ctx.fill();

  const off = s / 7;
  holeFill(ctx, x + off, y + off, s * 5 / 7, outerR * 5 / 7);

  ctx.fillStyle = fgPaint;
  const dot = (s * 3) / 7;
  roundRectPath(ctx, x + off * 2, y + off * 2, dot, dot, (outerR * 3) / 7);
  ctx.fill();
}

function renderQR() {
  const canvas = $("qrPreview");
  const ctx = canvas.getContext("2d");
  const outSize = parseInt($("outSize").value, 10);
  const quiet = parseInt($("quiet").value, 10);
  const ecc = $("ecc").value;
  const dotStyle = $("dotStyle").value;
  const cornerStyle = $("cornerStyle").value;
  const fg1 = $("fg1").value;
  const fg2 = $("fg2").value;
  const useGradient = $("useGradient").checked;
  const gradAngle = parseInt($("gradAngle").value, 10);
  const bgColor = $("bgColor").value;
  const transparent = $("transparentBg").checked;
  const bgRadius = parseFloat($("bgRadius").value);
  const logoPlateOn = $("logoPlateOn").checked;
  const logoPlateColor = $("logoPlateColor").value;
  const logoPlatePad = parseFloat($("logoPlatePad").value);
  const logoPlateRadius = parseFloat($("logoPlateRadius").value);
  const logoRatio = parseFloat($("logoRatio").value);

  const info = $("qrInfo");
  const warn = $("qrWarn");
  warn.textContent = "";
  state.qr = null;

  canvas.width = canvas.height = outSize;
  ctx.clearRect(0, 0, outSize, outSize);

  if (!state.url) {
    info.className = "msg err";
    info.textContent = "请先填写完整的信息。";
    setDownloadEnabled(false);
    return;
  }

  let qr;
  try {
    const segs = qrcodegen.QrSegment.makeSegments(state.url);
    qr = qrcodegen.QrCode.encodeSegments(segs, ECC[ecc], 1, 40, -1, false);
  } catch (err) {
    info.className = "msg err";
    info.textContent = `生成失败：${err.message}（内容过长，可降低容错等级）`;
    setDownloadEnabled(false);
    return;
  }
  state.qr = qr;

  const total = qr.size + quiet * 2;
  const cell = outSize / total;
  const x0 = quiet * cell;
  const y0 = quiet * cell;

  if (!transparent) {
    ctx.fillStyle = bgColor;
    if (bgRadius > 0) {
      roundRectPath(ctx, 0, 0, outSize, outSize, outSize * bgRadius);
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, outSize, outSize);
    }
  }

  let fgPaint = fg1;
  if (useGradient) {
    const a = (gradAngle * Math.PI) / 180;
    const cx = outSize / 2;
    const cy = outSize / 2;
    const r = outSize / 2;
    const g = ctx.createLinearGradient(
      cx - Math.cos(a) * r,
      cy - Math.sin(a) * r,
      cx + Math.cos(a) * r,
      cy + Math.sin(a) * r,
    );
    g.addColorStop(0, fg1);
    g.addColorStop(1, fg2);
    fgPaint = g;
  }

  const holeFill = (c, x, y, size, radius) => {
    ctx.save();
    if (transparent) ctx.globalCompositeOperation = "destination-out";
    else ctx.fillStyle = bgColor;
    roundRectPath(c, x, y, size, size, radius);
    c.fill();
    c.restore();
  };

  const isFinder = (x, y) => {
    const n = qr.size;
    return (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
  };
  const isDark = (x, y) => x >= 0 && y >= 0 && x < qr.size && y < qr.size && qr.getModule(x, y);

  ctx.fillStyle = fgPaint;
  for (let my = 0; my < qr.size; my++) {
    for (let mx = 0; mx < qr.size; mx++) {
      if (!isDark(mx, my) || isFinder(mx, my)) continue;
      const px = x0 + mx * cell;
      const py = y0 + my * cell;
      if (dotStyle === "circle") {
        ctx.beginPath();
        ctx.arc(px + cell / 2, py + cell / 2, cell / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (dotStyle === "square") {
        ctx.fillRect(px, py, cell, cell);
      } else if (dotStyle === "rounded") {
        roundRectPath(ctx, px, py, cell, cell, cell * 0.3);
        ctx.fill();
      } else {
        const up = isDark(mx, my - 1);
        const down = isDark(mx, my + 1);
        const left = isDark(mx - 1, my);
        const right = isDark(mx + 1, my);
        const r = cell / 2;
        roundRectCornersPath(ctx, px, py, cell, cell, [
          up && left ? 0 : r,
          up && right ? 0 : r,
          down && right ? 0 : r,
          down && left ? 0 : r,
        ]);
        ctx.fill();
      }
    }
  }

  drawFinder(ctx, x0, y0, 0, 0, cell, cornerStyle, fgPaint, holeFill);
  drawFinder(ctx, x0, y0, qr.size - 7, 0, cell, cornerStyle, fgPaint, holeFill);
  drawFinder(ctx, x0, y0, 0, qr.size - 7, cell, cornerStyle, fgPaint, holeFill);

  if (state.logo) {
    const qrPx = qr.size * cell;
    const size = qrPx * logoRatio;
    const cx = x0 + qrPx / 2;
    const cy = y0 + qrPx / 2;
    if (logoPlateOn) {
      const box = size * (1 + logoPlatePad * 2);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.18)";
      ctx.shadowBlur = box * 0.12;
      ctx.fillStyle = logoPlateColor;
      roundRectPath(ctx, cx - box / 2, cy - box / 2, box, box, box * logoPlateRadius);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    roundRectPath(ctx, cx - size / 2, cy - size / 2, size, size, size * (logoPlateOn ? 0.16 : 0.12));
    ctx.clip();
    ctx.drawImage(state.logo, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
  }

  const notes = [`版本 ${qr.version}`, `矩阵 ${qr.size}×${qr.size}`, `容错 ${ecc}`, `边距 ${quiet}`];
  info.className = "msg";
  info.innerHTML = notes.map((n) => `<span class="tag">${n}</span>`).join("");

  const warns = [];
  if (qr.version > 20) warns.push("数据点密度较大，建议输出尺寸 ≥ 1024，打印或者缩小图片后可能更难扫。");
  if (state.logo && logoRatio > 0.25) warns.push("Logo 偏大，建议不超过整体尺寸的 25% 或使用 H 级容错。");
  if (state.logo && ecc !== "H") warns.push("推荐使用 H 级容错以提高识别率。");
  if (transparent) {
    // 透明底色下没有可比较的背景色，跳过对比度检查
    warns.push(
      "二维码没有自带背景时，叠在颜色相近或较复杂的底图上可能无法识别，若要提高识别成功率，可关闭「背景透明」并设置背景色与背景圆角。",
    );
  } else {
    for (const c of useGradient ? [fg1, fg2] : [fg1]) {
      const ratio = contrastRatio(c, bgColor);
      if (ratio < 3) {
        warns.push(`前景 ${c} 与背景对比度偏低（${ratio.toFixed(1)}:1），可能无法正确识别。`);
        break;
      }
    }
    // 圆角把直角斜切掉的深度超过留白时，会切进码点
    if (bgRadius * outSize * (1 - Math.SQRT2 / 2) > quiet * cell)
      warns.push("背景圆角过大，可能会裁到二维码码点，建议减小圆角或增大边距。");
  }
  warn.textContent = warns.join("\n");
  setDownloadEnabled(true);
  renderCollage();
}

function setDownloadEnabled(enabled) {
  $("saveQr").disabled = !enabled;
  $("copyQr").disabled = !enabled;
  const collageOk = enabled && !!state.bgImage;
  $("saveCollage").disabled = !collageOk;
  $("copyCollage").disabled = !collageOk;
}

/* ---------- 3. 拼贴 ---------- */

function clampPos() {
  const box = $("collageCanvas");
  if (!box.width || !box.height || !state.qr) return;
  const size = $("qrRatio").value * box.width;
  const halfX = size / 2 / box.width;
  const halfY = size / 2 / box.height;
  state.pos.fx = Math.min(1 - halfX, Math.max(halfX, state.pos.fx));
  state.pos.fy = Math.min(1 - halfY, Math.max(halfY, state.pos.fy));
}

// 位置输入框与 state.pos 双向同步；正在输入的框不覆盖，避免打断输入
function syncPosInputs() {
  const canvas = $("collageCanvas");
  const x = $("posX");
  const y = $("posY");
  const ok = !!state.bgImage && !!state.qr && canvas.width > 0 && canvas.height > 0;
  x.disabled = y.disabled = !ok;
  if (!ok) {
    x.value = "";
    y.value = "";
    return;
  }
  const size = parseFloat($("qrRatio").value) * canvas.width;
  const half = size / 2;
  x.min = String(Math.round(half));
  x.max = String(Math.round(canvas.width - half));
  y.min = String(Math.round(half));
  y.max = String(Math.round(canvas.height - half));
  if (document.activeElement !== x) x.value = String(Math.round(state.pos.fx * canvas.width));
  if (document.activeElement !== y) y.value = String(Math.round(state.pos.fy * canvas.height));
}

function renderCollage() {
  const canvas = $("collageCanvas");
  const box = $("canvasBox");
  const info = $("collageInfo");
  if (!state.bgImage) {
    box.hidden = true;
    canvas.width = canvas.height = 0;
    info.className = "msg hint";
    info.textContent = "还没有底图，请先拖入或者粘贴一张图片。";
    syncPosInputs();
    setDownloadEnabled(!!state.qr);
    return;
  }
  const ctx = canvas.getContext("2d");
  const img = state.bgImage;
  const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  box.hidden = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  if (state.qr) {
    const qrCanvas = $("qrPreview");
    const size = Math.round(parseFloat($("qrRatio").value) * canvas.width);
    const cx = state.pos.fx * canvas.width;
    const cy = state.pos.fy * canvas.height;
    ctx.drawImage(qrCanvas, Math.round(cx - size / 2), Math.round(cy - size / 2), size, size);
  }

  info.className = "msg hint";
  info.textContent = `底图尺寸 ${canvas.width} × ${canvas.height}，可以拖动二维码调整位置。`;
  syncPosInputs();
  setDownloadEnabled(!!state.qr);
}

function applyPadPosition(px, py) {
  if (!state.bgImage || !state.qr) return;
  const canvas = $("collageCanvas");
  const size = parseFloat($("qrRatio").value) * canvas.width;
  const mx = size / 2 / canvas.width + 0.02;
  const my = size / 2 / canvas.height + 0.02;
  const xs = [mx, 0.5, 1 - mx];
  const ys = [my, 0.5, 1 - my];
  state.pos.fx = xs[px];
  state.pos.fy = ys[py];
  clampPos();
  renderCollage();
}

/* ---------- 图片输入（文件 / 拖拽 / 粘贴） ---------- */

function loadImageFile(file, kind) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    toast("只支持图片文件");
    return;
  }
  if (file.size > LOGO_MAX_BYTES) {
    toast("图片过大（> 8MB）");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (kind === "logo") loadLogoFromUrl(reader.result);
    else loadBgFromUrl(reader.result);
  };
  reader.onerror = () => toast("读取图片失败");
  reader.readAsDataURL(file);
}

function loadBgFromUrl(src) {
  const img = new Image();
  img.onload = () => {
    state.bgImage = img;
    renderCollage();
    applyPadPosition(2, 2);
    toast("底图已载入");
  };
  img.onerror = () => toast("底图解析失败");
  img.src = src;
}

function loadLogoFromUrl(src) {
  const img = new Image();
  img.onload = () => {
    state.logo = img;
    render();
    toast("Logo 已载入");
  };
  img.onerror = () => toast("Logo 解析失败");
  img.src = src;
}

async function readClipboardImage() {
  if (!navigator.clipboard || !navigator.clipboard.read) {
    toast("当前浏览器不支持读取剪贴板，请改用 Ctrl/⌘+V");
    return null;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (!type) continue;
      const blob = await item.getType(type);
      return new File([blob], "clipboard.png", { type: type });
    }
    toast("剪贴板里没有图片");
  } catch (err) {
    toast("读取剪贴板被拒绝，请改用 Ctrl/⌘+V 粘贴");
  }
  return null;
}

async function pasteImage(kind) {
  const file = await readClipboardImage();
  if (file) loadImageFile(file, kind);
}

async function pasteQrImage() {
  const file = await readClipboardImage();
  if (file) recognizeQrImage(file);
}

async function copyCanvas(canvas, label) {
  if (!navigator.clipboard || !window.ClipboardItem) {
    toast("当前浏览器不支持复制图片，请自行截图或者保存");
    return;
  }
  try {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("导出失败"))), "image/png");
    });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast(`${label}已复制到剪贴板`);
  } catch (err) {
    toast("复制失败，请使用保存按钮");
  }
}

function saveCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) {
      toast("导出失败");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`已保存 ${filename}`);
  }, "image/png");
}

function fileTag() {
  const uid = $("uid").value.trim().replace(/[^\w-]/g, "");
  return uid ? `-${uid}` : "";
}

const THEMES = {
  classic: { fg1: "#000000", fg2: "#000000", gradient: false, bg: "#ffffff", transparent: false, dot: "square", corner: "square" },
  arknights: { fg1: "#1b1b1b", fg2: "#1b1b1b", gradient: false, bg: "#ffda00", transparent: false, dot: "rounded", corner: "rounded" },
  ocean: { fg1: "#0b4a8f", fg2: "#1e88e5", gradient: true, bg: "#e8f4ff", transparent: false, dot: "liquid", corner: "rounded" },
  sakura: { fg1: "#c026d3", fg2: "#7c3aed", gradient: true, bg: "#fff0f6", transparent: false, dot: "circle", corner: "circle" },
  clear: { fg1: "#111111", fg2: "#2f6fed", gradient: false, bg: "#ffffff", transparent: true, dot: "liquid", corner: "rounded" },
};

function applyTheme(name) {
  const t = THEMES[name];
  if (!t) return;
  $("fg1").value = t.fg1;
  $("fg2").value = t.fg2;
  $("bgColor").value = t.bg;
  $("useGradient").checked = t.gradient;
  $("transparentBg").checked = t.transparent;
  $("dotStyle").value = t.dot;
  $("cornerStyle").value = t.corner;
  render();
}

function setPasteTarget(kind) {
  state.pasteTarget = kind;
  [["logoDrop", "logo"], ["bgDrop", "bg"], ["qrDrop", "qr"]].forEach(([id, k]) => {
    $(id).classList.toggle("active", k === kind);
  });
}

function dropZoneOf(target) {
  const zone = target && target.closest ? target.closest("[data-imgzone]") : null;
  return zone ? zone.dataset.imgzone : "bg";
}

function clearDropZones() {
  ["qrDrop", "logoDrop", "bgDrop"].forEach((id) => $(id).classList.remove("hot"));
}

function highlightDropZone(target) {
  const kind = dropZoneOf(target);
  clearDropZones();
  $({ qr: "qrDrop", logo: "logoDrop", bg: "bgDrop" }[kind]).classList.add("hot");
}

function render() {
  renderQR();
}

/* ---------- 控件辅助：滑块数值气泡 / Logo 底色联动 ---------- */

// 每个滑块的显示格式；未列出时直接显示原始值
const SLIDER_TIP_FORMAT = {
  gradAngle: (v) => `${v}°`,
  quiet: (v) => `${v} 数据点`,
  bgRadius: (v) => `${Math.round(v * 100)}%`,
  logoRatio: (v) => `${Math.round(v * 100)}%`,
  logoPlatePad: (v) => `${Math.round(v * 100)}%`,
  logoPlateRadius: (v) => `${Math.round(v * 100)}%`,
  qrRatio: (v) => `${Math.round(v * 100)}%`,
};
const THUMB_W = 9; // 与 input[type=range] 的滑块宽度保持一致
let sliderTipTimer = 0;

function showSliderTip(el) {
  const tip = $("sliderTip");
  const min = parseFloat(el.min);
  const max = parseFloat(el.max);
  const v = parseFloat(el.value);
  const fmt = SLIDER_TIP_FORMAT[el.id];
  tip.textContent = fmt ? fmt(v) : String(v);
  const rect = el.getBoundingClientRect();
  const ratio = max > min ? (v - min) / (max - min) : 0;
  tip.style.left = `${rect.left + THUMB_W / 2 + ratio * (rect.width - THUMB_W)}px`;
  tip.style.top = `${rect.top - 2}px`;
  tip.classList.add("show");
  clearTimeout(sliderTipTimer);
  sliderTipTimer = setTimeout(hideSliderTip, 1100);
}

function hideSliderTip() {
  clearTimeout(sliderTipTimer);
  $("sliderTip").classList.remove("show");
}

function syncLogoPlate() {
  const on = $("logoPlateOn").checked;
  ["logoPlateColor", "logoPlatePad", "logoPlateRadius"].forEach((id) => {
    $(id).disabled = !on;
  });
}

/* ---------- 事件绑定 ---------- */

function bind() {
  [["logoDrop", "logo"], ["bgDrop", "bg"], ["qrDrop", "qr"]].forEach(([id, kind]) => {
    const el = $(id);
    el.addEventListener("pointerenter", () => setPasteTarget(kind));
    el.addEventListener("focus", () => setPasteTarget(kind));
  });
  setPasteTarget("bg");

  const debounce = (fn, ms) => {
    let t = 0;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };
  const lazyUpdate = debounce(updateUrl, 180);
  $("infoFields").addEventListener("input", lazyUpdate);

  $("infoFields").addEventListener("paste", (e) => {
    const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
    const parsed = parseLink(text);
    if (!parsed) return;
    e.preventDefault();
    const kept = applyParsedLink(parsed);
    toast("已从链接中识别邀请信息");
  });

  $("copyUrl").addEventListener("click", async () => {
    if (!state.url) {
      toast("请先填写完整的信息");
      return;
    }
    try {
      await navigator.clipboard.writeText(state.url);
      toast("链接已复制");
    } catch (err) {
      const out = $("urlOut");
      out.removeAttribute("readonly");
      out.select();
      const ok = document.execCommand("copy");
      out.setAttribute("readonly", "");
      toast(ok ? "链接已复制" : "复制失败，请手动选择复制");
    }
  });

  [
    "ecc", "dotStyle", "cornerStyle", "outSize", "quiet", "gradAngle", "fg1", "fg2", "bgColor",
    "useGradient", "transparentBg", "bgRadius", "logoPlateOn", "logoPlateColor", "logoPlatePad",
    "logoPlateRadius", "logoRatio",
  ].forEach((id) => $(id).addEventListener("input", render));

  $("logoPlateOn").addEventListener("change", syncLogoPlate);
  syncLogoPlate();

  // 操作滑块时用气泡显示当前值
  document.querySelectorAll('input[type="range"]').forEach((el) => {
    el.addEventListener("input", () => showSliderTip(el));
    el.addEventListener("pointerup", hideSliderTip);
    el.addEventListener("pointercancel", hideSliderTip);
    el.addEventListener("blur", hideSliderTip);
  });

  document.querySelectorAll("[data-theme]").forEach((btn) => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.theme));
  });

  $("qrDrop").addEventListener("click", () => {
    setPasteTarget("qr");
    $("qrFile").click();
  });
  $("qrFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // 允许连续选择同一个文件
    recognizeQrImage(file);
  });
  $("qrPaste").addEventListener("click", () => pasteQrImage());

  $("logoDrop").addEventListener("click", () => {
    setPasteTarget("logo");
    $("logoFile").click();
  });
  $("logoFile").addEventListener("change", (e) => loadImageFile(e.target.files[0], "logo"));
  $("logoPaste").addEventListener("click", () => pasteImage("logo"));
  $("logoClear").addEventListener("click", () => {
    state.logo = null;
    $("logoFile").value = "";
    render();
    toast("已移除 Logo");
  });

  $("bgDrop").addEventListener("click", () => {
    setPasteTarget("bg");
    $("bgFile").click();
  });
  $("bgFile").addEventListener("change", (e) => loadImageFile(e.target.files[0], "bg"));
  $("bgPaste").addEventListener("click", () => pasteImage("bg"));
  $("bgClear").addEventListener("click", () => {
    state.bgImage = null;
    $("bgFile").value = "";
    renderCollage();
    toast("已清除底图");
  });
  ["dragenter", "dragover"].forEach((type) => {
    document.addEventListener(type, (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
      e.preventDefault();
      highlightDropZone(e.target);
    });
  });
  document.addEventListener("dragleave", (e) => {
    if (e.relatedTarget) return;
    clearDropZones();
  });
  document.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    const zone = dropZoneOf(e.target);
    clearDropZones();
    if (!files || !files.length) return;
    e.preventDefault();
    if (zone === "qr") recognizeQrImage(files[0]);
    else loadImageFile(files[0], zone === "logo" ? "logo" : "bg");
  });

  document.addEventListener("paste", (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const item of items) {
      if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
      e.preventDefault();
      const file = item.getAsFile();
      const kind = state.pasteTarget === "qr" ? "qr" : state.pasteTarget === "logo" ? "logo" : "bg";
      if (kind === "qr") {
        recognizeQrImage(file);
      } else {
        loadImageFile(file, kind);
        toast(kind === "logo" ? "已从剪贴板获取到中心 Logo" : "已从剪贴板获取到底图");
      }
      return;
    }
  });

  $("saveQr").addEventListener("click", () => saveCanvas($("qrPreview"), `arknights-friend-qr${fileTag()}.png`));
  $("copyQr").addEventListener("click", () => copyCanvas($("qrPreview"), "二维码"));
  $("saveCollage").addEventListener("click", () => saveCanvas($("collageCanvas"), `arknights-friend-card${fileTag()}.png`));
  $("copyCollage").addEventListener("click", () => copyCanvas($("collageCanvas"), "拼贴图"));

  $("posGrid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pos]");
    if (!btn) return;
    const [px, py] = btn.dataset.pos.split(",").map(Number);
    applyPadPosition(px, py);
    // 让方向键微调可以接着用
    if (state.bgImage) $("collageCanvas").focus({ preventScroll: true });
  });

  ["qrRatio", "snapOn"].forEach((id) => {
    $(id).addEventListener("input", () => {
      clampPos();
      renderCollage();
    });
  });

  // 位置输入框：数值直接写回 state.pos
  [
    { id: "posX", key: "fx", dim: "width" },
    { id: "posY", key: "fy", dim: "height" },
  ].forEach(({ id, key, dim }) => {
    $(id).addEventListener("input", () => {
      const canvas = $("collageCanvas");
      if (!state.bgImage || !state.qr || !canvas[dim]) return;
      const v = parseFloat($(id).value);
      if (!Number.isFinite(v)) return;
      state.pos[key] = v / canvas[dim];
      clampPos();
      renderCollage();
    });
  });

  const canvas = $("collageCanvas");
  let dragging = false;
  const moveTo = (e) => {
    const rect = canvas.getBoundingClientRect();
    let fx = (e.clientX - rect.left) / rect.width;
    let fy = (e.clientY - rect.top) / rect.height;
    if ($("snapOn").checked) {
      const size = parseFloat($("qrRatio").value) * canvas.width;
      const mx = size / 2 / canvas.width + 0.02;
      const my = size / 2 / canvas.height + 0.02;
      const snap = (v, m) => {
        for (const target of [m, 0.5, 1 - m]) if (Math.abs(v - target) < 0.025) return target;
        return v;
      };
      fx = snap(fx, mx);
      fy = snap(fy, my);
    }
    state.pos.fx = fx;
    state.pos.fy = fy;
    clampPos();
    renderCollage();
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!state.bgImage) return;
    dragging = true;
    canvas.classList.add("dragging");
    canvas.setPointerCapture(e.pointerId);
    moveTo(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (dragging) moveTo(e);
  });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove("dragging");
    if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  // 画布内方向键微调：1 像素，Shift 十像素
  canvas.addEventListener("keydown", (e) => {
    if (!state.bgImage || !state.qr) return;
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    state.pos.fx += dx / canvas.width;
    state.pos.fy += dy / canvas.height;
    clampPos();
    renderCollage();
  });
}

/* ---------- 4. 配色模式（自动 / 浅色 / 深色） ---------- */

const THEME_KEY = "ak-theme";
const lightQuery = window.matchMedia("(prefers-color-scheme: light)");

function readThemeMode() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "auto";
  } catch {
    return "auto";
  }
}

function applyThemeMode(mode) {
  const dark = mode === "auto" ? !lightQuery.matches : mode === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.mode === mode));
  });
}

function bindThemeMode() {
  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      try {
        localStorage.setItem(THEME_KEY, mode);
      } catch {
        /* 隐私模式下无法持久化，仅本次生效 */
      }
      applyThemeMode(mode);
    });
  });
  // 系统配色变化时，「自动」模式跟着走
  lightQuery.addEventListener("change", () => {
    if (readThemeMode() === "auto") applyThemeMode("auto");
  });
  applyThemeMode(readThemeMode());
}

bind();
bindThemeMode();
updateUrl();
