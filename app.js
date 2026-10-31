import Tesseract from "./ocr/tesseract.esm.min.js";

const APP_VERSION = "1.7";
const K = "chem-v7";

const E = () => ({
  name: "",
  cas: "",
  article: "",
  lot: "",
  manufacturer: "",
  amount: "",
  raw: ""
});

let items = [];
let form = E();

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];


// ============================================================
// CAS CHECKSUM VALIDATION
// ============================================================

function cv(cas) {
  const m = String(cas || "")
    .trim()
    .match(/^(\d{2,7})-(\d{2})-(\d)$/);

  if (!m) return false;

  const digits = (m[1] + m[2])
    .split("")
    .map(Number)
    .reverse();

  const sum = digits.reduce(
    (total, digit, index) =>
      total + digit * (index + 1),
    0
  );

  return sum % 10 === Number(m[3]);
}


// ============================================================
// CONTROLLED OCR CORRECTION FOR CAS
//
// IMPORTANT:
// These substitutions are ONLY applied to text associated
// with an explicit CAS label.
// ============================================================

function correctCASOCR(value) {
  return String(value || "")
    .replace(/[Oo]/g, "0")
    .replace(/[Il]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/B/g, "8");
}


// ============================================================
// CAS RECONSTRUCTION
//
// CAS structure:
// [2-7 digits]-[2 digits]-[1 check digit]
//
// Examples:
//
// 67641     -> 67-64-1
// 1310732   -> 1310-73-2
// 7732185   -> 7732-18-5
// 10043353  -> 10043-35-3
// ============================================================

function reconstructCAS(value) {
  if (!value) return "";

  const corrected =
    correctCASOCR(value);

  const digits =
    corrected.replace(/\D/g, "");

  if (
    digits.length < 5 ||
    digits.length > 10
  ) {
    return "";
  }

  const checkDigit =
    digits.slice(-1);

  const middle =
    digits.slice(-3, -1);

  const first =
    digits.slice(0, -3);

  if (
    first.length < 2 ||
    first.length > 7
  ) {
    return "";
  }

  const candidate =
    `${first}-${middle}-${checkDigit}`;

  // Mandatory checksum verification.
  return cv(candidate)
    ? candidate
    : "";
}


// ============================================================
// CAS ANCHOR DETECTION
//
// Recognizes:
//
// CAS
// CAS:
// CAS No.
// CAS-No.
// CASNo.
// CASNumber
// CAS Number
// ============================================================

function hasCASAnchor(line) {
  return /CAS\s*(?:[- ]?\s*(?:No\.?|Number))?/i
    .test(line);
}


// ============================================================
// EXTRACT VALUE AFTER CAS ANCHOR
// ============================================================

