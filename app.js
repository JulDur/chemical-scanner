import Tesseract from "./ocr/tesseract.esm.min.js";

const E=()=>({
  name:"",
  cas:"",
  article:"",
  lot:"",
  manufacturer:"",
  amount:"",
  raw:""
});

const K="chem-v3";

let items=[];
let form=E();

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];


// ============================================================
// CAS validation
// ============================================================

function cv(c){
  const m=c.trim().match(/^(\d{2,7})-(\d{2})-(\d)$/);

  if(!m) return false;

  const d=(m[1]+m[2])
    .split("")
    .map(Number)
    .reverse();

  return d.reduce(
    (s,n,i)=>s+n*(i+1),
    0
  )%10===+m[3];
}


// ============================================================
// OCR text parser
// ============================================================

function parse(t){

  const c=t.replace(/\r/g,"");

  const lines=c
    .split("\n")
    .map(x=>x.trim())
    .filter(Boolean);


  // ----------------------------------------------------------
  // CAS
  // ----------------------------------------------------------

  const casCandidates=(
    c.match(/\b\d{2,7}[\s-]\d{2}[\s-]\d\b/g)||[]
  ).map(
    x=>x.replace(/\s/g,"-")
  );

  const cas=
    casCandidates.find(cv)||
    casCandidates[0]||
    "";


  // ----------------------------------------------------------
  // Generic value finder
  // ----------------------------------------------------------

  const g=r=>
    c.match(r)?.[1]?.trim()||"";


  // ----------------------------------------------------------
  // Manufacturer
  // ----------------------------------------------------------

  const makers=[
    /merck/i,
    /sigma[- ]?aldrich/i,
    /supelco/i,
    /vwr/i,
    /avantor/i,
    /carl\s*roth/i,
    /thermo\s*fisher/i,
    /thermo\s*scientific/i,
    /fisher\s*scientific/i
  ];

  const manufacturer=
    makers
      .map(r=>c.match(r)?.[0])
      .find(Boolean)
    ||"";


  // ----------------------------------------------------------
  // Article number
  // ----------------------------------------------------------

  const article=g(
    /(?:article|article\s*no\.?|art\.?\s*no\.?|catalog(?:ue)?\s*(?:no\.?|number)?|cat\.?\s*no\.?|product\s*no\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9.\/-]{2,})/i
  );


  // ----------------------------------------------------------
  // Lot / Batch
  // ----------------------------------------------------------

  const lot=g(
    /(?:lot|lot\s*no\.?|batch|batch\s*no\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9.\/-]{2,})/i
  );


  // ----------------------------------------------------------
  // Container amount
  // ----------------------------------------------------------

  const amount=g(
    /\b(\d+(?:[.,]\d+)?\s*(?:mg|g|kg|ml|mL|l|L))\b/
  );


  // ----------------------------------------------------------
  // Chemical name detection
  // ----------------------------------------------------------

  const casLine=
    lines.findIndex(
      x=>x.includes(cas)
    );


  // Clean OCR artefacts from possible product names
  function cleanName(line){

    return line

      // Remove symbols before the first letter
      .replace(/^[^A-Za-z]+/,"")

      // Remove strange OCR symbols at the end
      .replace(
        /[^A-Za-z0-9À-ÿ(),.+\- ]+$/g,
        ""
      )

      // Example:
      // "== Acetone E" -> "Acetone"
      .replace(/\s+[A-Z]$/,"")

      // Collapse repeated whitespace
      .replace(/\s+/g," ")

      .trim();
  }


  function nameScore(line,index){

    const x=cleanName(line);

    if(x.length<3 || x.length>70)
      return -999;

    if(!/[A-Za-z]/.test(x))
      return -999;


    // --------------------------------------------------------
    // Reject obvious metadata
    // --------------------------------------------------------

    if(
      /CAS|EC[- ]?No|Index[- ]?No|article|catalog|product|lot|batch/i
      .test(x)
    )
      return -999;


    // --------------------------------------------------------
    // Reject hazard / precautionary statements
    // --------------------------------------------------------

    if(
      /danger|warning|hazard|causes|keep away|avoid|if in eyes|precaution/i
      .test(x)
    )
      return -999;


    // --------------------------------------------------------
    // Reject grade / usage information
    // --------------------------------------------------------

    if(
      /for analysis|laboratory|use only|ACS|Reag\.?|Ph Eur|ISO/i
      .test(x)
    )
      return -999;


    // --------------------------------------------------------
    // Reject company/address information
    // --------------------------------------------------------

    if(
      /www\.|\.com|Germany|USA|GmbH|KGaA|Scientific/i
      .test(x)
    )
      return -999;


    // --------------------------------------------------------
    // Reject dates
    // --------------------------------------------------------

    if(
      /^\d{4}-\d{2}-\d{2}$/.test(x)
    )
      return -999;


    // --------------------------------------------------------
    // Reject product codes / pure numbers
    // --------------------------------------------------------

    if(
      /^[A-Z]?\d[\dA-Z.\/-]*$/i.test(x)
    )
      return -999;


    // --------------------------------------------------------
    // Reject quantity-only lines
    // --------------------------------------------------------

    if(
      /\b\d+(?:[.,]\d+)?\s*(?:mg|g|kg|ml|l)\b/i
      .test(x)
    )
      return -999;


    let score=0;


    // --------------------------------------------------------
    // Prefer reasonably short names
    // --------------------------------------------------------

    if(x.length<=30)
      score+=5;

    if(x.length<=20)
      score+=3;


    // --------------------------------------------------------
    // Prefer predominantly alphabetic strings
    // --------------------------------------------------------

    const letters=
      (x.match(/[A-Za-z]/g)||[]).length;

    if(
      letters/x.length>0.65
    )
      score+=5;


    // --------------------------------------------------------
    // Typical chemical-name structure
    //
    // Examples:
    // Acetone
    // Sodium hydroxide
    // L-Ascorbic acid
    // Hydrochloric acid
    // --------------------------------------------------------

    if(
      /^[A-Z][A-Za-z0-9 ,()+.\-]+$/
      .test(x)
    )
      score+=5;


    // --------------------------------------------------------
    // Prefer text located above the CAS number
    // --------------------------------------------------------

    if(casLine>=0){

      const distance=
        casLine-index;

      if(
        distance>0 &&
        distance<=8
      )
        score+=Math.max(
          0,
          10-distance
        );
    }


    // --------------------------------------------------------
    // Manufacturer names cannot be chemical names
    // --------------------------------------------------------

    if(
      makers.some(
        r=>r.test(x)
      )
    )
      score-=20;


    return score;
  }


  // ----------------------------------------------------------
  // Score candidate lines
  // ----------------------------------------------------------

  const nameCandidates=
    lines

      .map(
        (line,index)=>({
          original:line,
          cleaned:cleanName(line),
          score:nameScore(line,index)
        })
      )

      .filter(
        x=>x.score>-999
      )

      .sort(
        (a,b)=>b.score-a.score
      );


  const name=
    nameCandidates[0]?.cleaned||
    "";


  // ----------------------------------------------------------
  // Return parsed label
  // ----------------------------------------------------------

  return {
    name,
    cas,
    article,
    lot,
    manufacturer,
    amount,
    raw:c
  };
}


