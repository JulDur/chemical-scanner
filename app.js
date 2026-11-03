import Tesseract from "./ocr/tesseract.esm.min.js";

const APP_VERSION = "2.2";
const STORAGE_KEY = "chem-v22";
const LEGACY_STORAGE_KEYS = ["chem-v21"];
const MAX_OCR_SIDE = 1800;
const JPEG_QUALITY = 0.84;
const OCR_PASSES = [
  { key: "colorSparse", label: "color / sparse text", image: "colorBlob", psm: "11" },
  { key: "graySparse", label: "grayscale / sparse text", image: "grayBlob", psm: "11" },
  { key: "thresholdBlock", label: "threshold / text block", image: "thresholdBlob", psm: "6" },
  { key: "sharpSparse", label: "sharpened / sparse text", image: "sharpBlob", psm: "11" }
];

const EMPTY = () => ({
  name: "",
  cas: "",
  article: "",
  lot: "",
  manufacturer: "",
  amount: "",
  raw: "",
  ocrLines: [],
  photos: []
});

let items = [];
let form = EMPTY();
let pickerField = "";
let ocrWorker = null;
let workerPromise = null;
let containerOpen = false;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function casValid(cas) {
  const m = String(cas || "").trim().match(/^(\d{2,7})-(\d{2})-(\d)$/);
  if (!m) return false;
  const digits = (m[1] + m[2]).split("").map(Number).reverse();
  return digits.reduce((sum, digit, index) => sum + digit * (index + 1), 0) % 10 === Number(m[3]);
}

function correctCASOCR(value) {
  return String(value || "")
    .replace(/[OoQ]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/[–—−]/g, "-");
}

function reconstructCAS(value) {
  const digits = correctCASOCR(value).replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 10) return "";
  const first = digits.slice(0, -3);
  const candidate = `${first}-${digits.slice(-3, -1)}-${digits.slice(-1)}`;
  return first.length >= 2 && first.length <= 7 && casValid(candidate) ? candidate : "";
}

function hasCASAnchor(line) {
  return /\bC\s*[A4]\s*[S5]\b\s*(?:[- ]?\s*(?:No\.?|Number))?/i.test(String(line || ""));
}

