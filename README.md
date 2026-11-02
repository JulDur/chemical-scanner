# Chemical Scanner
Static GitHub Pages build with locally packaged Tesseract.js 7, worker, WASM cores and English OCR model.


Chemical Scanner v2.0 bottle-label OCR update

Replace these files in the GitHub repository root:
1. app.js
2. sw.js

No index.html or styles.css change is needed if v1.9/v1.10 is already installed.

Changes:
- OCR resolution increased to max 1800 px for real bottle labels.
- Creates a color image plus an enhanced grayscale/contrast image locally.
- Tesseract page segmentation set to PSM 11 (sparse text).
- Runs two OCR passes and merges unique text lines.
- Shows confidence and timing for each pass.
- Warns when best OCR confidence is below 35%.
- Reuses one Tesseract worker for the full session.
- Keeps CAS safety, OCR dropdowns, CSV and local storage.