function textAfterCASAnchor(line) {
  const text =
    String(line || "");

  const match =
    text.match(
      /CAS\s*(?:[- ]?\s*(?:No\.?|Number))?\s*[:#.]?\s*(.*)$/i
    );

  return match?.[1]?.trim() || "";
}


// ============================================================
// EXTRACT CAS FROM CAS-ANCHORED LINE
// ============================================================

function extractCASFromAnchor(line) {
  const after =
    textAfterCASAnchor(line);

  if (!after)
    return "";

  const corrected =
    correctCASOCR(after);


  // ----------------------------------------------------------
  // First attempt:
  // Properly formatted CAS
  // ----------------------------------------------------------

  const normal =
    corrected.match(
      /\d{2,7}\s*-\s*\d{2}\s*-\s*\d/
    );

  if (normal) {
    const candidate =
      normal[0]
        .replace(/\s+/g, "");

    if (cv(candidate))
      return candidate;
  }


  // ----------------------------------------------------------
  // Second attempt:
  // Reconstruct damaged separators.
  //
  // Examples:
  //
  // CAS-No. 1310-732
  // CASNo. 67-561
  // CAS 67 S6 I
  // ----------------------------------------------------------

  const candidateArea =
    corrected.match(
      /[0-9][0-9\s.\-]{3,18}[0-9]/
    )?.[0] || corrected;

  return reconstructCAS(
    candidateArea
  );
}


// ============================================================
// MAIN OCR PARSER
// ============================================================

function parse(text) {
  const raw =
    String(text || "")
      .replace(/\r/g, "");

  const lines =
    raw
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);


  // ==========================================================
  // MANUFACTURER
  // ==========================================================

  const makerRules = [
    {
      regex: /sigma[- ]?aldrich/i,
      name: "Sigma-Aldrich"
    },
    {
      regex: /fisher\s*chemical/i,
      name: "Fisher Chemical"
    },
    {
      regex: /thermo\s*fisher/i,
      name: "Thermo Fisher"
    },
    {
      regex: /thermo\s*scientific/i,
      name: "Thermo Scientific"
    },
    {
      regex: /fisher\s*scientific/i,
      name: "Fisher Scientific"
    },
    {
      regex: /carl\s*roth/i,
      name: "Carl Roth"
    },
    {
      regex: /supelco/i,
      name: "Supelco"
    },
    {
      regex: /\bavantor\b/i,
      name: "Avantor"
    },
    {
      regex: /\bvwr\b/i,
      name: "VWR"
    },
    {
      regex: /\bmerck\b/i,
      name: "Merck"
    }
  ];

  let manufacturer = "";

  for (const maker of makerRules) {
    if (maker.regex.test(raw)) {
      manufacturer =
        maker.name;

      break;
    }
  }


  // ==========================================================
  // CAS
  // ==========================================================

  let cas = "";
  let casAnchorIndex = -1;

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    const line =
      lines[i];

    if (!hasCASAnchor(line))
      continue;

    casAnchorIndex = i;


    // --------------------------------------------------------
    // Try same line
    // --------------------------------------------------------

    cas =
      extractCASFromAnchor(
        line
      );

    if (cas)
      break;


    // --------------------------------------------------------
    // OCR may split label/value:
    //
    // CAS-No.
    // 67-56-1
    //
    // Only inspect the immediately following line.
    // --------------------------------------------------------

    if (
      i + 1 <
      lines.length
    ) {
      const next =
        lines[i + 1];

      // Explicit protection against other identifiers.
      if (
        !/^\s*(?:EC|Index|REACH)/i
          .test(next)
      ) {
        cas =
          reconstructCAS(
            next
          );

        if (cas)
          break;
      }
    }
  }


  // ==========================================================
  // LOT / BATCH
  // ==========================================================

  let lot = "";

  for (const line of lines) {
    const match =
      line.match(
        /\b(?:lot|batch)(?:\s*(?:no\.?|number))?\s*[:#.-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i
      );

    if (match) {
      lot =
        match[1].trim();

      break;
    }
  }


  // ==========================================================
  // ARTICLE NUMBER
  // ==========================================================

  let article = "";


  // ----------------------------------------------------------
  // Generic labelled article/product/catalogue number
  // ----------------------------------------------------------

  for (const line of lines) {
    const match =
      line.match(
        /(?:article|article\s*no\.?|art\.?\s*no\.?|catalog(?:ue)?\s*(?:no\.?|number)?|cat\.?\s*no\.?|product\s*(?:no\.?|number))\s*[:#.-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i
      );

    if (match) {
      article =
        match[1].trim();

      break;
    }
  }


  // ----------------------------------------------------------
  // Merck
  //
  // Example:
  // 1.06498.1000
  // ----------------------------------------------------------

  if (
    !article &&
    manufacturer === "Merck"
  ) {
    const match =
      raw.match(
        /\b\d\.\d{5}\.\d{4}\b/
      );

    if (match)
      article = match[0];
  }


  // ----------------------------------------------------------
  // Fisher Chemical
  //
  // Example OCR:
  //
  // Fisher BP2818-1
  // ----------------------------------------------------------

  if (
    !article &&
    (
      manufacturer === "Fisher Chemical" ||
      manufacturer === "Fisher Scientific" ||
      manufacturer === "Thermo Fisher"
    )
  ) {
    const fisherPatterns = [
      /\bFisher\s+([A-Z]{1,4}\d{3,8}-\d{1,4})\b/i,
      /\b([A-Z]{1,4}\d{3,8}-\d{1,4})\b/
    ];

    for (
      const pattern of
      fisherPatterns
    ) {
      const match =
        raw.match(pattern);

      if (match) {
        article =
          match[1];

        break;
      }
    }
  }


  // ==========================================================
  // AMOUNT
  // ==========================================================

  let amount = "";

  const amountPatterns = [
    /\b(\d+(?:[.,]\d+)?)\s*(mg|kg|g|mL|ml|L|l)\b/,
    /\b(\d+(?:[.,]\d+)?)\s*(milligrams?|grams?|kilograms?|milliliters?|liters?)\b/i
  ];

  for (
    const pattern of
    amountPatterns
  ) {
    const match =
      raw.match(pattern);

    if (match) {
      let unit =
        match[2];

      // Normalize units.
      const normalized =
        unit.toLowerCase();

      if (
        normalized === "ml" ||
        normalized.startsWith(
          "milliliter"
        )
      ) {
        unit = "mL";
      }
      else if (
        normalized === "l" ||
        normalized.startsWith(
          "liter"
        )
      ) {
        unit = "L";
      }
      else if (
        normalized === "g" ||
        normalized.startsWith(
          "gram"
        )
      ) {
        unit = "g";
      }
      else if (
        normalized === "kg" ||
        normalized.startsWith(
          "kilogram"
        )
      ) {
        unit = "kg";
      }
      else if (
        normalized === "mg" ||
        normalized.startsWith(
          "milligram"
        )
      ) {
        unit = "mg";
      }

      amount =
        `${match[1]} ${unit}`;

      break;
    }
  }


  // ==========================================================
  // NAME CLEANUP
  // ==========================================================

  function cleanName(line) {
    let value =
      String(line || "")

        // Remove OCR symbols from start.
        .replace(
          /^[^A-Za-zÀ-ÿ]+/,
          ""
        )

        // Remove isolated punctuation at end.
        .replace(
          /[\s|_=~]+$/g,
          ""
        )

        // Remove trailing hyphen.
        //
        // Methanol -
        // ->
        // Methanol
        .replace(
          /\s*-\s*$/,
          ""
        )

        // Normalize whitespace.
        .replace(
          /\s+/g,
          " "
        )

        .trim();


    // Remove isolated OCR artefacts:
    //
    // Sodium hydroxide i
    // Acetone E
    value =
      value.replace(
        /\s+[iIlIeE]$/,
        ""
      );


    return value.trim();
  }


  // ==========================================================
  // NAME SCORING
  // ==========================================================

  function nameScore(
    line,
    index
  ) {
    const value =
      cleanName(line);

    if (
      value.length < 3 ||
      value.length > 80
    ) {
      return -10000;
    }


    const letters =
      (
        value.match(
          /[A-Za-zÀ-ÿ]/g
        ) || []
      ).length;

    if (letters < 3)
      return -10000;


    const words =
      value
        .split(/\s+/)
        .filter(Boolean);


    // --------------------------------------------------------
    // Tiny OCR garbage:
    // "Ga o", etc.
    // --------------------------------------------------------

    if (
      value.length <= 5 &&
      words.length <= 2
    ) {
      return -500;
    }


    // --------------------------------------------------------
    // Reject metadata
    // --------------------------------------------------------

    if (
      /\b(?:CAS|CASNo|EC|ECNo|Index|REACH|lot|batch|article|catalog|product)\b/i
        .test(value)
    ) {
      return -10000;
    }


    // --------------------------------------------------------
    // Reject safety language
    // --------------------------------------------------------

    if (
      /\b(?:danger|warning|hazard|causes|keep away|avoid|precaution|eyes?|irritation|drowsiness|sparks?|ignition)\b/i
        .test(value)
    ) {
      return -10000;
    }


    if (
      /^[HP]\s*\d{3}\b/i
        .test(value)
    ) {
      return -10000;
    }


    // --------------------------------------------------------
    // Reject grade / application
    // --------------------------------------------------------

    if (
      /\b(?:for analysis|laboratory|use only|ACS|ISO|Reag|Ph Eur|molecular biology)\b/i
        .test(value)
    ) {
      return -10000;
    }


    // --------------------------------------------------------
    // Reject addresses/company info
    // --------------------------------------------------------

    if (
      /\b(?:Germany|USA|GmbH|KGaA|Darmstadt|Karlsruhe)\b/i
        .test(value)
    ) {
      return -10000;
    }


    if (
      /www\.|\.com\b/i
        .test(value)
    ) {
      return -10000;
    }


    if (
      makerRules.some(
        maker =>
          maker.regex.test(
            value
          )
      )
    ) {
      return -10000;
    }


    // --------------------------------------------------------
    // Reject obvious codes
    // --------------------------------------------------------

    const numbers =
      (
        value.match(
          /\d/g
        ) || []
      ).length;

    if (
      numbers > letters
    ) {
      return -10000;
    }


    let score = 0;


    // --------------------------------------------------------
    // Multi-word chemical names
    // --------------------------------------------------------

    if (
      words.length >= 2 &&
      words.length <= 5
    ) {
      score += 15;
    }


    // --------------------------------------------------------
    // Single-word chemicals are also common:
    // Methanol, Ethanol, Acetone
    // --------------------------------------------------------

    if (
      words.length === 1 &&
      value.length >= 6
    ) {
      score += 8;
    }


    // --------------------------------------------------------
    // Useful length range
    // --------------------------------------------------------

    if (
      value.length >= 6 &&
      value.length <= 40
    ) {
      score += 8;
    }


    // --------------------------------------------------------
    // Mostly alphabetic
    // --------------------------------------------------------

    if (
      letters /
      value.length >
      0.7
    ) {
      score += 8;
    }


    // --------------------------------------------------------
    // Chemical-like names
    // --------------------------------------------------------

    if (
      /\b(?:acid|hydroxide|chloride|bromide|iodide|nitrate|sulfate|sulphate|carbonate|phosphate|acetate|oxide|acetone|ethanol|methanol|propanol|butanol)\b/i
        .test(value)
    ) {
      score += 15;
    }


    // --------------------------------------------------------
    // CAS proximity
    // --------------------------------------------------------

    if (
      casAnchorIndex >= 0
    ) {
      const distance =
        casAnchorIndex -
        index;

      if (
        distance > 0 &&
        distance <= 12
      ) {
        score +=
          Math.max(
            0,
            18 -
            distance
          );
      }
    }


    return score;
  }


  // ==========================================================
  // SELECT CHEMICAL NAME
  // ==========================================================

  const nameCandidates =
    lines

      .map(
        (line, index) => ({
          original:
            line,

          cleaned:
            cleanName(line),

          score:
            nameScore(
              line,
              index
            )
        })
      )

      .filter(
        candidate =>
          candidate.score >
          -10000
      )

      .sort(
        (a, b) =>
          b.score -
          a.score
      );


  const name =
    nameCandidates[0]
      ?.cleaned
    || "";


  // ==========================================================
  // RETURN PARSED RESULT
  // ==========================================================

  return {
    name,
    cas,
    article,
    lot,
    manufacturer,
    amount,
    raw
  };
}


// ============================================================
// LOCAL STORAGE
// ============================================================

function save() {
  localStorage.setItem(
    K,
    JSON.stringify({
      session:
        $("#session").value,

      items
    })
  );
}


// ============================================================
// SAFE HTML
// ============================================================

function safe(value) {
  const element =
    document.createElement(
      "div"
    );

  element.textContent =
    value;

  return element.innerHTML;
}


// ============================================================
// INVENTORY DISPLAY
// ============================================================

function render() {
  $("#list").innerHTML =
    "";

  items.forEach(
    item => {
      const article =
        document.createElement(
          "article"
        );

      article.innerHTML =
        `<b>${
          safe(
            item.name ||
            "Unnamed chemical"
          )
        }</b>
        <small>
          ${
            safe(
              item.cas ||
              "No CAS"
            )
          }
          ${
            item.article
              ? ` • ${safe(item.article)}`
              : ""
          }
        </small>
        <button
          class="delete"
          aria-label="Delete container"
        >×</button>`;

      article
        .querySelector(
          "button"
        )
        .onclick =
          () => {
            items =
              items.filter(
                x =>
                  x.id !==
                  item.id
              );

            save();
            render();
          };

      $("#list")
        .append(
          article
        );
    }
  );

  $("#count")
    .textContent =
      `${items.length} containers`;

  $("#exports")
    .classList
    .toggle(
      "hidden",
      !items.length
    );
}


// ============================================================
// EDITOR
// ============================================================

function editor(show = true) {
  $("#home")
    .classList
    .toggle(
      "hidden",
      show
    );

  $("#editor")
    .classList
    .toggle(
      "hidden",
      !show
    );
}


// ============================================================
// POPULATE FORM
// ============================================================

function fill() {
  $$("[data-field]")
    .forEach(
      input => {
        input.value =
          form[
            input.dataset.field
          ] || "";
      }
    );

  $("#raw")
    .textContent =
      form.raw || "";

  $("#rawBox")
    .classList
    .toggle(
      "hidden",
      !form.raw
    );

  updateCASState();
}


// ============================================================
// CAS STATUS
// ============================================================

function updateCASState() {
  const value =
    $('[data-field="cas"]')
      .value;

  const status =
    $("#casState");

  if (!value) {
    status.textContent =
      "";

    status.className =
      "";

    return;
  }

  if (cv(value)) {
    status.textContent =
      "✓ Valid CAS checksum";

    status.className =
      "ok";
  }
  else {
    status.textContent =
      "⚠ Invalid CAS format/checksum";

    status.className =
      "warn";
  }
}


// ============================================================
// OCR
// ============================================================

async function scan(file) {
  editor();

  const status =
    $("#status");

  const progress =
    $("#progress");

  status
    .classList
    .remove(
      "hidden"
    );

  progress
    .classList
    .remove(
      "hidden"
    );

  status.textContent =
    "Starting local OCR...";

  progress.value =
    0;

  let worker = null;

  try {
    worker =
      await Tesseract.createWorker(
        "eng",
        1,
        {
          workerPath:
            "./ocr/worker.min.js",

          langPath:
            "./ocr/lang",

          corePath:
            "./ocr/core",

          logger:
            message => {
              status.textContent =
                message.status ||
                "Reading label";

              if (
                typeof
                message.progress ===
                "number"
              ) {
                progress.value =
                  Math.round(
                    message.progress *
                    100
                  );
              }
            }
        }
      );

    const result =
      await worker.recognize(
        file
      );

    form =
      parse(
        result.data.text ||
        ""
      );

    fill();

    status.textContent =
      `OCR complete. Verify every field. App v${APP_VERSION}`;

    progress.value =
      100;
  }

  catch (error) {
    console.error(
      "OCR error:",
      error
    );

    status.textContent =
      `OCR failed: ${
        error?.message ||
        String(error)
      }`;
  }

  finally {
    if (worker) {
      try {
        await worker.terminate();
      }
      catch {}
    }
  }
}


// ============================================================
// CSV
// ============================================================

function esc(value = "") {
  const string =
    String(value);

  return /[",\n]/
    .test(string)

    ? `"${string.replaceAll(
        '"',
        '""'
      )}"`

    : string;
}


function csv() {
  const header = [
    "Timestamp",
    "Session",
    "Name",
    "CAS",
    "ArticleNumber",
    "Lot",
    "Manufacturer",
    "Amount"
  ];

  const session =
    $("#session").value;

  const rows =
    items.map(
      item => [
        item.timestamp,
        session,
        item.name,
        item.cas,
        item.article,
        item.lot,
        item.manufacturer,
        item.amount
      ]
    );

  return (
    "\uFEFF" +
    [header, ...rows]
      .map(
        row =>
          row
            .map(esc)
            .join(",")
      )
      .join("\r\n")
  );
}


// ============================================================
// CREATE CSV FILE
// ============================================================

function createCSVFile() {
  const date =
    new Date()
      .toISOString()
      .slice(
        0,
        10
      );

  return new File(
    [csv()],
    `chemical_inventory_${date}.csv`,
    {
      type:
        "text/csv"
    }
  );
}


// ============================================================
// DOWNLOAD CSV
// ============================================================

function downloadCSV() {
  const file =
    createCSVFile();

  const url =
    URL.createObjectURL(
      file
    );

  const anchor =
    document.createElement(
      "a"
    );

  anchor.href =
    url;

  anchor.download =
    file.name;

  anchor.click();

  setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    1000
  );
}


// ============================================================
// CAMERA
// ============================================================

$("#camera").onclick =
  () => {
    $("#photo")
      .click();
  };


$("#photo").onchange =
  event => {
    const file =
      event
        .target
        .files?.[0];

    if (file) {
      scan(file);
    }

    event.target.value =
      "";
  };


// ============================================================
// MANUAL ENTRY
// ============================================================

$("#manual").onclick =
  () => {
    form = E();

    fill();

    editor();
  };


// ============================================================
// CANCEL
// ============================================================

$("#cancel").onclick =
  () => {
    editor(false);
  };


// ============================================================
// ADD CONTAINER
// ============================================================

$("#add").onclick =
  () => {
    form = {
      ...form
    };

    $$("[data-field]")
      .forEach(
        input => {
          form[
            input.dataset.field
          ] =
            input.value
              .trim();
        }
      );

    if (
      !form.name &&
      !form.cas
    ) {
      return;
    }

    items.push({
      ...form,

      id:
        crypto.randomUUID(),

      timestamp:
        new Date()
          .toISOString()
    });

    save();
    render();
    editor(false);
  };


// ============================================================
// CAS LISTENER
// ============================================================

$('[data-field="cas"]')
  .oninput =
    updateCASState;


// ============================================================
// SESSION
// ============================================================

$("#session")
  .onchange =
    save;


// ============================================================
// DOWNLOAD
// ============================================================

$("#download")
  .onclick =
    downloadCSV;


// ============================================================
// SHARE
// ============================================================

$("#share")
  .onclick =
    async () => {
      const file =
        createCSVFile();

      try {
        if (
          navigator.share &&
          (
            !navigator.canShare ||
            navigator.canShare({
              files:
                [file]
            })
          )
        ) {
          await navigator.share({
            title:
              $("#session")
                .value,

            files:
              [file]
          });
        }
        else {
          downloadCSV();
        }
      }

      catch (error) {
        if (
          error.name !==
          "AbortError"
        ) {
          downloadCSV();
        }
      }
    };


// ============================================================
// RESTORE LOCAL INVENTORY
// ============================================================

try {
  const saved =
    JSON.parse(
      localStorage
        .getItem(K)
      ||
      "null"
    );

  if (saved) {
    items =
      saved.items ||
      [];

    $("#session").value =
      saved.session ||
      "Lab inventory";
  }
}

catch (error) {
  console.warn(
    "Could not restore inventory:",
    error
  );
}


render();


// ============================================================
// SERVICE WORKER
// ============================================================

if (
  "serviceWorker" in
  navigator
) {
  navigator
    .serviceWorker
    .register(
      "./sw.js"
    )
    .catch(
      error => {
        console.warn(
          "Service worker registration failed:",
          error
        );
      }
    );
}


// ============================================================
// VERSION
// ============================================================

console.log(
  `Chemical Scanner v${APP_VERSION}`
);
