# Contributing / 參與開發

## English

Use Node.js 24, run `npm ci`, and start the app with `npm run dev`. Open an issue describing the problem or proposed change, then submit a focused pull request with the behaviour and validation explained.

Before submitting a change, run `npm run check`, `npm test` and `npm run build`. Add regression coverage for changes to timing, stored records, backup compatibility or PDF coordinates. Review visible interface changes in a browser. Keep the English and Traditional Chinese READMEs aligned when behaviour changes.

Use original or redistributable sample documents. Keep personal study files, browser databases, credentials and generated build output outside commits. Include enough reproduction detail for another contributor to reproduce a problem without private documents.

## 繁體中文

使用 Node.js 24，執行 `npm ci` 安裝依賴，再以 `npm run dev` 啟動。可先建立 issue 說明問題或建議，然後提交範圍清晰的 pull request，描述行為及驗證方式。

提交前請執行 `npm run check`、`npm test` 及 `npm run build`。涉及計時、儲存紀錄、備份兼容或 PDF 座標的改動，請加入相應回歸測試。介面改動需在瀏覽器檢查，功能說明亦請同步更新英文及繁體中文 README。

測試文件應為原創或可再分發的資料。個人學習檔案、瀏覽器資料庫、憑證及建置產物應保存在提交範圍以外。回報問題時，請提供足夠重現步驟，讓其他開發者可以在無需私人文件的情況下確認問題。
