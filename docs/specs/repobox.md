# RepoBox 規格書

2026-10-17

本文件是方向與共識，不是實作計畫。實作計畫另寫，以本文件為需求來源。

## 概述

在手機或電腦上滑到 GitHub 專案時，兩下以內收進自己的私人 GitHub repo；GitHub Actions 用自己的 Claude 訂閱跑 Claude Code，自動產生摘要、分類與架構圖。結果是純 Markdown 加 SVG，任何工具都能讀。

**問題：** Threads、X 上的 GitHub 專案「看過就滑掉」，事後找不回來；單篇貼文也看不出專案架構。

**定位：** 自己用得順是第一優先。開源後別人 fork 自用（自己架 Pages、自己建收藏 repo），開發者不提供共用網站，也不代管任何人的資料、金鑰或運算。

**目標：**

1. 手機分享或電腦按一下，2 秒內看到「已收」。
2. 每筆收藏自動產生摘要、分類、架構圖，並保留出處。
3. 產出不綁任何閱讀工具：GitHub 網頁、手機 GitHub App、Obsidian、VS Code 都能直接看。
4. 別人 fork 後照 README 完成設定，不需要開發者的任何伺服器。
5. AI 用使用者自己的訂閱，不需要 API 金鑰。v1 支援 Claude 訂閱；Codex 訂閱列為 Phase 2（見「AI 執行器」）。

**v1 不做：** 截圖辨識、離線佇列、瀏覽器擴充、iOS、Discord、代管版。

## 架構

```
收藏端（靜態網頁）              使用者的私人 repo                 GitHub Actions
 Android 分享 ─┐                                               ┌─ 1. 腳本：解析、查 metadata、去重
 書籤按鈕   ───┼─ GitHub API ─▶ inbox/<id>.json ──push 觸發──▶ ├─ 2. Claude Code：clone、讀程式碼、
 貼上連結   ───┘   (寫一個檔)                                  │      摘要分類、arch-blueprint 畫圖
                                library/*.md + *.svg ◀────────┴─ 3. 腳本：驗證、寫入、更新目錄、commit
                                README.md（自動目錄）、index.json
                                        │
                     GitHub 網頁 / GitHub App / Obsidian / VS Code 閱讀
```

| 元件 | 放哪裡 | 職責 |
|---|---|---|
| 收藏網頁 | 公開 repo `repobox` 的 GitHub Pages（各人用自己 fork 的那份） | Android 分享目標、貼上連結、書籤落地頁 |
| 分析 Action | 公開 repo `repobox` 的 reusable workflow（`.github/workflows/analyze.yml`）與 `action/` 腳本，跑在使用者的 Actions | 處理 inbox、寫回 library |
| 收藏 repo | 使用者的 GitHub（私人），從範本 repo 建立，內含約 20 行的 stub workflow，以 commit SHA 引用分析 Action | 資料本體 |
| arch-blueprint | 公開 repo `cholateio/arch-blueprint`，Action 釘 commit 後 `git fetch` 下來，設成唯讀 | 畫架構圖 |

開發者維護兩個公開 repo：`repobox`（網頁加 Action）和收藏庫範本 `repobox-library-template`（只有 stub、預設 `taxonomy.yml`、幾句 README）。token 只存在使用者自己網頁的瀏覽器本地。

曾考慮改用「預填 GitHub issue」完全不用 token，但每次收藏要多按一次 Submit；既然網頁是自己架的，選擇 token 版，換取一鍵收藏。

## 安裝

0. **（別人才需要）** fork `repobox`，在 Settings → Pages 開啟。
1. **建立收藏 repo：** 從公開範本 `cholateio/repobox-library-template` 按 Use this template 建私人 repo。範本只有 stub workflow（`uses:` 釘上游 `cholateio/repobox` 的 40 字元 commit SHA，不能是分支名）、預設 `taxonomy.yml` 和幾句說明的 `README.md`；README 與 `index.json` 由第一次 publish 覆寫／建立。想改分析流程的人 fork 後把 `uses:` 換成自己的 repo 和 SHA。
2. **連結 Claude 訂閱：** 本機執行 `claude setup-token`，把結果存成 repo secret `CLAUDE_CODE_OAUTH_TOKEN`。
   v1 只接訂閱 token；API key 等有人需要再接。