// ============================================================
// Save inventory locally
// ============================================================

function save(){

  localStorage.setItem(
    K,
    JSON.stringify({
      session:$("#session").value,
      items
    })
  );
}


// ============================================================
// HTML escaping
// ============================================================

function safe(s){

  const d=
    document.createElement("div");

  d.textContent=s;

  return d.innerHTML;
}


// ============================================================
// Inventory display
// ============================================================

function render(){

  $("#list").innerHTML="";

  items.forEach(x=>{

    const a=
      document.createElement("article");

    a.innerHTML=
      `<b>${safe(
        x.name||"Unnamed chemical"
      )}</b>
      <small>
        ${safe(
          x.cas||"No CAS"
        )}
        ${
          x.article
            ?` • ${safe(x.article)}`
            :""
        }
      </small>
      <button class="delete">×</button>`;

    a.querySelector("button").onclick=
      ()=>{

        items=
          items.filter(
            y=>y.id!==x.id
          );

        save();
        render();
      };

    $("#list").append(a);
  });


  $("#count").textContent=
    `${items.length} containers`;

  $("#exports")
    .classList
    .toggle(
      "hidden",
      !items.length
    );
}


// ============================================================
// Editor visibility
// ============================================================

function editor(v=true){

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
// Populate confirmation form
// ============================================================

function fill(){

  $$('[data-field]')
    .forEach(
      i=>
        i.value=
          form[i.dataset.field]||""
    );

  $("#raw").textContent=
    form.raw||"";

  $("#rawBox")
    .classList
    .toggle(
      "hidden",
      !form.raw
    );

  cs();
}


// ============================================================
// CAS validation display
// ============================================================

function cs(){

  const c=
    $('[data-field="cas"]').value;

  const s=
    $("#casState");

  s.textContent=
    c
      ?(
        cv(c)
          ?"✓ Valid CAS checksum"
          :"⚠ Invalid CAS format/checksum"
       )
      :"";

  s.className=
    cv(c)
      ?"ok"
      :"warn";
}


// ============================================================
// OCR
// ============================================================

async function scan(f){

  editor();

  const st=
    $("#status");

  const pr=
    $("#progress");

  st.classList.remove("hidden");

  pr.classList.remove("hidden");


  try{

    const w=
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

          logger:m=>{

            st.textContent=
              m.status||
              "Reading label";

            if(m.progress)
              pr.value=
                Math.round(
                  m.progress*100
                );
          }
        }
      );


    const r=
      await w.recognize(f);


    await w.terminate();


    form=
      parse(
        r.data.text||""
      );


    fill();


    st.textContent=
      "OCR complete. Verify every field.";

  }
  catch(e){

    console.error(
      "OCR error:",
      e
    );

    st.textContent=
      `OCR failed: ${
        e?.message||
        String(e)
      }`;
  }
}


