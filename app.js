import Tesseract from "./ocr/tesseract.esm.min.js";

const APP_VERSION = "1.6";

const E = () => ({
  name: "",
  cas: "",
  article: "",
  lot: "",
  manufacturer: "",
  amount: "",
  raw: ""
});

const K = "chem-v6";

let items = [];
let form = E();

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];


// ============================================================
// CAS VALIDATION
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
// CAS RECONSTRUCTION
//
// CAS structure is ALWAYS:
//
// [2-7 DIGITS]-[2 DIGITS]-[1 CHECK DIGIT]
//
// First block length is variable.
//
// Examples:
//
// 67641       -> 67-64-1
// 50000       -> 50-00-0
// 1310732     -> 1310-73-2
// 7732185     -> 7732-18-5
// 10043353    -> 10043-35-3
// ============================================================

function reconstructCAS(value) {

  if (!value) return "";

  const digits = String(value)
    .replace(/\D/g, "");

  // 2-7 digits
  // + 2 middle digits
  // + 1 check digit
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

  // Never trust reconstructed OCR unless
  // the CAS checksum confirms it.
  return cv(candidate)
    ? candidate
    : "";
}


// ============================================================
// EXTRACT CAS FROM A CAS-ANCHORED LINE
// ============================================================

function extractCASFromAnchoredText(text) {

  if (!text) return "";

  // Remove the CAS label itself.
  //
  // Supports:
  // CAS
  // CAS:
  // CAS No
  // CAS-No.
  // CAS Number

  let value = String(text)
    .replace(
      /^.*?\bCAS\b(?:\s*[-:]?\s*(?:No\.?|Number))?\s*[:#.-]?\s*/i,
      ""
    )
    .trim();


  // ----------------------------------------------------------
  // Attempt 1:
  // Already correctly formatted CAS
  // ----------------------------------------------------------

  const normalMatches =
    value.match(
      /\b\d{2,7}\s*-\s*\d{2}\s*-\s*\d\b/g
    ) || [];

  for (const match of normalMatches) {

    const candidate = match
      .replace(/\s+/g, "");

    if (cv(candidate))
      return candidate;
  }


  // ----------------------------------------------------------
  // Attempt 2:
  // OCR damaged/remove separators.
  //
  // Example:
  //
  // 1310-732
  // ->
  // digits 1310732
  // ->
  // 1310-73-2
  // ----------------------------------------------------------

  const numberChunk =
    value.match(
      /[\d][\d\s.-]{3,15}\d/
    )?.[0] || "";


  if (numberChunk) {

    const repaired =
      reconstructCAS(
        numberChunk
      );

    if (repaired)
      return repaired;
  }


  return "";
}


// ============================================================
// MAIN OCR PARSER
// ============================================================

function parse(t) {

  const raw =
    String(t || "")
      .replace(/\r/g, "");

  const lines =
    raw
      .split("\n")
      .map(x => x.trim())
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
  //
  // ANCHOR FIRST.
  //
  // We never search the whole label blindly for CAS-shaped
  // values because Index-No. can contain CAS-looking fragments.
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


    if (!/\bCAS\b/i.test(line))
      continue;


    casAnchorIndex = i;


    // --------------------------------------------------------
    // Same line:
    //
    // CAS-No. 1310-732
    // --------------------------------------------------------

    cas =
      extractCASFromAnchoredText(
        line
      );


    if (cas)
      break;


    // --------------------------------------------------------
    // OCR can split:
    //
    // CAS-No.
    // 1310-73-2
    //
    // Check NEXT line only.
    // --------------------------------------------------------

    if (
      i + 1 <
      lines.length
    ) {

      const next =
        lines[i + 1];


      // Never pull EC / Index / REACH values
      // into CAS.

      if (
        !/\b(?:EC|Index|REACH)\b/i
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
  // Generic supplier labels
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
  // Merck article-number pattern
  //
  // Example:
  //
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


  // ==========================================================
  // AMOUNT
  // ==========================================================

  let amount = "";


  // Supports:
  //
  // 1 g
  // 1g
  // 500 g
  // 2.5 L
  // 2,5 L
  // 500mL

  const amountMatches =
    raw.match(
      /\b\d+(?:[.,]\d+)?\s*(?:mg|kg|g|mL|ml|L|l)\b/g
    ) || [];


  if (amountMatches.length) {

    // Normalize:
    //
    // 1g -> 1 g
    // 500mL -> 500 mL

    amount =
      amountMatches[0]
        .replace(
          /(\d)([A-Za-z])/,
          "$1 $2"
        )
        .trim();
  }


  // ==========================================================
  // CHEMICAL NAME CLEANUP
  // ==========================================================

  function cleanName(line) {

    let x =
      String(line || "")

        // Remove OCR rubbish ahead of first letter
        .replace(
          /^[^A-Za-zÀ-ÿ]+/,
          ""
        )

        // Remove unusual ending symbols
        .replace(
          /[^A-Za-z0-9À-ÿ(),.+\- ]+$/g,
          ""
        )

        // Normalize whitespace
        .replace(
          /\s+/g,
          " "
        )

        .trim();


    // --------------------------------------------------------
    // Remove isolated OCR artefacts.
    //
    // Sodium hydroxide i
    // ->
    // Sodium hydroxide
    //
    // Acetone E
    // ->
    // Acetone
    // --------------------------------------------------------

    x = x.replace(
      /\s+[iIlIeE]$/,
      ""
    );


    return x.trim();
  }


  // ==========================================================
  // CHEMICAL NAME SCORING
  // ==========================================================

  function nameScore(
    line,
    index
  ) {

    const x =
      cleanName(line);


    if (
      x.length < 3 ||
      x.length > 80
    )
      return -10000;


    // Must contain actual letters

    const letters =
      (
        x.match(
          /[A-Za-zÀ-ÿ]/g
        ) || []
      ).length;


    if (letters < 3)
      return -10000;


    // --------------------------------------------------------
    // Strongly penalize tiny OCR fragments
    //
    // Example:
    // "Ga o"
    // --------------------------------------------------------

    const words =
      x
        .split(/\s+/)
        .filter(Boolean);


    if (
      x.length <= 5 &&
      words.length <= 2
    )
      return -500;


    // --------------------------------------------------------
    // Reject metadata
    // --------------------------------------------------------

    if (
      /\b(?:CAS|EC|Index|REACH|lot|batch|article|catalog|product)\b/i
        .test(x)
    )
      return -10000;


    // --------------------------------------------------------
    // Reject hazard language
    // --------------------------------------------------------

    if (
      /\b(?:danger|warning|hazard|causes|keep away|avoid|precaution|eyes?|irritation|drowsiness|sparks?|ignition)\b/i
        .test(x)
    )
      return -10000;


    // --------------------------------------------------------
    // Reject H/P statements
    // --------------------------------------------------------

    if (
      /^[HP]\s*\d{3}\b/i
        .test(x)
    )
      return -10000;


    // --------------------------------------------------------
    // Reject grades/use instructions
    // --------------------------------------------------------

    if (
      /\b(?:for analysis|laboratory|use only|ACS|ISO|Reag|Ph Eur|molecular biology)\b/i
        .test(x)
    )
      return -10000;


    // --------------------------------------------------------
    // Reject company/address information
    // --------------------------------------------------------

    if (
      /\b(?:Germany|USA|GmbH|KGaA|Darmstadt|Karlsruhe)\b/i
        .test(x)
    )
      return -10000;


    if (
      /www\.|\.com\b/i
        .test(x)
    )
      return -10000;


    // --------------------------------------------------------
    // Reject known manufacturer lines
    // --------------------------------------------------------

    if (
      makerRules.some(
        maker =>
          maker.regex.test(x)
      )
    )
      return -10000;


    // --------------------------------------------------------
    // Reject dates
    // --------------------------------------------------------

    if (
      /^\d{4}-\d{2}-\d{2}$/
        .test(x)
    )
      return -10000;


    // --------------------------------------------------------
    // Reject lines dominated by numbers
    // --------------------------------------------------------

    const numbers =
      (
        x.match(
          /\d/g
        ) || []
      ).length;


    if (
      numbers >
      letters
    )
      return -10000;


    // --------------------------------------------------------
    // Reject quantity-only lines
    // --------------------------------------------------------

    if (
      /^\d+(?:[.,]\d+)?\s*(?:mg|kg|g|ml|mL|l|L)$/i
        .test(x)
    )
      return -10000;


    let score = 0;


    // --------------------------------------------------------
    // Useful word structure
    // --------------------------------------------------------

    if (
      words.length >= 2
    )
      score += 10;


    if (
      words.length >= 2 &&
      words.length <= 5
    )
      score += 8;


    // --------------------------------------------------------
    // Reasonable chemical-product length
    // --------------------------------------------------------

    if (
      x.length >= 6 &&
      x.length <= 40
    )
      score += 8;


    if (
      x.length >= 10 &&
      x.length <= 30
    )
      score += 5;


    // --------------------------------------------------------
    // Mostly alphabetic
    // --------------------------------------------------------

    if (
      letters /
      x.length >
      0.7
    )
      score += 8;


    // --------------------------------------------------------
    // Typical product name capitalization
    // --------------------------------------------------------

    if (
      /^[A-ZÀ-Ý][A-Za-zÀ-ÿ0-9 ,()+.\-]+$/
        .test(x)
    )
      score += 6;


    // --------------------------------------------------------
    // Chemical-like endings
    // --------------------------------------------------------

    if (
      /\b(?:acid|hydroxide|chloride|bromide|iodide|nitrate|sulfate|sulphate|carbonate|phosphate|acetate|oxide|alcohol|acetone|ethanol|methanol)\b/i
        .test(x)
    )
      score += 12;


    // --------------------------------------------------------
    // CAS proximity
    //
    // Product name is often located above CAS.
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
            16 -
            distance
          );
      }
    }


    return score;
  }


  // ==========================================================
  // SELECT NAME
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
  // RESULT
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

  progress.value = 0;


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
    $("#session")
      .value;


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
// DOWNLOAD
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
// PHOTOGRAPH CONTAINER
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
// CAS FIELD LISTENER
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
// DOWNLOAD BUTTON
// ============================================================

$("#download")
  .onclick =
    downloadCSV;


// ============================================================
// SHARE BUTTON
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
