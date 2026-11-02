import Tesseract from "./ocr/tesseract.esm.min.js";

const APP_VERSION="2.1";
const STORAGE_KEY="chem-v21";
const MAX_OCR_SIDE=1800;
const JPEG_QUALITY=0.84;
const EMPTY=()=>({name:"",cas:"",article:"",lot:"",manufacturer:"",amount:"",raw:"",ocrLines:[],photos:[]});
let items=[],form=EMPTY(),pickerField="",ocrWorker=null,workerPromise=null,containerOpen=false;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];

function casValid(cas){const m=String(cas||"").trim().match(/^(\d{2,7})-(\d{2})-(\d)$/);if(!m)return false;const d=(m[1]+m[2]).split("").map(Number).reverse();return d.reduce((s,n,i)=>s+n*(i+1),0)%10===Number(m[3]);}
function correctCASOCR(v){return String(v||"").replace(/[Oo]/g,"0").replace(/[Il]/g,"1").replace(/[Ss]/g,"5").replace(/B/g,"8");}
function reconstructCAS(v){const digits=correctCASOCR(v).replace(/\D/g,"");if(digits.length<5||digits.length>10)return "";const first=digits.slice(0,-3),candidate=`${first}-${digits.slice(-3,-1)}-${digits.slice(-1)}`;return first.length>=2&&first.length<=7&&casValid(candidate)?candidate:"";}
function hasCASAnchor(line){return /CAS\s*(?:[- ]?\s*(?:No\.?|Number))?/i.test(line);}
function afterCAS(line){return String(line||"").match(/CAS\s*(?:[- ]?\s*(?:No\.?|Number))?\s*[:#.]?\s*(.*)$/i)?.[1]?.trim()||"";}
function extractCAS(line){const v=correctCASOCR(afterCAS(line));const normal=v.match(/\d{2,7}\s*-\s*\d{2}\s*-\s*\d/);if(normal){const c=normal[0].replace(/\s+/g,"");if(casValid(c))return c;}return reconstructCAS(v);}
function cleanName(line){return String(line||"").replace(/^[^A-Za-zÀ-ÿ]+/,"").replace(/[\s|_=~]+$/g,"").replace(/\s*-\s*$/,"").replace(/\s+[iIlIeEA]$/,"").replace(/\s+/g," ").trim();}
function extractAmount(line){const m=String(line||"").match(/\b(\d+(?:[.,]\d+)?)\s*(mg|kg|g|mL|ml|L|l)\b/);if(!m)return "";const map={ml:"mL",l:"L",g:"g",kg:"kg",mg:"mg"};return `${m[1]} ${map[m[2].toLowerCase()]}`;}
function extractLot(line){return String(line||"").match(/\b(?:lot|batch)(?:\s*(?:no\.?|number))?\s*[:#.-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i)?.[1]?.trim()||"";}
function extractArticle(line,maker=""){let m=String(line||"").match(/(?:article|article\s*no\.?|art\.?\s*no\.?|catalog(?:ue)?\s*(?:no\.?|number)?|cat\.?\s*no\.?|product\s*(?:no\.?|number))\s*[:#.-]?\s*([A-Z0-9][A-Z0-9./-]{2,})/i);if(m)return m[1];if(maker==="Merck")return String(line).match(/\b\d\.\d{5}\.\d{4}\b/)?.[0]||"";if(/Fisher/.test(maker))return String(line).match(/\b([A-Z]{1,4}\d{3,8}-\d{1,4})\b/)?.[1]||"";return "";}
function normalizeForField(line,field){if(field==="name")return cleanName(line);if(field==="cas")return hasCASAnchor(line)?extractCAS(line):reconstructCAS(line);if(field==="article")return extractArticle(line,form.manufacturer)||String(line).trim();if(field==="lot")return extractLot(line)||String(line).trim();if(field==="amount")return extractAmount(line)||String(line).trim();if(field==="manufacturer")return String(line).replace(/^[^A-Za-z]+/,"").trim();return String(line).trim();}

function parse(text){
 const raw=String(text||"").replace(/\r/g,"");const lines=raw.split("\n").map(x=>x.trim()).filter(Boolean);
 const makers=[[/sigma[- ]?aldrich/i,"Sigma-Aldrich"],[/fisher\s*chemical/i,"Fisher Chemical"],[/thermo\s*fisher/i,"Thermo Fisher"],[/thermo\s*scientific/i,"Thermo Scientific"],[/fisher\s*scientific/i,"Fisher Scientific"],[/carl\s*roth/i,"Carl Roth"],[/supelco/i,"Supelco"],[/\bavantor\b/i,"Avantor"],[/\bvwr\b/i,"VWR"],[/\bmerck\b/i,"Merck"]];
 const manufacturer=makers.find(([r])=>r.test(raw))?.[1]||"";let cas="",casIndex=-1;
 for(let i=0;i<lines.length;i++){if(!hasCASAnchor(lines[i]))continue;casIndex=i;cas=extractCAS(lines[i]);if(!cas&&lines[i+1]&&!/^\s*(?:EC|Index|REACH)/i.test(lines[i+1]))cas=reconstructCAS(lines[i+1]);if(cas)break;}
 let lot="",article="",amount="";for(const line of lines){lot ||= extractLot(line);article ||= extractArticle(line,manufacturer);amount ||= extractAmount(line);}
 function score(line,index){const x=cleanName(line),letters=(x.match(/[A-Za-zÀ-ÿ]/g)||[]).length,words=x.split(/\s+/).filter(Boolean);if(x.length<3||x.length>80||letters<3)return -1e4;if(x.length<=5&&words.length<=2)return -500;if(/\b(?:CAS|CASNo|EC|ECNo|Index|REACH|lot|batch|article|catalog|product|danger|warning|hazard|causes|avoid|precaution|eyes?|Germany|USA|GmbH|KGaA)\b/i.test(x))return -1e4;if(/www\.|\.com\b|^[HP]\s*\d{3}\b|for analysis|laboratory|use only|ACS|ISO|Reag|Ph Eur/i.test(x))return -1e4;if(makers.some(([r])=>r.test(x)))return -1e4;let s=0;if(words.length>=2&&words.length<=5)s+=15;if(words.length===1&&x.length>=6)s+=8;if(x.length>=6&&x.length<=40)s+=8;if(letters/x.length>.7)s+=8;if(/\b(?:acid|hydroxide|chloride|bromide|iodide|nitrate|sulfate|carbonate|phosphate|acetate|oxide|acetone|ethanol|methanol|propanol|butanol)\b/i.test(x))s+=15;if(casIndex>=0){const d=casIndex-index;if(d>0&&d<=14)s+=Math.max(0,18-d);}return s;}
 const ranked=lines.map((line,index)=>({value:cleanName(line),score:score(line,index)})).sort((a,b)=>b.score-a.score),best=ranked[0];
 return {name:best&&best.score>=12?best.value:"",cas,article,lot,manufacturer,amount,raw,ocrLines:lines};
}

function mergeText(...texts){return [...new Set(texts.flatMap(t=>String(t||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean)))].join("\n");}
function makeCanvas(w,h){const c=document.createElement("canvas");c.width=w;c.height=h;return c;}
function canvasToBlob(canvas,type="image/jpeg",quality=JPEG_QUALITY){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Image conversion failed")),type,quality));}
async function prepareImages(file){const t0=performance.now(),bitmap=await createImageBitmap(file,{imageOrientation:"from-image"}),ow=bitmap.width,oh=bitmap.height,scale=Math.min(1,MAX_OCR_SIDE/Math.max(ow,oh)),w=Math.round(ow*scale),h=Math.round(oh*scale);const color=makeCanvas(w,h),cx=color.getContext("2d",{alpha:false});cx.fillStyle="#fff";cx.fillRect(0,0,w,h);cx.imageSmoothingEnabled=true;cx.imageSmoothingQuality="high";cx.drawImage(bitmap,0,0,w,h);bitmap.close();const colorBlob=await canvasToBlob(color);const gray=makeCanvas(w,h),gx=gray.getContext("2d",{alpha:false,willReadFrequently:true});gx.drawImage(color,0,0);const image=gx.getImageData(0,0,w,h),d=image.data;for(let i=0;i<d.length;i+=4){const lum=.2126*d[i]+.7152*d[i+1]+.0722*d[i+2],v=Math.max(0,Math.min(255,(lum-128)*1.35+128));d[i]=d[i+1]=d[i+2]=v;d[i+3]=255;}gx.putImageData(image,0,0);const grayBlob=await canvasToBlob(gray,"image/jpeg",.86);return {colorBlob,grayBlob,thumbURL:URL.createObjectURL(grayBlob),ow,oh,w,h,prep:(performance.now()-t0)/1000};}
async function getWorker(status,progress){if(ocrWorker)return ocrWorker;if(workerPromise)return workerPromise;workerPromise=Tesseract.createWorker("eng",1,{workerPath:"./ocr/worker.min.js",langPath:"./ocr/lang",corePath:"./ocr/core",logger:m=>{status.textContent=m.status||"Preparing OCR";if(typeof m.progress==="number")progress.value=Math.round(m.progress*100);}}).then(async w=>{await w.setParameters({tessedit_pageseg_mode:"11",preserve_interword_spaces:"1"});ocrWorker=w;return w;}).finally(()=>workerPromise=null);return workerPromise;}

function startContainer(){form=EMPTY();containerOpen=true;editor();renderPhotoStrip();fill();$("#status").classList.add("hidden");$("#progress").classList.add("hidden");}
async function processPhoto(file){
 if(!containerOpen)startContainer();const status=$("#status"),progress=$("#progress");status.classList.remove("hidden");progress.classList.remove("hidden");status.textContent=`Preparing photo ${form.photos.length+1}...`;progress.value=0;
 try{const prepared=await prepareImages(file),worker=await getWorker(status,progress);status.textContent=`Photo ${form.photos.length+1}: color OCR...`;let t=performance.now(),color=await worker.recognize(prepared.colorBlob),colorSec=(performance.now()-t)/1000;status.textContent=`Photo ${form.photos.length+1}: grayscale OCR...`;t=performance.now();const gray=await worker.recognize(prepared.grayBlob),graySec=(performance.now()-t)/1000;const photoText=mergeText(color.data.text,gray.data.text),confidence=Math.max(Number(color.data.confidence||0),Number(gray.data.confidence||0));form.photos.push({id:crypto.randomUUID(),thumbURL:prepared.thumbURL,text:photoText,confidence,colorSec,graySec});const all=mergeText(...form.photos.map(p=>p.text)),parsed=parse(all);form={...form,...parsed,photos:form.photos};fill();renderPhotoStrip();status.textContent=`Photo ${form.photos.length} analyzed (${confidence.toFixed(0)}%). Add another angle or verify fields. App v${APP_VERSION}`;progress.value=100;}
 catch(e){console.error(e);status.textContent=`OCR failed: ${e?.message||String(e)}`;}
}
function renderPhotoStrip(){const box=$("#containerPhotos");if(!box)return;box.innerHTML="";form.photos.forEach((p,i)=>{const card=document.createElement("div");card.className="photo-card";card.innerHTML=`<img src="${p.thumbURL}" alt="Bottle photo ${i+1}"><span>Photo ${i+1}<br>${p.confidence.toFixed(0)}%</span><button type="button" aria-label="Remove photo">×</button>`;card.querySelector("button").onclick=()=>removePhoto(p.id);box.append(card);});$("#photoCount").textContent=`${form.photos.length} photo${form.photos.length===1?"":"s"}`;}
function removePhoto(id){const p=form.photos.find(x=>x.id===id);if(p?.thumbURL)URL.revokeObjectURL(p.thumbURL);form.photos=form.photos.filter(x=>x.id!==id);const parsed=parse(mergeText(...form.photos.map(x=>x.text)));form={...form,...parsed,photos:form.photos};fill();renderPhotoStrip();}

function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify({session:$("#session").value,items}));}
function safe(v){const d=document.createElement("div");d.textContent=v;return d.innerHTML;}
function render(){$("#list").innerHTML="";items.forEach(item=>{const a=document.createElement("article");a.innerHTML=`<b>${safe(item.name||"Unnamed chemical")}</b><small>${safe(item.cas||"No CAS")}${item.article?` • ${safe(item.article)}`:""} • ${item.photoCount||1} photo(s)</small><button class="delete">×</button>`;a.querySelector("button").onclick=()=>{items=items.filter(x=>x.id!==item.id);save();render();};$("#list").append(a);});$("#count").textContent=`${items.length} containers`;$("#exports").classList.toggle("hidden",!items.length);}
function editor(show=true){$("#home").classList.toggle("hidden",show);$("#editor").classList.toggle("hidden",!show);}
function updateCASState(){const v=$('[data-field="cas"]').value,s=$("#casState");s.textContent=!v?"":casValid(v)?"✓ Valid CAS checksum":"⚠ Invalid CAS format/checksum";s.className=!v?"":casValid(v)?"ok":"warn";}
function fill(){$$('[data-field]').forEach(i=>i.value=form[i.dataset.field]||"");$("#raw").textContent=form.raw||"";$("#rawBox").classList.toggle("hidden",!form.raw);updateCASState();buildOCRButtons();}
function ensurePicker(){if($("#ocrPicker"))return;const p=document.createElement("div");p.id="ocrPicker";p.className="ocr-picker hidden";p.innerHTML=`<div class="ocr-picker-card"><div class="ocr-picker-head"><b>Select OCR text</b><button id="closeOCRPicker" type="button">×</button></div><button class="ocr-choice clear-choice" data-clear="1">Leave blank</button><div id="ocrChoices"></div></div>`;document.body.append(p);$("#closeOCRPicker").onclick=()=>p.classList.add("hidden");p.querySelector('[data-clear="1"]').onclick=()=>applyPickerValue("");}
function applyPickerValue(value){const input=$(`[data-field="${pickerField}"]`);if(input){input.value=value;if(pickerField==="cas")updateCASState();}$("#ocrPicker").classList.add("hidden");}
function openPicker(field){pickerField=field;const box=$("#ocrChoices");box.innerHTML="";[...new Set(form.ocrLines||[])].forEach(line=>{const v=normalizeForField(line,field),b=document.createElement("button");b.type="button";b.className="ocr-choice";b.innerHTML=`<span>${safe(line)}</span>${v!==line?`<small>Use: ${safe(v||"blank")}</small>`:""}`;b.onclick=()=>applyPickerValue(v);box.append(b);});$("#ocrPicker").classList.remove("hidden");}
function buildOCRButtons(){ensurePicker();$$('[data-field]').forEach(input=>{const label=input.closest("label");if(!label||label.querySelector(".ocr-open"))return;const b=document.createElement("button");b.type="button";b.className="ocr-open";b.textContent="▼ OCR";b.onclick=e=>{e.preventDefault();openPicker(input.dataset.field);};label.append(b);});}
function handleFile(e){const f=e.target.files?.[0];if(f)processPhoto(f);e.target.value="";}
function esc(v=""){const s=String(v);return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}
function csv(){const h=["Timestamp","Session","Name","CAS","ArticleNumber","Lot","Manufacturer","Amount"],session=$("#session").value,rows=items.map(x=>[x.timestamp,session,x.name,x.cas,x.article,x.lot,x.manufacturer,x.amount]);return "\uFEFF"+[h,...rows].map(r=>r.map(esc).join(",")).join("\r\n");}
function createCSVFile(){return new File([csv()],`chemical_inventory_${new Date().toISOString().slice(0,10)}.csv`,{type:"text/csv"});}
function downloadCSV(){const f=createCSVFile(),u=URL.createObjectURL(f),a=document.createElement("a");a.href=u;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}

$("#camera").onclick=()=>{startContainer();$("#photo").click();};
$("#chooseImage").onclick=()=>{startContainer();$("#gallery").click();};
$("#addPhotoCamera").onclick=()=>$("#photo").click();
$("#addPhotoGallery").onclick=()=>$("#gallery").click();
$("#photo").onchange=handleFile;$("#gallery").onchange=handleFile;
$("#manual").onclick=()=>startContainer();
$("#cancel").onclick=()=>{form.photos.forEach(p=>URL.revokeObjectURL(p.thumbURL));form=EMPTY();containerOpen=false;editor(false);};
$("#add").onclick=()=>{form={...form};$$('[data-field]').forEach(i=>form[i.dataset.field]=i.value.trim());if(!form.name&&!form.cas)return;items.push({...form,photoCount:form.photos.length,id:crypto.randomUUID(),timestamp:new Date().toISOString(),photos:undefined,ocrLines:undefined,raw:undefined});form.photos.forEach(p=>URL.revokeObjectURL(p.thumbURL));form=EMPTY();containerOpen=false;save();render();editor(false);};
$('[data-field="cas"]').oninput=updateCASState;$("#session").onchange=save;$("#download").onclick=downloadCSV;
$("#share").onclick=async()=>{const f=createCSVFile();try{if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[f]})))await navigator.share({title:$("#session").value,files:[f]});else downloadCSV();}catch(e){if(e.name!=="AbortError")downloadCSV();}};
try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");if(saved){items=saved.items||[];$("#session").value=saved.session||"Lab inventory";}}catch{}
render();ensurePicker();if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js");window.addEventListener("pagehide",()=>{if(ocrWorker)ocrWorker.terminate().catch(()=>{});});console.log(`Chemical Scanner v${APP_VERSION}`);