3. **連結裝置：** 產生一支 fine-grained token（只限這個 repo、Contents 和 Actions 讀寫；Actions 只給閱讀頁的「重新分析」用），在每台裝置的收藏網頁貼上一次。
   - Android：加到主畫面，之後就會出現在分享選單。
   - 電腦：把網頁上的「收藏」按鈕拖到書籤列（整個書籤列只會有這一個）。

閱讀不需要額外設定；想用 Obsidian 或 VS Code 就 clone 這個 repo。

## 收藏端

一個靜態網頁，同時是 Android 分享目標、電腦的貼上頁、書籤的落地頁，以及收藏的閱讀入口。不做分析。

- **Android 分享：** Web App Manifest 宣告 `share_target`（POST multipart，參數 `title`、`text`、`url`）。service worker 攔下 POST，把內容存成一次性交接資料，再導向 `#s=<id>`。很多 App 把網址放在 `text`，所以從三個欄位中抽出第一個 GitHub 網址。
- **書籤：** `javascript:` 書籤只在 `github.com` 上執行。它開新視窗到收藏網頁，把網址、referrer 的網域和本機專屬的隨機碼放在 `#` 片段（不會送到伺服器）。referrer 的網域用來推斷出處（例如來自 `t.co` 就記為 x）。
- **自動寫入的門檻：** 任何網站都能帶參數導到收藏網頁，所以只有能證明來源的請求才自動寫入，其他一律要按「確認收藏」：
  - 分享選單：交接資料存在，而且頁面是在已安裝的 App 視窗裡打開。跨站表單 POST 只會開在一般分頁。
  - 書籤：隨機碼正確。
- **網址解析：** 用 `URL` 解析，網域必須完全等於 `github.com` 或 `www.github.com`；只拆解白名單內的轉址服務（`l.threads.com` 等），其他網域 query 裡的 GitHub 網址一律不認。
- **貼上連結：** 任何瀏覽器都能用。從網頁版社群右鍵複製的連結可能是轉址包裝（例如 `l.threads.com/?u=...`），解析時要從 query 參數中解出 GitHub 網址。
- **送出：** 本地先解析出 `owner/repo` 並驗證是 GitHub repo 網址，再用 Contents API 寫一個 `inbox/<id>.json`。成功就顯示「已收：owner/repo」；失敗就顯示錯誤加一個重試鈕。沒有離線佇列。
- **設定：** repo 名稱與 token 存在瀏覽器本地；token 不進網址、不進 console。對外只連 `api.github.com`，不載入任何第三方腳本（任何外部 JS 都讀得到這個網頁的 localStorage）。
- **收藏頁版面：** 單欄、一個畫面：最上面只有「貼上 GitHub 連結」的輸入框，下方一行狀態（已收／待確認＋確認鈕／錯誤＋重試鈕），再下面是書庫清單。電腦書籤按鈕收在設定抽屜。配色維持藍色製圖紙與格線（2026-10-19 試過黑白版，使用者決定改回）。
- **書庫清單：** 讀收藏庫的 `index.json` 列出全部條目。電腦版左邊是分類索引（全部、各分類依筆數排序、分析中、失敗），右邊是卡片牆；手機版分類變成頂部可左右滑的按鈕列。卡片是純文字（首頁不放架構圖，縮小後看不清楚）：大字副標（`tagline`）、repo 名稱、最多三個從使用門檻拆出的小標籤（作業系統、免費／需付模型費／訂閱、不需安裝）。卡片與分類索引用實心底，格線只露在縫隙。`index.json` 讀不到時分成六種狀態顯示（空書庫、找不到收藏庫或無權限、token 失效、暫時連不到、目錄格式錯誤），任何情況下本機的分析中項目都照樣列出。點條目進閱讀頁。

### 閱讀頁 `read.html#<stem>`

