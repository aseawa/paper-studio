# Changelog / 版本紀錄

## 2.0.1 — 2026-11-12

### English

- Fix PDF pages failing to render in iPad browsers that do not yet provide newer JavaScript Map methods.
- Use matching compatible PDF.js renderer and worker builds, with a versioned worker URL to avoid an outdated cached worker.
- Add a regression check that renders a PDF when those Map methods are unavailable.
- Show returning users a dismissible notice about the iPad rendering update.

### 繁體中文

- 修正部分 iPad 瀏覽器未支援較新 JavaScript Map 方法時，PDF 頁面無法顯示的問題。
- 使用相容的 PDF.js 顯示程式及背景工作程式，並為工作程式網址加入版本資訊，避免使用舊快取。
- 新增回歸檢查，確保缺少這些 Map 方法時仍可顯示 PDF 頁面。
- 為有已儲存文件的使用者顯示可關閉的 iPad 修正通知。

## 2.0.0 — 2026-11-11

### English

- General PDF study workspace for exam papers, worksheets, textbooks and research papers.
- Default stopwatch with countdown and timing-off modes.
- Optional HKDSE presets with explicit examination-system and year metadata.
- Version-two editable backups and study reports, with legacy backup support and transactional database migration.
- Portable React and Vite build, English and Traditional Chinese documentation, and automated Windows/Linux checks.
- Public GitHub Pages deployment after successful checks.

### 繁體中文

- 擴展為適用於試卷、工作紙、教科書及研究論文的 PDF 學習工作台。
- 預設使用正向計時，另提供倒數計時及關閉計時模式。
- 可選 HKDSE 預設，明確記錄考試制度及年份資料。
- 第 2 版可編輯備份及學習報告，兼容舊備份並以交易方式升級資料庫。
- 可攜式 React 及 Vite 建置、英文與繁體中文文件，以及 Windows／Linux 自動檢查。
- 檢查通過後自動部署 GitHub Pages 公開示範。