// ============================================================
// CSV handling
// ============================================================

function esc(v=""){

  const s=
    String(v);

  return /[",\n]/.test(s)
    ?`"${s.replaceAll('"','""')}"`
    :s;
}


function csv(){

  const h=[
    "Timestamp",
    "Session",
    "Name",
    "CAS",
    "ArticleNumber",
    "Lot",
    "Manufacturer",
    "Amount"
  ];

  const q=
    $("#session").value;

  const r=
    items.map(
      x=>[
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


  return "\uFEFF"+
    [h,...r]
      .map(
        x=>
          x.map(esc).join(",")
      )
      .join("\r\n");
}


function cf(){

  return new File(
    [csv()],
    `chemical_inventory_${
      new Date()
        .toISOString()
        .slice(0,10)
    }.csv`,
    {
      type:"text/csv"
    }
  );
}


function dl(){

  const f=cf();

  const u=
    URL.createObjectURL(f);

  const a=
    document.createElement("a");

  a.href=u;

  a.download=f.name;

  a.click();

  setTimeout(
    ()=>URL.revokeObjectURL(u),
    1000
  );
}


// ============================================================
// Camera button
// ============================================================

$("#camera").onclick=
  ()=>$("#photo").click();


$("#photo").onchange=e=>{

  const f=
    e.target.files?.[0];

  if(f)
    scan(f);

  e.target.value="";
};


// ============================================================
// Manual entry
// ============================================================

$("#manual").onclick=()=>{

  form=E();

  fill();

  editor();
};


// ============================================================
// Cancel
// ============================================================

$("#cancel").onclick=
  ()=>editor(false);


// ============================================================
// Add container
// ============================================================

$("#add").onclick=()=>{

  form={
    ...form
  };


  $$('[data-field]')
    .forEach(
      i=>
        form[i.dataset.field]=
          i.value.trim()
    );


  if(
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
// CAS field
// ============================================================

$('[data-field="cas"]')
  .oninput=cs;


// ============================================================
// Session
// ============================================================

$("#session").onchange=
  save;


// ============================================================
// Download
// ============================================================

$("#download").onclick=
  dl;


// ============================================================
// Share
// ============================================================

$("#share").onclick=
  async()=>{

    const f=cf();

    try{

      if(
        navigator.share &&
        (
          !navigator.canShare ||
          navigator.canShare({
            files:[f]
          })
        )
      ){

        await navigator.share({
          title:
            $("#session").value,

          files:[f]
        });

      }
      else{

        dl();
      }

    }
    catch(e){

      if(
        e.name!=="AbortError"
      )
        dl();
    }
  };


// ============================================================
// Restore saved inventory
// ============================================================

try{

  const s=
    JSON.parse(
      localStorage.getItem(K)||
      "null"
    );


  if(s){

    items=
      s.items||[];

    $("#session").value=
      s.session||
      "Lab inventory";
  }

}
catch{}


render();


// ============================================================
// Service worker
// ============================================================

if(
  "serviceWorker" in navigator
){

  navigator.serviceWorker
    .register(
      "./sw.js"
    );
}