- **入口：** 只從收藏頁的書庫清單進入，沒有自己的側邊欄；左上「← 收藏」回去選下一筆。`<stem>` 必須符合 `^[a-z0-9._-]+__[a-z0-9._-]+$` 才會拿去組 API 路徑。
- **資料：** 用同一份 token 經 Contents API（`Accept: application/vnd.github.raw+json`）讀 `library/<stem>.json` 與 `.svg`，不經任何伺服器。沒有 sidecar 但出現在 `index.json` 的舊條目顯示「舊格式」狀態；缺的欄位整段省略。
- **版面：** 電腦版（寬 ≥ 1000px）一個畫面看完、整頁不捲動：「← 收藏」在框外，上方一條細長標題列（repo＋副標／分類／授權／收藏日／GitHub；星數只是收藏當下的快照、語言用處不大，都不顯示），左邊架構圖，右邊 480px 欄放「這是什麼（最多 4 行，可展開）＋第一個例子」「使用門檻」規格表，以及「值得借鏡／技術摘要／技術棧」分頁；高度不夠時只有右欄自己捲動。手機照常往下捲，兩側留白 24px。
- **移除（2026-10-20）：** 標題列最後一格「移除」，確認後瀏覽器用同一份 token 經 Git Data API 送**一個** commit：刪 `library/<stem>.md|json|svg`、從 `index.json` 拿掉該筆、刪掉 README 裡連到它的那一行（README 下次 publish 時整份重產），然後回收藏頁。分支在中途被 publish 推進（ref 更新回 422）就從頭重做，最多 3 次。不動 `inbox/done/`；之後再收同一個 repo 會當成新的重新分析。不經 workflow，所以不用換 SHA。
- **重新分析（2026-10-28）：** 標題列「GitHub」和「移除」中間一格「重新分析」，確認後用同一份 token 呼叫 `POST /repos/<收藏庫>/actions/workflows/repobox.yml/dispatches`（`ref` = 預設分支，`inputs.url` = 這筆的 `url`），等於在 Actions 頁手動帶網址跑一次 `workflow_dispatch`。token 因此要多開 **Actions: Read and write**；沒開時 GitHub 回 403，按鈕提示去 token 設定加權限。送出後按鈕顯示「已送出」，不輪詢結果，跑完重新整理就是新版。不改 pipeline，所以不用換 SHA。
- **架構圖：** 打開時播放製圖動畫（分區 → 節點 → 連線沿資料流描繪 → 標籤）。點圖開燈箱，可縮放、拖曳，點節點看它和誰相連。
- **SVG 安全：** 內嵌前在瀏覽器再過一次與 `validate.py` 相同的元素／屬性白名單。沒通過就**不顯示**，只放提示與 GitHub 原檔連結；絕不把它放進 `blob:`、`data:`、`<img>`、`<object>` 等任何同源可開啟的網址（直接打開會變成獨立 SVG 文件並執行其中腳本）。
- **測試：** 純邏輯（`web/lib/*.mjs`）用 `node --test` 在 CI 跑；版面、信任檢查與錯誤狀態用 `web/tests/e2e/*.cjs`（Playwright）在本機跑。

## 資料格式

### 目錄

```
repobox-library/
├─ README.md                 Action 產生的目錄（最新在前、依分類分組）
├─ taxonomy.yml              分類清單，每個分類一句定義（可編輯）
├─ inbox/
│   ├─ <id>.json             待處理
│   ├─ done/<id>.json        已處理
│   └─ failed/<id>.json      失敗：{error, failed_at, capture, raw}；把 capture 存回 inbox/<id>.json 即重試
├─ index.json                Action 產生的機器可讀目錄（閱讀頁、搜尋的資料源）
├─ library/
│   ├─ owner__repo.md        一個 repo 一篇
│   └─ owner__repo.svg       架構圖
└─ .github/workflows/repobox.yml
```

`id` 格式為 `YYYYMMDD-HHMMSS-xxxx`，在收藏端產生。檔名用 API 回傳的正式 `full_name` 轉小寫，以 `__` 分隔；GitHub 帳號名不含 `_`，所以一定切得開。

### 收藏：`inbox/<id>.json`

```json
{ "v": 1, "url": "https://github.com/owner/repo", "captured_at": "2026-10-17T10:22:33+08:00",
  "source": "threads", "page_url": "", "note": "", "client": "pwa@0.1.0" }
```

只有 `v`、`url`、`captured_at` 必填。處理狀態看檔案在哪個資料夾，不寫回這個檔。

### 條目：`library/owner__repo.md` + `library/owner__repo.json`

GitHub 會把 frontmatter 全部畫成表格，所以 `.md` 的 frontmatter 只放人會看的欄位；完整紀錄（每次分享、分析紀錄、星數的時間點）放在同名的 `.json`，由 Action 讀寫。

