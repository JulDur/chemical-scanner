import Tesseract from "./ocr/tesseract.esm.min.js";

const E = () => ({
  name: "",
  cas: "",
  article: "",
  lot: "",
  manufacturer: "",
  amount: "",
  raw: ""
});

const K = "chem-v4";

let items = [];
let form = E();

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];


// ============================================================
// CAS VALIDATION
// ============================================================

function cv(c) {

  const m = c
    .trim()
    .match(/^(\d{2,7})-(\d{2})-(\d)$/);

  if (!m)
    return false;

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
// OCR TEXT PARSER
// ============================================================

function parse(t) {

  const c = t.replace(/\r/g, "");

  const lines = c
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);


  // ==========================================================
  // CAS NUMBER
  // ==========================================================

  function normalizeCAS(value) {

    if (!value)
      return "";

    return value
      .replace(/\s*-\s*/g, "-")
      .replace(/\s+/g, "-")
      .trim();
  }


  function extractCASFromText(text) {

    if (!text)
      return "";

    const matches =
      text.match(
        /\b\d{2,7}\s*-\s*\d{2}\s*-\s*\d\b/g
      ) || [];

    for (const raw of matches) {

      const candidate =
        normalizeCAS(raw);

      if (cv(candidate))
        return candidate;
    }

    return "";
  }


  let cas = "";
  let casLineIndex = -1;


  // ----------------------------------------------------------
  // CAS must be associated with a CAS label.
  //
  // This prevents:
  //
  // Index-No.: 011-002-00-6
  //
  // from becoming:
  //
  // 002-00-6
  // ----------------------------------------------------------

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {

    const line = lines[i];


    // Explicitly ignore other regulatory identifiers

    if (
      /\b(?:EC|Index|REACH)\b/i.test(line) &&
      !/\bCAS\b/i.test(line)
    )
      continue;


    if (!/\bCAS\b/i.test(line))
      continue;


    // First try same line

    let candidate =
      extractCASFromText(line);


    if (candidate) {

      cas = candidate;
      casLineIndex = i;

      break;
    }


    // OCR sometimes creates:
    //
    // CAS-No.:
    // 1310-73-2
    //
    // Therefore inspect the NEXT line only.

    if (i + 1 < lines.length) {

      const nextLine =
        lines[i + 1];


      // Do not accidentally jump into EC / Index metadata

      if (
        !/\b(?:EC|Index|REACH)\b/i.test(
          nextLine
        )
      ) {

        candidate =
          extractCASFromText(
            nextLine
          );


        if (candidate) {

          cas = candidate;
          casLineIndex = i;

          break;
        }
      }
    }
  }


  // IMPORTANT:
  //
  // There is intentionally NO global search fallback.
  //
  // If Tesseract does not reliably associate a number
  // with the CAS label, CAS remains blank.
  //
  // This is safer than mistakenly importing EC-No.,
  // Index-No. or another regulatory identifier.


  // ==========================================================
  // GENERIC VALUE FINDER
  // ==========================================================

  const g = r =>
    c.match(r)?.[1]?.trim() || "";


  // ==========================================================
  // MANUFACTURER
  // ==========================================================

  const makers = [
    /merck/i,
    /sigma[- ]?aldrich/i,
    /supelco/i,
    /\bvwr\b/i,
    /avantor/i,
    /carl\s*roth/i,
    /thermo\s*fisher/i,
    /thermo\s*scientific/i,
    /fisher\s*scientific/i,
    /fisher\s*chemical/i
  ];


  const manufacturer =
    makers
      .map(r => c.match(r)?.[0])
      .find(Boolean)
    || "";


  // ==========================================================
  // ARTICLE NUMBER
  // ==========================================================

  const article = g(
    /(?:article|article\s*no\.?|art\.?\s*no\.?|catalog(?:ue)?\s*(?:no\.?|number)?|cat\.?\s*no\.?|product\s*no\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9.\/-]{2,})/i
  );


  // ==========================================================
  // LOT / BATCH
  // ==========================================================

  const lot = g(
    /(?:lot|lot\s*no\.?|batch|batch\s*no\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9.\/-]{2,})/i
  );


  // ==========================================================
  // AMOUNT
  // ==========================================================

  const amount = g(
    /\b(\d+(?:[.,]\d+)?\s*(?:mg|g|kg|ml|mL|l|L))\b/
  );


  // ==========================================================
  // CHEMICAL NAME
  // ==========================================================

  function cleanName(line) {

    let x = line

      // Remove OCR symbols before first letter
      .replace(
        /^[^A-Za-z]+/,
        ""
      )

      // Remove unusual trailing symbols
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
    // Remove isolated OCR garbage
    //
    // Sodium hydroxide i
    // -> Sodium hydroxide
    //
    // Acetone E
    // -> Acetone
    // --------------------------------------------------------

    x = x.replace(
      /\s+[iIlIeE]$/,
      ""
    );


    return x.trim();
  }


  function nameScore(
    line,
    index
  ) {

    const x =
      cleanName(line);


    // --------------------------------------------------------
    // Basic candidate requirements
    // --------------------------------------------------------

    if (
      x.length < 3 ||
      x.length > 70
    )
      return -999;


    if (!/[A-Za-z]/.test(x))
      return -999;


    // --------------------------------------------------------
    // Regulatory metadata
    // --------------------------------------------------------

    if (
      /CAS|EC[- ]?No|Index[- ]?No|REACH|article|catalog|product|lot|batch/i
        .test(x)
    )
      return -999;


    // --------------------------------------------------------
    // Hazard / precautionary statements
    // --------------------------------------------------------

    if (
      /danger|warning|hazard|causes|keep away|avoid|if in eyes|precaution/i
        .test(x)
    )
      return -999;


    // --------------------------------------------------------
    // H/P safety statements
    // --------------------------------------------------------

    if (
      /^[HP]\d{3}\b/i
        .test(x)
    )
      return -999;


    // --------------------------------------------------------
    // Grade / application information
    // --------------------------------------------------------

    if (
      /for analysis|laboratory|use only|ACS|Reag\.?|Ph Eur|ISO|molecular biology/i
        .test(x)
    )
      return -999;


    // --------------------------------------------------------
    // Company/address information
    // --------------------------------------------------------

    if (
      /www\.|\.com|Germany|USA|GmbH|KGaA|Darmstadt|Karlsruhe|Scientific/i
        .test(x)
    )
      return -999;


    // --------------------------------------------------------
    // Dates
    // --------------------------------------------------------

    if (
      /^\d{4}-\d{2}-\d{2}$/
        .test(x)
    )
      return -999;


    // --------------------------------------------------------
    // Product codes / lot-like codes / numbers
    // --------------------------------------------------------

    if (
      /^[A-Z]?\d[\dA-Z.\/-]*$/i
        .test(x)
    )
      return -999;


    // --------------------------------------------------------
    // Quantity-only information
    // --------------------------------------------------------

    if (
      /\b\d+(?:[.,]\d+)?\s*(?:mg|g|kg|ml|l)\b/i
        .test(x)
    )
      return -999;


    // --------------------------------------------------------
    // Percentage / purity information
    // --------------------------------------------------------

    if (
      /\d+(?:[.,]\d+)?\s*%/
        .test(x)
    )
      return -999;


    let score = 0;


    // --------------------------------------------------------
    // Plausible length
    // --------------------------------------------------------

    if (x.length <= 30)
      score += 5;

    if (x.length <= 20)
      score += 3;


    // --------------------------------------------------------
    // Mostly alphabetic
    // --------------------------------------------------------

    const letters =
      (
        x.match(
          /[A-Za-z]/g
        ) || []
      ).length;


    if (
      letters / x.length > 0.65
    )
      score += 5;


    // --------------------------------------------------------
    // Typical chemical-name appearance
    // --------------------------------------------------------

    if (
      /^[A-Z][A-Za-z0-9 ,()+.\-]+$/
        .test(x)
    )
      score += 5;


    // --------------------------------------------------------
    // Position relative to explicit CAS label
    // --------------------------------------------------------

    if (casLineIndex >= 0) {

      const distance =
        casLineIndex - index;


      // Product name is commonly located a few OCR lines
      // above the CAS field.

      if (
        distance > 0 &&
        distance <= 12
      ) {

        score +=
          Math.max(
            0,
            14 - distance
          );
      }
    }


    // --------------------------------------------------------
    // Manufacturer cannot be chemical name
    // --------------------------------------------------------

    if (
      makers.some(
        r => r.test(x)
      )
    )
      score -= 40;


    return score;
  }


  // ==========================================================
  // SELECT BEST NAME CANDIDATE
  // ==========================================================

  const nameCandidates =
    lines

      .map(
        (line, index) => ({
          original: line,
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
        x =>
          x.score > -999
      )

      .sort(
        (a, b) =>
          b.score - a.score
      );


  const name =
    nameCandidates[0]?.cleaned
    || "";


  // ==========================================================
  // RETURN RESULT
  // ==========================================================

  return {
    name,
    cas,
    article,
    lot,
    manufacturer,
    amount,
    raw: c
  };
}


// ============================================================
// SAVE INVENTORY LOCALLY
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

function safe(s) {

  const d =
    document.createElement(
      "div"
    );

  d.textContent = s;

  return d.innerHTML;
}


// ============================================================
// INVENTORY DISPLAY
// ============================================================

function render() {

  $("#list").innerHTML = "";


  items.forEach(x => {

    const a =
      document.createElement(
        "article"
      );


    a.innerHTML =
      `<b>${
        safe(
          x.name ||
          "Unnamed chemical"
        )
      }</b>

      <small>
        ${
          safe(
            x.cas ||
            "No CAS"
          )
        }

        ${
          x.article
            ? ` • ${safe(x.article)}`
            : ""
        }
      </small>

      <button
        class="delete"
        aria-label="Delete container"
      >
        ×
      </button>`;


    a
      .querySelector("button")
      .onclick = () => {

        items =
          items.filter(
            y =>
              y.id !== x.id
          );

        save();
        render();
      };


    $("#list").append(a);
  });


  $("#count").textContent =
    `${items.length} containers`;


  $("#exports")
    .classList
    .toggle(
      "hidden",
      !items.length
    );
}


// ============================================================
// EDITOR VISIBILITY
// ============================================================

function editor(v = true) {

  $("#home")
    .classList
    .toggle(
      "hidden",
      v
    );


  $("#editor")
    .classList
    .toggle(
      "hidden",
      !v
    );
}


// ============================================================
// POPULATE CONFIRMATION FORM
// ============================================================

function fill() {

  $$('[data-field]')
    .forEach(i => {

      i.value =
        form[
          i.dataset.field
        ] || "";
    });


  $("#raw").textContent =
    form.raw || "";


  $("#rawBox")
    .classList
    .toggle(
      "hidden",
      !form.raw
    );


  cs();
}


// ============================================================
// CAS VALIDATION DISPLAY
// ============================================================

function cs() {

  const c =
    $('[data-field="cas"]')
      .value;


  const s =
    $("#casState");


  if (!c) {

    s.textContent = "";
    s.className = "";

    return;
  }


  if (cv(c)) {

    s.textContent =
      "✓ Valid CAS checksum";

    s.className =
      "ok";

  }

  else {

    s.textContent =
      "⚠ Invalid CAS format/checksum";

    s.className =
      "warn";
  }
}


// ============================================================
// OCR
// ============================================================

async function scan(f) {

  editor();


  const st =
    $("#status");

  const pr =
    $("#progress");


  st.classList.remove(
    "hidden"
  );

  pr.classList.remove(
    "hidden"
  );


  st.textContent =
    "Starting local OCR...";

  pr.value = 0;


  try {

    const w =
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

          logger: m => {

            st.textContent =
              m.status ||
              "Reading label";


            if (
              typeof m.progress ===
              "number"
            ) {

              pr.value =
                Math.round(
                  m.progress *
                  100
                );
            }
          }
        }
      );


    const r =
      await w.recognize(f);


    await w.terminate();


    form =
      parse(
        r.data.text ||
        ""
      );


    fill();


    st.textContent =
      "OCR complete. Verify every field.";

    pr.value = 100;

  }

  catch (e) {

    console.error(
      "OCR error:",
      e
    );


    st.textContent =
      `OCR failed: ${
        e?.message ||
        String(e)
      }`;
  }
}


