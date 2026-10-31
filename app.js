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

const K = "chem-v5";

let items = [];
let form = E();

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];


// ============================================================
// CAS VALIDATION
// ============================================================

function cv(cas) {

  const match = cas
    .trim()
    .match(/^(\d{2,7})-(\d{2})-(\d)$/);

  if (!match)
    return false;

  const digits = (
    match[1] +
    match[2]
  )
    .split("")
    .map(Number)
    .reverse();

  const sum = digits.reduce(
    (total, digit, index) =>
      total + digit * (index + 1),
    0
  );

  return (
    sum % 10 ===
    Number(match[3])
  );
}


// ============================================================
// CAS NORMALIZATION
// ============================================================

function normalizeCAS(value) {

  if (!value)
    return "";

  return value
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "")
    .trim();
}


// ============================================================
// RECONSTRUCT CAS FROM DIGITS
//
// CAS structure:
//
// [2-7 digits]-[2 digits]-[1 digit]
//
// Example:
//
// OCR: 1310-732
// digits: 1310732
//
// reconstruct:
// 1310 | 73 | 2
//
// -> 1310-73-2
// ============================================================

function reconstructCAS(value) {

  if (!value)
    return "";

  const digits =
    value.replace(/\D/g, "");

  if (
    digits.length < 5 ||
    digits.length > 10
  )
    return "";

  const checkDigit =
    digits.slice(-1);

  const middle =
    digits.slice(-3, -1);

  const first =
    digits.slice(0, -3