```markdown
---
repo: Owner/Repo
repo_id: 123456
url: https://github.com/Owner/Repo
description: ...
language: TypeScript
stars: 294（2026-10-18）       收藏或最後一次分享當下的星數，不會自動更新
license: MIT
category: mcp-server
tags: [mcp, chatgpt]
stack: [TypeScript, Node.js]
收藏次數: 2
最後看到: 2026-10-18
---
<!-- repobox:auto:start -->
## 這是什麼          白話介紹（給人看，不用專有名詞）＋ 1–2 個「例如」使用情境
## 使用門檻          1–4 行：平台／需要準備／費用／限制；不用安裝的寫「不需安裝」。限制最多一行、只寫具體的（實驗中或停更、不可商用、硬體門檻、README 自承的缺點），沒有就不寫（2026-10-23）。不寫安裝步驟（會過期，裝的時候讓 AI 讀最新 README）
## 技術摘要          給開發者看的架構說明
## 值得借鏡
## 技術棧
## 架構圖
![architecture](owner__repo.svg)
<!-- repobox:auto:end -->
```

- 去重以 `repo_id` 為準，repo 改名或轉移也不會變成兩篇（沿用舊檔名，只更新 frontmatter 的 `repo`、`url`）。
- `.json` 內容：上面所有欄位加 `stars_at`、閱讀頁用的 `intro`、`examples`、`requirements`、`summary`、`highlights`、`sightings`（`{id, at, source, note}`，以 `id` 即收藏檔名為身分，重跑不會重複追加）、`analyzed_at`、`analysis`（model、turns、wall_s、rounds、deepwiki、diagram）。2026-10-18 以前的條目把這些放在 frontmatter，讀取時會合併，下次寫回時搬進 `.json`。
- Action 只改 frontmatter 與 auto 標記之間的內容；不再產生「我的筆記」區（2026-10-18 使用者決定拿掉），但 end 標記之後若有人手寫內容，仍逐 byte 保留。
- 來自模型或 GitHub metadata 的文字一律轉成純文字並跳脫 Markdown；裸網址與 email 包成 code span，不會變成可點的連結。
- 同一個 repo 再收一次：只追加一筆 `sightings` 並更新星數，不重畫圖。重新分析靠 `workflow_dispatch`（閱讀頁的「重新分析」按鈕也是觸發它）。
- 內文只用標準 Markdown，不用 `[[wikilink]]` 等 Obsidian 專屬語法。

## 分析管線

### 觸發

- `push` 到 `inbox/*.json`（不含 `done/`、`failed/`）。每次處理 inbox 裡**全部**待處理檔（處理完會搬走，所以重跑是冪等的，中途失敗也會由下一次補上）；一次最多 200 筆，其餘留給下一次。
- `workflow_dispatch`：帶 `url` = 只強制重新分析這一個 repo（不加 sighting、不動 inbox）；`url` 留空 = 手動清空 inbox。
- `concurrency` 讓同時只有一個執行；每個 job 都 checkout 分支最新狀態（不是觸發的 commit），排隊中的執行才看得到前一次的結果。Action 用 `GITHUB_TOKEN` 推回的 commit 不會再觸發 workflow。

### 步驟（每筆收藏各自捕捉錯誤，一筆失敗不影響其他筆）

1. **解析與查詢（腳本）：** 驗證收藏檔（`v`、網址、`captured_at`），呼叫 GitHub API 取得正式名稱、`repo_id`、metadata（自動跟隨改名轉址），只收公開 repo。以 `repo_id` 找既有條目；已經收過的（且不是強制重分析）只記 sighting，不跑 Claude。任何失敗都寫成 `failed` 狀態，交給寫回 job 搬到 `failed/`。
2. **分析（Claude Code，用訂閱）：**
   - 由腳本先對目標 repo 做淺層 clone。Claude 不發任何網路請求、不掛任何 MCP server。
   - 參考資料：clone 下來的程式碼與 README。（2026-10-19 拿掉 DeepWiki MCP：它是選用的，卻讓可能被 prompt injection 的 Claude 有一條對外送任意文字的通道。）
   - 輸出 `out/summary.json`：`tagline`（4–20 字白話副標，卡片的大字）、`intro`（30–300 字白話介紹）、`examples`（1–2 個使用情境、每個 10–120 字）、`requirements`（1–4 行使用門檻、每行 2–100 字）、`summary`（20–600 字、含中文）、`category`（taxonomy 之一）、`tags`（≤5，小寫）、`stack`（1–8 項）、`highlights`（2–3 句、每句 10–120 字、含中文）。限制寫在提示詞裡。
   - 輸出 `out/diagram.svg`：照 arch-blueprint 畫，提示詞要求跳過確認步、改為檢查每個節點都對應到實際路徑。
   - 修正迴圈：Claude 沒有 shell。summary 不合格 → 把驗證錯誤交回同一個對話（`--resume`）修一次；`check.py` 不過 → 把錯誤交回修，最多 2 輪。