// ============================================================
// CSV ESCAPING
// ============================================================

function esc(v = "") {

  const s =
    String(v);


  return /[",\n]/.test(s)

    ? `"${s.replaceAll(
        '"',
        '""'
      )}"`

    : s;
}


// ============================================================
// CREATE CSV CONTENT
// ============================================================

function csv() {

  const h = [
    "Timestamp",
    "Session",
    "Name",
    "CAS",
    "ArticleNumber",
    "Lot",
    "Manufacturer",
    "Amount"
  ];


  const q =
    $("#session").value;


  const r =
    items.map(
      x => [

        x.timestamp,
        q,
        x.name,
        x.cas,
        x.article,
        x.lot,
        x.manufacturer,
        x.amount

      ]
    );


  return "\uFEFF" +

    [h, ...r]

      .map(
        x =>
          x
            .map(esc)
            .join(",")
      )

      .join("\r\n");
}


// ============================================================
// CREATE CSV FILE
// ============================================================

function cf() {

  return new File(

    [csv()],

    `chemical_inventory_${
      new Date()
        .toISOString()
        .slice(
          0,
          10
        )
    }.csv`,

    {
      type:
        "text/csv"
    }
  );
}


// ============================================================
// DOWNLOAD CSV
// ============================================================

function dl() {

  const f =
    cf();


  const u =
    URL.createObjectURL(
      f
    );


  const a =
    document.createElement(
      "a"
    );


  a.href =
    u;

  a.download =
    f.name;


  a.click();


  setTimeout(
    () =>
      URL.revokeObjectURL(
        u
      ),
    1000
  );
}


// ============================================================
// CAMERA
// ============================================================

$("#camera").onclick =
  () =>
    $("#photo").click();


$("#photo").onchange =
  e => {

    const f =
      e.target.files?.[0];


    if (f)
      scan(f);


    e.target.value =
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
  () =>
    editor(false);


// ============================================================
// ADD CONTAINER
// ============================================================

$("#add").onclick =
  () => {

    form = {
      ...form
    };


    $$('[data-field]')
      .forEach(i => {

        form[
          i.dataset.field
        ] =
          i.value.trim();
      });


    if (
      !form.name &&
      !form.cas
    )
      return;


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
// CAS FIELD
// ============================================================

$('[data-field="cas"]')
  .oninput =
    cs;


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
    dl;


// ============================================================
// SHARE
// ============================================================

$("#share")
  .onclick =
    async () => {

      const f =
        cf();


      try {

        if (
          navigator.share &&
          (
            !navigator.canShare ||
            navigator.canShare({
              files: [f]
            })
          )
        ) {

          await navigator.share({

            title:
              $("#session")
                .value,

            files:
              [f]
          });

        }

        else {

          dl();
        }
      }

      catch (e) {

        if (
          e.name !==
          "AbortError"
        )
          dl();
      }
    };


// ============================================================
// RESTORE SAVED INVENTORY
// ============================================================

try {

  const s =
    JSON.parse(
      localStorage
        .getItem(K)
      ||
      "null"
    );


  if (s) {

    items =
      s.items ||
      [];


    $("#session").value =
      s.session ||
      "Lab inventory";
  }
}

catch {}


render();


// ============================================================
// SERVICE WORKER
// ============================================================

if (
  "serviceWorker"
  in navigator
) {

  navigator
    .serviceWorker
    .register(
      "./sw.js"
    );
}