function afterCAS(line) {
  return String(line || "").match(/\bC\s*[A4]\s*[S5]\b\s*(?:[- ]?\s*(?:No\.?|Number))?\s*[:#.]?\s*(.*)$/i)?.[1]?.trim() || "";
}

function casCandidatesFromText(text) {
  const raw = String(text || "");
  const candidates = [];
  const add = value => {
    const candidate = reconstructCAS(value);
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };

  for (const line of raw.split(/\r?\n/)) {
    if (hasCASAnchor(line)) {
      add(afterCAS(line));
      const compact = correctCASOCR(afterCAS(line));
      const direct = compact.match(/\d{2,7}\s*-\s*\d{2}\s*-\s*\d/);
      if (direct) add(direct[0]);
    }

    const corrected = correctCASOCR(line);
    for (const match of corrected.matchAll(/(?:^|\D)(\d{2,7}\s*[- ]\s*\d{2}\s*[- ]\s*\d)(?=\D|$)/g)) add(match[1]);
  }

  return candidates;
}

function extractCAS(line) {
  return casCandidatesFromText(line)[0] || "";
}

function cleanName(line) {
  return String(line || "")
    .replace(/^[^A-Za-zÀ-ÿ]+/, "")
    .replace(/[\s|_=~]+$/g, "")
    .replace(/\s*-\s*$/, "")
    .replace(/\s+[iIlIeEA]$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAmount(line) {
  const m = String(line || "").match(/\b(\d+(?:[.,]\d+)?)\s*(mg|kg|g|mL|ml|L|l)\b/);
  if (!m) return "";
  const map = { ml: "mL", l: "L", g: "g", kg: "kg", mg: "mg" };
  return `${m[1]} ${map[m[2].toLowerCase()]}`;
}

function extractLot(line) {
  return String(line || "").match(/\b(?:lot|batch)(?:\s*(?:no\.?|number))?\s*[:#.-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i)?.[1]?.trim() || "";
}

function extractArticle(line, maker = "") {
  const text = String(line || "");
  const m = text.match(/(?:article|article\s*no\.?|art\.?\s*no\.?|catalog(?:ue)?\s*(?:no\.?|number)?|cat\.?\s*no\.?|product\s*(?:no\.?|number))\s*[:#.-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i);
  if (m) return m[1];
  if (maker === "Merck") return text.match(/\b\d\.\d{5}\.\d{4}\b/)?.[0] || "";
  if (/Fisher/.test(maker)) return text.match(/\b([A-Z]{1,4}\d{3,8}-\d{1,4})\b/)?.[1] || "";
  return "";
}

function normalizeForField(line, field) {
  if (field === "name") return cleanName(line);
  if (field === "cas") return extractCAS(line) || reconstructCAS(line);
  if (field === "article") return extractArticle(line, form.manufacturer) || String(line).trim();
  if (field === "lot") return extractLot(line) || String(line).trim();
  if (field === "amount") return extractAmount(line) || String(line).trim();
  if (field === "manufacturer") return String(line).replace(/^[^A-Za-z]+/, "").trim();
  return String(line).trim();
}

const MAKERS = [
  [/sigma[- ]?aldrich/i, "Sigma-Aldrich"],
  [/fisher\s*chemical/i, "Fisher Chemical"],
  [/thermo\s*fisher/i, "Thermo Fisher"],
  [/thermo\s*scientific/i, "Thermo Scientific"],
  [/fisher\s*scientific/i, "Fisher Scientific"],
  [/carl\s*roth/i, "Carl Roth"],
  [/supelco/i, "Supelco"],
  [/\bavantor\b/i, "Avantor"],
  [/\bvwr\b/i, "VWR"],
  [/\bmerck\b/i, "Merck"]
];

function nameScore(line, index, casIndex) {
  const x = cleanName(line);
  const letters = (x.match(/[A-Za-zÀ-ÿ]/g) || []).length;
  const words = x.split(/\s+/).filter(Boolean);
  if (x.length < 3 || x.length > 80 || letters < 3) return -1e4;
  if (x.length <= 5 && words.length <= 2) return -500;
  if (/\b(?:CAS|CASNo|EC|ECNo|Index|REACH|lot|batch|article|catalog|product|danger|warning|hazard|causes|avoid|precaution|eyes?|Germany|USA|GmbH|KGaA)\b/i.test(x)) return -1e4;
  if (/www\.|\.com\b|^[HP]\s*\d{3}\b|for analysis|laboratory|use only|ACS|ISO|Reag|Ph Eur/i.test(x)) return -1e4;
  if (MAKERS.some(([regex]) => regex.test(x))) return -1e4;

  let score = 0;
  if (words.length >= 2 && words.length <= 5) score += 15;
  if (words.length === 1 && x.length >= 6) score += 8;
  if (x.length >= 6 && x.length <= 40) score += 8;
  if (letters / x.length > 0.7) score += 8;
  if (/\b(?:acid|hydroxide|chloride|bromide|iodide|nitrate|sulfate|carbonate|phosphate|acetate|oxide|acetone|ethanol|methanol|propanol|butanol)\b/i.test(x)) score += 15;
  if (casIndex >= 0) {
    const distance = casIndex - index;
    if (distance > 0 && distance <= 14) score += Math.max(0, 18 - distance);
  }
  return score;
}

function parse(text) {
  const raw = String(text || "").replace(/\r/g, "");
  const lines = raw.split("\n").map(x => x.trim()).filter(Boolean);
  const manufacturer = MAKERS.find(([regex]) => regex.test(raw))?.[1] || "";
  const cas = casCandidatesFromText(raw)[0] || "";
  const casIndex = lines.findIndex(line => hasCASAnchor(line) || casCandidatesFromText(line).length);

  let lot = "";
  let article = "";
  let amount = "";
  for (const line of lines) {
    lot ||= extractLot(line);
    article ||= extractArticle(line, manufacturer);
    amount ||= extractAmount(line);
  }

  const ranked = lines
    .map((line, index) => ({ value: cleanName(line), score: nameScore(line, index, casIndex) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];

  return {
    name: best && best.score >= 12 ? best.value : "",
    cas,
    article,
    lot,
    manufacturer,
    amount,
    raw,
    ocrLines: lines
  };
}

function normalizeVote(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function chooseConsensus(values, normalizer = normalizeVote) {
  const map = new Map();
  for (const entry of values) {
    const value = String(entry?.value || "").trim();
    if (!value) continue;
    const key = normalizer(value);
    if (!key) continue;
    const weight = Math.max(0.25, Number(entry?.weight || 1));
    const current = map.get(key) || { value, score: 0, bestWeight: 0 };
    current.score += weight;
    if (weight > current.bestWeight) {
      current.value = value;
      current.bestWeight = weight;
    }
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.score - a.score || b.bestWeight - a.bestWeight)[0]?.value || "";
}

function buildConsensus(photos) {
  const passResults = photos.flatMap(photo => photo.results || []);
  const parsedPasses = passResults.map(result => ({
    parsed: parse(result.text),
    weight: 0.5 + Math.max(0, Math.min(100, Number(result.confidence || 0))) / 100
  }));

  const allText = mergeText(...passResults.map(result => result.text));
  const combined = parse(allText);

  const casVotes = [];
  for (const result of passResults) {
    const weight = 1 + Math.max(0, Math.min(100, Number(result.confidence || 0))) / 100;
    for (const candidate of casCandidatesFromText(result.text)) casVotes.push({ value: candidate, weight });
  }

  const consensus = {
    ...combined,
    cas: chooseConsensus(casVotes, value => value),
    name: chooseConsensus(parsedPasses.map(x => ({ value: x.parsed.name, weight: x.weight }))) || combined.name,
    article: chooseConsensus(parsedPasses.map(x => ({ value: x.parsed.article, weight: x.weight }))) || combined.article,
    lot: chooseConsensus(parsedPasses.map(x => ({ value: x.parsed.lot, weight: x.weight }))) || combined.lot,
    manufacturer: chooseConsensus(parsedPasses.map(x => ({ value: x.parsed.manufacturer, weight: x.weight }))) || combined.manufacturer,
    amount: chooseConsensus(parsedPasses.map(x => ({ value: x.parsed.amount, weight: x.weight }))) || combined.amount,
    raw: allText,
    ocrLines: allText.split(/\r?\n/).map(x => x.trim()).filter(Boolean)
  };

  return consensus;
}

function mergeText(...texts) {
  return [...new Set(texts.flatMap(text => String(text || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean)))].join("\n");
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, type = "image/jpeg", quality = JPEG_QUALITY) {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error("Image conversion failed")),
    type,
    quality
  ));
}

function clampByte(value) {
  return Math.max(0, Math.min(255, value));
}

async function prepareImages(file) {
  const started = performance.now();
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const ow = bitmap.width;
  const oh = bitmap.height;
  const scale = Math.min(1, MAX_OCR_SIDE / Math.max(ow, oh));
  const width = Math.round(ow * scale);
  const height = Math.round(oh * scale);

  const color = makeCanvas(width, height);
  const colorContext = color.getContext("2d", { alpha: false });
  colorContext.fillStyle = "#fff";
  colorContext.fillRect(0, 0, width, height);
  colorContext.imageSmoothingEnabled = true;
  colorContext.imageSmoothingQuality = "high";
  colorContext.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const colorBlob = await canvasToBlob(color);
  const source = colorContext.getImageData(0, 0, width, height);

  const gray = makeCanvas(width, height);
  const grayContext = gray.getContext("2d", { alpha: false, willReadFrequently: true });
  const grayImage = grayContext.createImageData(width, height);
  for (let i = 0; i < source.data.length; i += 4) {
    const lum = 0.2126 * source.data[i] + 0.7152 * source.data[i + 1] + 0.0722 * source.data[i + 2];
    const value = clampByte((lum - 128) * 1.35 + 128);
    grayImage.data[i] = grayImage.data[i + 1] = grayImage.data[i + 2] = value;
    grayImage.data[i + 3] = 255;
  }
  grayContext.putImageData(grayImage, 0, 0);

  const threshold = makeCanvas(width, height);
  const thresholdContext = threshold.getContext("2d", { alpha: false });
  const thresholdImage = thresholdContext.createImageData(width, height);
  const luminance = new Uint8ClampedArray(width * height);
  let total = 0;
  for (let p = 0, i = 0; i < grayImage.data.length; i += 4, p++) {
    luminance[p] = grayImage.data[i];
    total += luminance[p];
  }
  const mean = total / luminance.length;
  const thresholdValue = clampByte(mean - 12);
  for (let p = 0, i = 0; p < luminance.length; p++, i += 4) {
    const value = luminance[p] > thresholdValue ? 255 : 0;
    thresholdImage.data[i] = thresholdImage.data[i + 1] = thresholdImage.data[i + 2] = value;
    thresholdImage.data[i + 3] = 255;
  }
  thresholdContext.putImageData(thresholdImage, 0, 0);

  const sharp = makeCanvas(width, height);
  const sharpContext = sharp.getContext("2d", { alpha: false });
  const sharpImage = sharpContext.createImageData(width, height);
  const data = grayImage.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      let value = data[index];
      if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
        value = 5 * data[index]
          - data[index - 4]
          - data[index + 4]
          - data[index - width * 4]
          - data[index + width * 4];
      }
      value = clampByte(value);
      sharpImage.data[index] = sharpImage.data[index + 1] = sharpImage.data[index + 2] = value;
      sharpImage.data[index + 3] = 255;
    }
  }
  sharpContext.putImageData(sharpImage, 0, 0);

  const [grayBlob, thresholdBlob, sharpBlob] = await Promise.all([
    canvasToBlob(gray, "image/jpeg", 0.88),
    canvasToBlob(threshold, "image/png"),
    canvasToBlob(sharp, "image/jpeg", 0.9)
  ]);

  return {
    colorBlob,
    grayBlob,
    thresholdBlob,
    sharpBlob,
    thumbURL: URL.createObjectURL(grayBlob),
    ow,
    oh,
    width,
    height,
    prep: (performance.now() - started) / 1000
  };
}

async function getWorker(status, progress) {
  if (ocrWorker) return ocrWorker;
  if (workerPromise) return workerPromise;

  workerPromise = Tesseract.createWorker("eng", 1, {
    workerPath: "./ocr/worker.min.js",
    langPath: "./ocr/lang",
    corePath: "./ocr/core",
    logger: message => {
      status.textContent = message.status || "Preparing OCR";
      if (typeof message.progress === "number") progress.value = Math.round(message.progress * 100);
    }
  }).then(async worker => {
    await worker.setParameters({ preserve_interword_spaces: "1" });
    ocrWorker = worker;
    return worker;
  }).finally(() => {
    workerPromise = null;
  });

  return workerPromise;
}

async function recognizePass(worker, blob, pass, photoNumber, passNumber, status, progress) {
  status.textContent = `Photo ${photoNumber}: ${pass.label} (${passNumber}/${OCR_PASSES.length})...`;
  progress.value = Math.round(((passNumber - 1) / OCR_PASSES.length) * 100);
  await worker.setParameters({
    tessedit_pageseg_mode: pass.psm,
    preserve_interword_spaces: "1"
  });
  const started = performance.now();
  const result = await worker.recognize(blob);
  return {
    key: pass.key,
    label: pass.label,
    psm: pass.psm,
    text: String(result.data.text || "").trim(),
    confidence: Number(result.data.confidence || 0),
    seconds: (performance.now() - started) / 1000
  };
}

function startContainer() {
  form = EMPTY();
  containerOpen = true;
  editor();
  renderPhotoStrip();
  fill();
  $("#status").classList.add("hidden");
  $("#progress").classList.add("hidden");
}

async function processPhoto(file) {
  if (!containerOpen) startContainer();
  const status = $("#status");
  const progress = $("#progress");
  status.classList.remove("hidden");
  progress.classList.remove("hidden");
  const photoNumber = form.photos.length + 1;
  status.textContent = `Preparing photo ${photoNumber}...`;
  progress.value = 0;

  try {
    const prepared = await prepareImages(file);
    const worker = await getWorker(status, progress);
    const results = [];

    for (let i = 0; i < OCR_PASSES.length; i++) {
      const pass = OCR_PASSES[i];
      results.push(await recognizePass(
        worker,
        prepared[pass.image],
        pass,
        photoNumber,
        i + 1,
        status,
        progress
      ));
    }

    const usefulResults = results.filter(result => result.text);
    const photoText = mergeText(...usefulResults.map(result => result.text));
    const confidence = usefulResults.length
      ? usefulResults.reduce((sum, result) => sum + result.confidence, 0) / usefulResults.length
      : 0;

    form.photos.push({
      id: crypto.randomUUID(),
      thumbURL: prepared.thumbURL,
      text: photoText,
      confidence,
      results,
      prepSec: prepared.prep
    });

    const parsed = buildConsensus(form.photos);
    form = { ...form, ...parsed, photos: form.photos };
    fill();
    renderPhotoStrip();
    status.textContent = `Photo ${form.photos.length} analyzed with ${OCR_PASSES.length} OCR passes (${confidence.toFixed(0)}% average). Verify the suggested fields. App v${APP_VERSION}`;
    progress.value = 100;
  } catch (error) {
    console.error(error);
    status.textContent = `OCR failed: ${error?.message || String(error)}`;
  }
}

function renderPhotoStrip() {
  const box = $("#containerPhotos");
  if (!box) return;
  box.innerHTML = "";
  form.photos.forEach((photo, index) => {
    const card = document.createElement("div");
    card.className = "photo-card";
    card.innerHTML = `<img src="${photo.thumbURL}" alt="Bottle photo ${index + 1}"><span>Photo ${index + 1}<br>${photo.confidence.toFixed(0)}%</span><button type="button" aria-label="Remove photo">×</button>`;
    card.querySelector("button").onclick = () => removePhoto(photo.id);
    box.append(card);
  });
  $("#photoCount").textContent = `${form.photos.length} photo${form.photos.length === 1 ? "" : "s"}`;
}

function removePhoto(id) {
  const photo = form.photos.find(item => item.id === id);
  if (photo?.thumbURL) URL.revokeObjectURL(photo.thumbURL);
  form.photos = form.photos.filter(item => item.id !== id);
  const parsed = form.photos.length ? buildConsensus(form.photos) : parse("");
  form = { ...form, ...parsed, photos: form.photos };
  fill();
  renderPhotoStrip();
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ session: $("#session").value, items }));
}

function safe(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function render() {
  $("#list").innerHTML = "";
  items.forEach(item => {
    const article = document.createElement("article");
    article.innerHTML = `<b>${safe(item.name || "Unnamed chemical")}</b><small>${safe(item.cas || "No CAS")}${item.article ? ` • ${safe(item.article)}` : ""} • ${item.photoCount || 1} photo(s)</small><button class="delete">×</button>`;
    article.querySelector("button").onclick = () => {
      items = items.filter(existing => existing.id !== item.id);
      save();
      render();
    };
    $("#list").append(article);
  });
  $("#count").textContent = `${items.length} containers`;
  $("#exports").classList.toggle("hidden", !items.length);
}

function editor(show = true) {
  $("#home").classList.toggle("hidden", show);
  $("#editor").classList.toggle("hidden", !show);
}

function updateCASState() {
  const value = $('[data-field="cas"]').value;
  const state = $("#casState");
  state.textContent = !value ? "" : casValid(value) ? "✓ Valid CAS checksum" : "⚠ Invalid CAS format/checksum";
  state.className = !value ? "" : casValid(value) ? "ok" : "warn";
}

function fill() {
  $$('[data-field]').forEach(input => input.value = form[input.dataset.field] || "");
  $("#raw").textContent = form.raw || "";
  $("#rawBox").classList.toggle("hidden", !form.raw);
  updateCASState();
  buildOCRButtons();
}

function ensurePicker() {
  if ($("#ocrPicker")) return;
  const picker = document.createElement("div");
  picker.id = "ocrPicker";
  picker.className = "ocr-picker hidden";
  picker.innerHTML = `<div class="ocr-picker-card"><div class="ocr-picker-head"><b>Select OCR text</b><button id="closeOCRPicker" type="button">×</button></div><button class="ocr-choice clear-choice" data-clear="1">Leave blank</button><div id="ocrChoices"></div></div>`;
  document.body.append(picker);
  $("#closeOCRPicker").onclick = () => picker.classList.add("hidden");
  picker.querySelector('[data-clear="1"]').onclick = () => applyPickerValue("");
}

function applyPickerValue(value) {
  const input = $(`[data-field="${pickerField}"]`);
  if (input) {
    input.value = value;
    if (pickerField === "cas") updateCASState();
  }
  $("#ocrPicker").classList.add("hidden");
}

function openPicker(field) {
  pickerField = field;
  const box = $("#ocrChoices");
  box.innerHTML = "";
  [...new Set(form.ocrLines || [])].forEach(line => {
    const normalized = normalizeForField(line, field);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ocr-choice";
    button.innerHTML = `<span>${safe(line)}</span>${normalized !== line ? `<small>Use: ${safe(normalized || "blank")}</small>` : ""}`;
    button.onclick = () => applyPickerValue(normalized);
    box.append(button);
  });
  $("#ocrPicker").classList.remove("hidden");
}

function buildOCRButtons() {
  ensurePicker();
  $$('[data-field]').forEach(input => {
    const label = input.closest("label");
    if (!label || label.querySelector(".ocr-open")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ocr-open";
    button.textContent = "▼ OCR";
    button.onclick = event => {
      event.preventDefault();
      openPicker(input.dataset.field);
    };
    label.append(button);
  });
}

function handleFile(event) {
  const file = event.target.files?.[0];
  if (file) processPhoto(file);
  event.target.value = "";
}

function esc(value = "") {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv() {
  const headers = ["Timestamp", "Session", "Name", "CAS", "ArticleNumber", "Lot", "Manufacturer", "Amount"];
  const session = $("#session").value;
  const rows = items.map(item => [item.timestamp, session, item.name, item.cas, item.article, item.lot, item.manufacturer, item.amount]);
  return "\uFEFF" + [headers, ...rows].map(row => row.map(esc).join(",")).join("\r\n");
}

function createCSVFile() {
  return new File([csv()], `chemical_inventory_${new Date().toISOString().slice(0, 10)}.csv`, { type: "text/csv" });
}

function downloadCSV() {
  const file = createCSVFile();
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("#camera").onclick = () => {
  startContainer();
  $("#photo").click();
};
$("#chooseImage").onclick = () => {
  startContainer();
  $("#gallery").click();
};
$("#addPhotoCamera").onclick = () => $("#photo").click();
$("#addPhotoGallery").onclick = () => $("#gallery").click();
$("#photo").onchange = handleFile;
$("#gallery").onchange = handleFile;
$("#manual").onclick = () => startContainer();
$("#cancel").onclick = () => {
  form.photos.forEach(photo => URL.revokeObjectURL(photo.thumbURL));
  form = EMPTY();
  containerOpen = false;
  editor(false);
};
$("#add").onclick = () => {
  form = { ...form };
  $$('[data-field]').forEach(input => form[input.dataset.field] = input.value.trim());
  if (!form.name && !form.cas) return;
  items.push({
    ...form,
    photoCount: form.photos.length,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    photos: undefined,
    ocrLines: undefined,
    raw: undefined
  });
  form.photos.forEach(photo => URL.revokeObjectURL(photo.thumbURL));
  form = EMPTY();
  containerOpen = false;
  save();
  render();
  editor(false);
};
$('[data-field="cas"]').oninput = updateCASState;
$("#session").onchange = save;
$("#download").onclick = downloadCSV;
$("#share").onclick = async () => {
  const file = createCSVFile();
  try {
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: $("#session").value, files: [file] });
    } else {
      downloadCSV();
    }
  } catch (error) {
    if (error.name !== "AbortError") downloadCSV();
  }
};

try {
  let saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  if (!saved) {
    for (const key of LEGACY_STORAGE_KEYS) {
      saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved) break;
    }
  }
  if (saved) {
    items = saved.items || [];
    $("#session").value = saved.session || "Lab inventory";
    save();
  }
} catch (error) {
  console.warn("Could not restore saved inventory", error);
}

render();
ensurePicker();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
window.addEventListener("pagehide", () => {
  if (ocrWorker) ocrWorker.terminate().catch(() => {});
});
console.log(`Chemical Scanner v${APP_VERSION}`);