3. **驗證與寫回（腳本，獨立 job）：**
   - 分析 job 先驗一次：`out/` 只能有那兩個檔；summary 過 schema；SVG 過 `check.py` 與元素／屬性白名單，不過就省略架構圖、其他照寫。
   - 寫回 job **不信任** artifact，全部重驗：id 格式、路徑必須在 `library/` 內、`status.repo_id == meta.id`、既有條目的 `repo_id` 必須相符、summary 與 SVG 再驗一次。任何一項不過 → 該筆降級為失敗，不影響同批其他筆。收藏內容一律從 repo 自己的 `inbox/<id>.json` 讀，不從 artifact 讀。
   - 同一批有多筆指向同一個 repo：以 `repo_id` 分組，挑有圖的分析結果，sighting 全部合併。
   - 寫入 `library/`、把收藏移到 `done/`／`failed/`、重產 `README.md` 與 `index.json`，整批一個 commit。push 遇到衝突就 rebase 後重試，最多 3 次。
   - 有任何一筆失敗，整個執行標成紅燈（GitHub 會寄通知），但其他筆照常寫入。

### 分析 job 的權限隔離

Claude 讀的是陌生 repo 的內容，要當成可能含有 prompt injection 的不可信資料：

- 分析與寫回分成兩個 job。分析 job 的 `GITHUB_TOKEN` 只有 `contents: read`，產出用 artifact 交給寫回 job，寫回 job 不跑 Claude，而且重驗所有 artifact（見步驟 3）。
- 私人 repo 的 stub 以 **40 字元 commit SHA** 引用 reusable workflow：它把寫入權與 Claude token 交給公開 repo 的程式碼，用分支名等於讓任何推上公開 main 的 commit 在私人 repo 裡執行。更新分析 Action = 推上 `repobox` main 後，到收藏 repo 手動改這個 SHA。
- 限制靠 CLI 參數強制，不靠提示詞：
  - Claude 在空的工作資料夾啟動，並使用 `--restricted`：不讀任何設定檔，檔案工具只能碰 `--add-dir` 列出的資料夾（目標 repo、arch-blueprint、`out/`）；另以 `--settings` 開 `blockReadsOutsideWorkingDirectories`，Read／Glob／Grep 再圍一次。
  - 啟動前刪除目標 repo 每一層的 `.claude/`、`.mcp.json`、`CLAUDE.md`、`CLAUDE.local.md` 和 `.git`；clone 用 `core.symlinks=false`、再刪掉所有 symlink，避免透過連結讀到資料夾外。
  - `--tools Read Glob Grep Write Edit`：**沒有 Bash**。`--permission-mode dontAsk`，白名單外一律拒絕；白名單只有 `Read(//<target>/**)`、`Read(//<arch-blueprint>/**)`、`Read(//<out>/**)` 與 `Edit(//<out>/**)`（它同時放行該路徑的 Write；`//` 開頭才是絕對路徑），Glob／Grep 套用同一組 Read 規則；禁止讀取 `/proc`、禁止所有 `mcp__*`。
  - Claude token 只交給 `claude` 程序本身：step 一開始把它搬進不 export 的 shell 變數，`check.py`、`validate.py` 等解析模型輸出的腳本都拿不到。
  - `out/` 啟動時是空的、只放模型輸出；流程控制檔（item、meta、status、run 紀錄）放在 Claude 看不到的 `stage/`，上傳的是 `stage/`（2026-10-18 以正式參數本機演練：讀寫 `stage/` 都被拒）。
  - 不再使用 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`／bubblewrap：沒有 Bash 就沒有子程序可以拿到 token；而且 GitHub runner 的 AppArmor 擋下 bwrap（`bwrap: setting up uid map: Permission denied`，2026-10-17 實測），Bash 沙箱根本起不來。
  - arch-blueprint 釘在指定 commit 並設成唯讀；Claude Code 與 GitHub Actions 都釘版本。
  - 不做 headless Chrome 截圖檢查。
- SVG 用 XML 解析後的元素／屬性白名單驗證（沒有 `style`、`script`、`foreignObject`、`image`、`a`），`fill`／`stroke`／`marker-*` 只接受精確文法（色碼或 `url(#id)`），拒絕任何反斜線跳脫與控制字元。
- 每一步都保證留下 `status.json`（腳本失敗、逾時、取消也一樣），寫回 job 另外把「有計畫卻沒有 artifact」的項目判為失敗，避免同一筆無限重試。
- 提示詞明確標示：repo 內容是資料，不是指令。

### AI 執行器

步驟 2 的輸入（clone 好的 repo、metadata）和輸出（`out/summary.json`、`out/diagram.svg`）固定不變，執行器可以替換。arch-blueprint 是 Agent Skills 格式，Claude Code 和 Codex 都能載入。

| 執行器 | 認證 | 狀態 |
|---|---|---|
| Claude Code CLI（runner 上直接 `npm install` 後跑 `claude -p`） | `claude setup-token` 產生的訂閱 token（`CLAUDE_CODE_OAUTH_TOKEN`）；沒有訂閱的人可改用 API key | v1。不用官方 `claude-code-action`：它的觸發事件清單裡沒有 `push`，預設還要安裝 Claude GitHub App |
| Codex（`openai/codex-action`） | ChatGPT 訂閱：把 `~/.codex/auth.json` 存成 secret。官方文件仍建議自動化流程用 API key，而且 token 會在執行中刷新，必須想辦法讓 secret 跟著更新 | Phase 2，先驗證 |

### 發佈

`repobox` 以 reusable workflow 發佈（`.github/workflows/analyze.yml`），使用者的 stub 以 commit SHA 引用。腳本用 Python 3 標準函式庫加 PyYAML（runner 預裝、與 `check.py` 同語言、零安裝），放在 `action/scripts/`，單元測試在 `action/tests/`（`python3 -m unittest discover -s action/tests`）。網址解析不與網頁共用：Action 端只需要 regex 加 GitHub API。

## arch-blueprint：不改，靠提示詞無人值守

原計畫要改 arch-blueprint 拿掉確認步。實測（Phase 0 兩次、Phase 1 多次）在提示詞裡交代「跳過確認、改為檢查節點都對應到實際路徑」就足夠，而且 arch-blueprint 平常也在本機互動使用，不值得為 CI 改變它的行為。決定不改。

## 已知限制

- **token 存放網域：** token 存在網頁的 localStorage。如果網頁架在 `<帳號>.github.io`，同帳號的其他 Pages 專案共用同一個 origin，都讀得到它。建議用自訂子網域隔開（本人部署用 `repobox.cholate.dev`）。
- **分享可能遺失：** 交接資料一讀就刪。送出成功前 App 被關掉或重新整理，這筆分享就會遺失。這是不做離線佇列的代價，屬刻意取捨。

## 成本

| 項目 | 誰的資源 | 備註 |
|---|---|---|
| 收藏 repo | 使用者 | 私人 repo 免費 |
| Actions | 使用者 | 私人 repo 免費方案每月 2000 分鐘。實測每筆新分析 3–9 分鐘（小 repo 約 2.5 分鐘、中型約 8 分鐘），重複收藏不到 1 分鐘 |
| Claude | 使用者的訂閱 | 與日常使用共用額度 |
| 收藏網頁 | 各自 fork 的 GitHub Pages | 免費 |

## 分階段計畫

### Phase 0：驗證假設

- [x] Android：Threads 內建瀏覽器的 `⋯` →「分享方式…」會叫出系統分享選單，帶的是完整、乾淨的 GitHub 網址（2026-10-17 實機確認）
- [x] Android：RepoBox PWA 安裝後會出現在這個分享選單裡，並收到同一個網址（2026-10-17 實機：網址放在 `text` 欄位，API 1.4 秒，從開啟到寫入 2.0 秒）
- [ ] ~~Android：X 內建瀏覽器同樣測一次~~ 結案時未測（2026-10-23）；X 的分享選單若不帶網址，改用貼上連結
- [x] Claude Code CLI 搭配 `CLAUDE_CODE_OAUTH_TOKEN` 在 runner 上跑得起來（2026-10-17：`workflow_dispatch` 與手機分享後的 `push` 自動觸發都通過；push 只分析新增的那一筆）
- [x] arch-blueprint 無人值守模式在 Actions 的 ubuntu runner 上產出通過 `check.py` 的 SVG（2026-10-17，SquirrelRay/LiveSummary：0 錯誤 0 警告）
- [x] 量測每筆分析花的 Actions 分鐘數與牆鐘時間（2026-10-17，一個小型 Python repo：Claude 409 秒、job 7 分 16 秒、21 turns，API 等價成本 US$1.72，由訂閱額度支付）
- [x] 從 GitHub Pages 用 fine-grained token 呼叫 Contents API，沒有 CORS 問題（2026-10-17 手機實測通過）
- [x] bubblewrap 在 GitHub runner 上能讓 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` 正常運作（2026-10-17；開了 scrub 後 CLI 會把 permission mode 強制改成 default，但在 `-p` 下非白名單工具一樣被拒，實測擋下一次 `find`/`cat`）
- [x] ~~GitHub 新增檔案頁面可以用網址參數預填檔名與內容~~ 不需要了：改用範本 repo（2026-10-19）

### Phase 1：MVP

- [x] 分析結果寫回 `library/`（條目、架構圖、README 目錄、`index.json`），收藏搬到 `done/`／`failed/`（2026-10-18）
- [x] 重複收藏只記 sighting，不跑 Claude
- [x] Claude 無 shell，`check.py` 與 summary 驗證由流程代跑、錯誤交回修正
- [x] 每次分析記錄用了哪些工具（`analysis.deepwiki`、`turns`、`rounds`）
- [x] 分析 Action 改成 reusable workflow，收藏 repo 只留 stub 並以 commit SHA 引用
- [x] 收藏網頁：設定、分享目標、貼上連結、書籤（Phase 0 完成）
- [x] README：自用安裝步驟、隱私說明（2026-10-19）

**驗收標準：**

| 指標 | 目標 | 實測（2026-10-18） |
|---|---|---|
| 分享或書籤到「已收」 | 2 秒內 | 2.0 秒（手機） |
| 收藏到 library 出現條目 | 10 分鐘內 | 小 repo 2.5 分鐘；中型 repo 約 8 分鐘 |
| 重複收藏 | 不跑 Claude | 分析 job 7–10 秒 |
| 開發者伺服器 | 零 | 零 |

### Phase 2 以後（候選，不排序）

專案已於 2026-10-23 結案，以下不再排入開發；留作 fork 的人擴充參考。

- **書庫清單的搜尋與分類篩選：** 收藏超過約 30 筆再做。
- **Codex 訂閱執行器：** 先驗證 `auth.json` 在 CI 裡刷新後的保存方式，見「AI 執行器」。
- **Discord 通知：** 處理完一筆就把摘要和架構圖發到頻道（webhook 存成 secret），成本極低。
- **Discord 收藏入口：** 用過一陣子確定需要再評估。偏向用 Cloudflare Worker 架 Discord 指令（即時、不吃 Actions 分鐘數）；不採用 Actions 定時讀頻道（不即時，而且吃分鐘數）。
- **QR code 配對：** 電腦網頁顯示 QR code，手機掃了就設定好，免在手機上貼 token。
- **截圖辨識：** 看圖找候選 repo，由 GitHub API 驗證，找不到就進待確認。
- **MCP server 或 CLI：** 讓 Claude Code 等 coding agent 查詢收藏庫。
- **最小瀏覽器擴充：** 工具列按鈕加右鍵選單，只有在書籤不夠用時才做。
- **iOS：** 捷徑或 Discord 入口。

## 已結案的問題（2026-10-23 結案時依現況定案）

- **正式名稱：** 維持 RepoBox（README、網域 `repobox.cholate.dev` 都已使用）。
- **一次分享多個網址：** 只收第一個有效的 GitHub repo 網址（`web/app.js` 的 `findGitHubRepo`）。
- **預設分類：** 採 `action/scripts/taxonomy.py` 的 `DEFAULT`；個人收藏庫可在 `taxonomy.yml` 自行增補。
- **重新分析：** 已決（2026-10-18）：再收不重跑，只記 sighting；要重跑就用 `workflow_dispatch` 指定網址。
