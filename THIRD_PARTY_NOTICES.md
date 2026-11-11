# Third-party notices / 第三方聲明

Paper Studio's original code is licensed under MIT. Dependencies and bundled resources retain their upstream licences. / Paper Studio 原創程式碼採用 MIT 授權，依賴套件及隨附資源保留上游授權。

| Component / 元件    | Licence / 授權 | Source / 來源                               |
| ------------------- | -------------- | ------------------------------------------- |
| React and React DOM | MIT            | https://github.com/facebook/react           |
| Vite                | MIT            | https://github.com/vitejs/vite              |
| TypeScript          | Apache-2.0     | https://github.com/microsoft/TypeScript     |
| PDF.js / pdfjs-dist | Apache-2.0     | https://github.com/mozilla/pdf.js           |
| pdf-lib             | MIT            | https://github.com/Hopding/pdf-lib          |
| Lucide              | ISC            | https://github.com/lucide-icons/lucide      |
| @napi-rs/canvas     | MIT            | https://github.com/Brooooooklyn/canvas      |
| fake-indexeddb      | Apache-2.0     | https://github.com/dumbmatter/fakeIndexedDB |
| Prettier            | MIT            | https://github.com/prettier/prettier        |

The asset-preparation script copies PDF.js's licence and the resources supplied in its CMap, font and WASM directories. Resource-specific copyright and licence files are distributed with those resources. Additional transitive dependencies are recorded in `package-lock.json` and retain the notices supplied in their packages.

資源準備程式會複製 PDF.js 授權，以及套件提供的 CMap、字型及 WASM 目錄。各資源隨附的版權及授權檔案亦會一併分發。其他間接依賴記錄於 `package-lock.json`，並保留套件提供的聲明。
