---
name: spec-hirarchy-to-json
description: 將產品 spec 與階層式 Mermaid transition 文件轉換成前端可用的階層式 transition graph JSON。當使用者更新 `StateTranstionDiagram/spec.md` 與 `StateTranstionDiagram/transition.md`，且需要單一 JSON 資料集來支援單圖渲染、統整圖分群、跨圖連結時使用。
---
 
# spec-hirarchy-to-json

本 skills 會輸出一份可供前端渲染的階層式 transition graph JSON，必須同時支援：
- 每張 diagram 個別渲染
- 全系統統整圖（由 consumer 彙整所有 diagrams 資料）
- 跨 diagram 的關聯連結（connectors）
- 提供足夠的語意與結構資訊，便於 agent 進行路徑規劃（不含 runtime overlay）

此 skills 為檔案驅動，必須讀取 workspace 內的兩份輸入檔。

## Inputs (required)

必須讀取下列檔案（不得以貼上文字取代）：

- `StateTranstionDiagram/spec.md`
- `StateTranstionDiagram/transition.md`

若任一檔案不存在，需回報缺失路徑並停止。

## spec.md 的用途（required）

`spec.md` 是 `transition.md` 的需求來源與上下文，用途是讓 agent 在轉換時能「更完整」地生成資料集，而不是另一份要被完整輸出/索引的資料模型。

具體來說，轉換時應使用 `spec.md` 來：
- 補足/推導 diagram 中缺漏但合理存在的 state / transition（例如：需求文字提到的流程步驟，但 `transition.md` 未畫全）。
- 統一命名與語意（例如：頁面/功能命名、角色命名、事件命名），避免同義不同名。
- 校驗一致性：若 `transition.md` 出現與需求矛盾之處，需在輸出中保留可追溯資訊（例如 `meta.source`），並以最保守方式處理（不臆造與需求衝突的轉移）。

輸出 JSON 中關於 `spec` 的規則：
- `spec.raw` 預設為 `null`（不要求輸出完整 spec 原文）。
- `spec.summary` 僅保留最小必要摘要（見「Spec extraction rules」），其餘 spec 內容僅作為轉換過程的推導依據。

## Execution (required)

agent 必須直接讀取並解析上述兩份檔案，自行組出 JSON 結構並寫出結果檔案，不可呼叫外部腳本或產生器。

輸出檔案路徑固定為：

`StateTranstionDiagram/<system>.json`。

## Response rules (required)

不得在回覆中輸出 JSON 內容，只能回報：
- 輸出檔案路徑
- diagram 數量
- state 總數（所有 diagrams 加總）
- transition 總數（所有 diagrams 加總）

## Parsing expectations (required)

`transition.md` 必須符合以下結構：
- 以 `##` 開頭的段落標題（標題文字可自由命名；可包含任何前綴，例如 `①`/`②`）
- 每一段落內含一個 Mermaid 區塊，且 Mermaid 內容必須包含 `stateDiagram-v2`
- Diagram 類型必須可被推導成兩類之一：`page | feature`（Entry 也是 `page`；見「Entry diagram」與「Diagram type inference」）
- **每個 Mermaid code block 的第一行（第一個非空白行）必須是 `%% role: ...`**：
  - `%% role: none`：此圖不屬於特定角色（例如 Entry / Page Base / 通用 Feature）
  - `%% role: <Role>`：此圖屬於特定角色（例如 Member/Admin）
  - 多角色共用允許 `|` 分隔：`%% role: Member|Admin`
  - `%% role:` 的 `<Role>` 必須出自 `spec.md` 所定義的角色清單（對應 `spec.summary.roles`），不得臆造新角色
- 若採用 Base + Delta（同頁不同角色差異），可額外標註：
  - Base 圖（共用 page diagram）：`%% base: <PageId>`（僅在「真的存在任何 delta 圖」時才應出現；否則可省略）
  - Delta 圖（角色差異 page diagram）：`%% extends: <PageId>`（role-specific 圖建議必填）
- `%% verify:` 行必須附著在其上一條或多條 transition；若該段尚未出現 transition，則附著在最近一次出現的 state
  - 這些驗證項目會寫入該 transition 的 `validations` 欄位，用於表示這條轉移後必須檢查的功能正確性

若解析結果沒有任何 diagram，或段落缺失 Mermaid 區塊，需提示使用者修正 Markdown 結構後再執行。

### Role / base / extends semantics (required)

本 skill 會把 Mermaid directive 轉成 JSON 中可用於渲染與路徑規劃的「可組合 diagram」資料結構。

#### `%% role:` → JSON `roles`（Diagram / Transition）

- `%% role:` 用來標註「此 diagram 所屬的角色視角」。
- **此處的 role 定義，將直接作為輸出 JSON 中 `Diagram.roles` 與 `Transition.roles` 的填寫依據**：
  - `%% role: none` → `Diagram.roles=[]`，且該 diagram 內所有 `Transition.roles=[]`
  - `%% role: Member` → `Diagram.roles=["member"]`，且該 diagram 內所有 `Transition.roles=["member"]`
  - `%% role: Member|Admin` → `Diagram.roles=["member","admin"]`，且 transitions 同樣繼承

角色來源規則（required）：
- 除 `none` 以外，`%% role:` 中出現的所有角色名稱 **必須** 能在 `spec.md` 中找到對應定義（輸出到 `spec.summary.roles` 的 label 集合）。
- 若 transition.md 出現 spec 未定義的角色，視為輸入格式錯誤，需在 Failure handling 中指出並請使用者修正後重跑。

Role id 正規化規則（必須可重現）：
- 將 `%% role:` 的值以 `|` 分割成多個 role label
- 去除空白後，將每個 role label 正規化為 `snake_case` 小寫 id（例如 `Admin`→`admin`、`Power User`→`power_user`）
- `none` 代表「無特定角色」，不得與其他角色混用（例如 `none|Member` 視為格式錯誤）

#### `%% base:` / `%% extends:` → JSON `variant`（Base + Delta 組合）

當同一個 Page 在不同角色下只有「局部差異」時，transition.md 會使用 Base + Delta 標註：
- Base diagram：`%% role: none`，可選 `%% base: <PageId>`
- Delta diagram：`%% role: <Role>`（或多角色），且應有 `%% extends: <PageId>`

**Base 與 Delta 不是父子層級（hierarchy）**，而是「需要合併閱讀」的組合關係：
- 若某角色存在 delta diagram，則「該角色的完整 page 行為」= `base diagram` + `delta diagram`
- Delta diagram 只描述差異，不應重複 base 已涵蓋的共同流程

因此輸出 JSON 需用 `Diagram.variant` 明確標示此組合關係（見下方 schema）。

## Frontend/agent requirements mapping (required)

輸出 JSON 必須滿足以下需求：
- 支援單張 diagram 的獨立渲染（diagram 內直接包含該圖的 states/transitions/connectors）
- 支援全系統統整圖（consumer 可自行彙整所有 diagrams 的 states/transitions/connectors）
- 透過 connectors 表示跨 diagram 關係（避免跨 diagram 的 state-to-state 線）
- 具備足夠的語意與索引資訊，讓 agent 以語意規劃測試路徑（但不包含 runtime overlay）

## Detailed output schema (required)

以下欄位必須依照定義完整填寫；僅允許在明確標示可為空的欄位使用空陣列、空物件或 null。

### Root

```json
{
  "system": "ActivityManagementPlatform",
  "version": "1.0",
  "generatedAt": "2026-02-05T00:00:00.000Z",
  "inputs": {
    "specPath": "StateTranstionDiagram/spec.md",
    "transitionPath": "StateTranstionDiagram/transition.md"
  },
  "spec": {
    "raw": null,
    "summary": {
      "productName": "Activity Management Platform",
      "goals": ["..."],
      "roles": [{"id": "member", "label": "Member"}]
    }
  },
  "diagrams": [],
  "hierarchy": {"roots": [], "childrenByDiagramId": {}},
  "meta": {}
}
```

Root fields:
- `system`: ASCII-safe 的系統識別碼，用於檔名與穩定 key。
- `version`: schema 版本字串，僅在破壞性變更時升版。
- `generatedAt`: 產生時間（ISO 8601 UTC）。
- `inputs.specPath`: spec 檔案相對路徑。
- `inputs.transitionPath`: transition 檔案相對路徑。
- `spec.raw`: 預設為 null，保留未來存完整 spec 原文的欄位。
- `spec.summary.productName`: 產品名稱，取自第一個 `#` 標題。
- `spec.summary.goals`: 產品目標清單，取自目標段落的 bullet。
- `spec.summary.roles`: 角色清單，每項包含 `id` 與 `label`。
- `diagrams`: diagram 物件陣列（見 Diagram section）。
- `hierarchy.roots`: 最上層 diagram ids（通常為 `page_entry`）。
- `hierarchy.childrenByDiagramId`: parent diagram id -> child diagram ids 的對應表。

### Important: Diagram categories (required)

輸出 JSON 中 **不再輸出 `global` 類型的 diagram**。

- `Diagram.level` 只允許：`page | feature`
- 原本 `transition.md` 中的「Global App」那張圖，改為輸出成 **Entry**（視為 `page` diagram），用於表達系統入口與跨圖導航（connector derivation 的來源）
- 因此整份資料集的 diagram 只會分成兩類：`page` 與 `feature`（Entry 也是 `page`）

### Diagram

```json
{
  "id": "page_login",
  "name": "Login Page",
  "level": "page",
  "parentDiagramId": "page_entry",
  "roles": [],
  "variant": {
    "kind": "standalone",
    "baseDiagramId": null,
    "deltaDiagramIdsByRole": {},
    "appliesToRoles": []
  },
  "source": {"type": "mermaid", "sectionTitle": "② Login Page", "order": 2},
  "groups": [],
  "states": [],
  "transitions": [],
  "connectors": [],
  "meta": {
    "pageName": "Login",
    "featureName": null,
    "entryStateId": "page.Login.Init"
  }
}
```

Diagram fields:
- `id`: 由段落類型與名稱推導出的穩定 diagram id。
- `name`: 顯示在 UI 的 diagram 名稱。
- `level`: diagram 層級，必須為 `page | feature`。
- `parentDiagramId`: 依照階層規則計算出的父 diagram id；Entry 的 parent 為 null。
- `roles`: 非角色圖為空陣列；角色圖則填入角色 id 清單。
- `variant`: Base + Delta 組合資訊（必填；見下節 `Diagram.variant`）。
- `source.type`: 固定為 `mermaid`。
- `source.sectionTitle`: `transition.md` 的段落標題，用於追溯來源。
- `source.order`: 段落出現順序（從 1 開始）。
- `groups`: diagram 內的群組保留欄位，預設空陣列。
- `states`: 屬於該 diagram 的 state 物件陣列。
- `transitions`: 屬於該 diagram 的 transition 物件陣列。
- `connectors`: 與該 diagram 有關的 connector 物件陣列（同時包含 outgoing/incoming），用於表示跨 diagram 關係。
- `meta.pageName`: page diagram 用來組 state id 的頁面名稱；其他層級為 null。
- `meta.featureName`: feature diagram 用來組 state id 的功能名稱；其他層級為 null。
- `meta.entryStateId`: 由 `[*] --> X` 決定的起始 state id；若無則為 null。

### Diagram.variant (required)

`variant` 用於描述「同一 Page 的 Base + Delta 組合」關係，讓 consumer 能在特定 role 下組合出完整行為。

```json
{
  "kind": "standalone",
  "baseDiagramId": null,
  "deltaDiagramIdsByRole": {},
  "appliesToRoles": []
}
```

`variant.kind`：
- `standalone`：一般 diagram（沒有 base/delta 組合語意）。Entry、沒有任何 role delta 的 page、以及所有 feature diagram，預設皆為 standalone。
- `base`：Page Base diagram（共用流程）。
- `delta`：Page Delta diagram（角色差異流程）。

`variant.baseDiagramId`：
- `standalone|base` → 必須為 `null`
- `delta` → 必須填寫其對應的 base diagram id（也就是 `%% extends: <PageId>` 對應到的 base page diagram id）

`variant.deltaDiagramIdsByRole`（僅 `base` 使用）：
- 物件：`roleId -> deltaDiagramId`
- 若某 role 需要額外 delta，必須在此提供對應 delta diagram id
- 若同一張 delta diagram 適用多角色（例如 `Member|Admin`），則 base 可對多個 roleId 指向同一個 deltaDiagramId

`variant.appliesToRoles`（僅 `delta` 使用）：
- 陣列：此 delta diagram 適用的角色 id 清單
- 必須與 `Diagram.roles` 一致（同一批 role id）

### State

```json
{
  "id": "page.Activity.member.ViewingDetail",
  "label": "ViewingDetail",
  "type": "normal",
  "groupId": null,
  "tags": ["page", "member"],
  "meta": {
    "diagramId": "page_activity_member",
    "synthetic": false,
    "source": {"scope": "root", "raw": "ViewingDetail"}
  }
}
```

State fields:
- `id`: 全域唯一的 state id（見 State rules）。
- `label`: Mermaid 中的 state 標籤原文。
- `type`: `start | end | normal`，依 `[*]` 判斷。
- `groupId`: 群組保留欄位，預設 null。
- `tags`: 至少包含 diagram 層級與角色（若有）。
- `meta.diagramId`: 所屬 diagram id。
- `meta.synthetic`: Mermaid 直接定義為 false；若為推導或補齊 state 才為 true。
- `meta.source.scope`: 一般為 `root`。
- `meta.source.raw`: Mermaid 原始 state 文字。

### Transition

```json
{
  "id": "t.page_activity_member.0002",
  "from": "page.Activity.member.ViewingDetail",
  "to": "page.Activity.member.Registered",
  "event": "register",
  "roles": ["member"],
  "validations": ["registration API returns 200 and count increments"],
  "intent": {
    "category": "action",
    "summary": "register"
  },
  "meta": {
    "diagramId": "page_activity_member",
    "source": {"raw": "ViewingDetail --> Registered: register"}
  }
}
```

Transition fields:
- `id`: 轉移 id，格式 `t.<diagramId>.<sequence>`。
- `from`: 起點 state id。
- `to`: 終點 state id。
- `event`: Mermaid `:` 後的事件文字，若無則為 null。
- `roles`: 角色圖填入角色 id；非角色圖為空陣列。
- `validations`: 所有附著在此 transition 的 `%% verify:` 文字清單，用於表示此轉移後必須驗證的功能正確性。
- `intent.category`: 有事件則為 `action`，否則為 `auto`。
- `intent.summary`: 事件摘要，預設為事件文字或 `auto`。
- `meta.diagramId`: 所屬 diagram id。
- `meta.source.raw`: Mermaid 原始 transition 行。

術語說明：
- `groupId`/`groups` 是「diagram 內部」的子群組（細分狀態集合），目前保留欄位、預設不使用。

### Connector (diagram.connectors)

```json
{
  "id": "c.page_entry.invokes.page_activity_list.s.page_Entry_Member.to.page_ActivityList_Init",
  "type": "invokes",
  "from": {"diagramId": "page_entry", "stateId": "page.Entry.Member"},
  "to": {"diagramId": "page_activity_list", "stateId": "page.ActivityList.Init"},
  "meta": {"reason": "member navigates to /activities"}
}
```

（diagram 階層關係的例子，僅表示 parent/child，不指定 state-to-state）：

```json
{
  "id": "c.page_entry.contains.page_activity_list",
  "type": "contains",
  "from": {"diagramId": "page_entry", "stateId": null},
  "to": {"diagramId": "page_activity_list", "stateId": null},
  "meta": {"reason": "derived from parentDiagramId"}
}
```

Connector fields:
- `id`: connector id，必須是穩定且可重現的字串。
- `type`: `contains`（父子）或 `invokes`（跨 diagram 的 state-to-state 連結）。
- `from.diagramId`: 起點 diagram id。
- `from.stateId`: 起點 state id；若此 connector 不表達 state-to-state（例如純 `contains`）可為 null。
- `to.diagramId`: 終點 diagram id。
- `to.stateId`: 終點 state id；若此 connector 不表達 state-to-state（例如純 `contains`）可為 null。
- `meta.reason`: 關聯原因描述。

Connector rules:
- `connectors` 用於跨 diagram 關聯：
  - `contains` 表示父子層級關係
  - `invokes` 表示「從某個 diagram 的某個 state 進入/觸發到另一個 diagram 的某個 state」
- node-level 連結（你提到的需求重點）：
  - 當確定是由某個 state 進到另一個 diagram 的某個 state 時，必須填 `from.stateId` 與 `to.stateId`。
  - 例如：`page_entry` 中的 `page.Entry.Member` 與 `page.Entry.Admin` 可以分別連到 `Activity List Page` 的 entry state（如 `page.ActivityList.Init`），因此 `page_entry.connectors` 可能包含兩條 `invokes` connector。
- diagram-level 關聯（只有階層、不含 state-to-state）時：
  - `contains` 的 `from.stateId` / `to.stateId` 一律為 null。
- Connector id 建議規則（不強制，但必須穩定可重現）：
  - diagram-level：`c.<fromDiagramId>.<type>.<toDiagramId>`
  - state-level：`c.<fromDiagramId>.<type>.<toDiagramId>.s.<fromStateIdNormalized>.to.<toStateIdNormalized>`（將 `.` 轉為 `_` 或其他 ASCII-safe 方式）
- 每個 diagram 的 `connectors` 建議包含所有與該 diagram 有關的 connector（incoming/outgoing 都包含），以便單張圖即可理解跨圖連結。

## Diagram rules

層級定義：
- `page`: 單一頁面的導航層級，可導航到其他頁面或功能。
- `feature`: 單一功能的導航層級，可導航到其他頁面或功能。

- `Diagram.level` 必須為 `page | feature` 之一。
- `roles` 於一般 page/feature diagram 預設為空陣列；角色/視角子圖必須列出角色 id。
- `parentDiagramId` 需符合階層規則（page_entry -> page/feature -> role-specific page）。

### Entry diagram (required)

`transition.md` 的 Global App 圖不再輸出為 `global` diagram，而是輸出為一張 `page` diagram：

- `id`: `page_entry`
- `name`: `Entry`
- `level`: `page`
- `parentDiagramId`: `null`
- `meta.pageName`: `Entry`

這張圖的用途是提供「使用者首次進站」的入口狀態機，以及作為跨圖 connectors 的主要來源。

以目前 transition.md 的語意，Entry diagram 的主節點為 `Boot`，之後會分流到 spec 定義的各種角色/視角節點（例如 `Member/Admin`）。


注意：Entry diagram 中若出現 `...Page` 結尾的 state（例如 `LoginPage`, `ActivityListPage`），這些 state **不應被 materialize 成 Entry diagram 的 states**；它們應被視為「外部 diagram reference」，用來推導 `invokes` connectors。

換句話說：Entry 圖只保留入口與角色/視角分流狀態（例如 `Boot/Member/Admin`）；所有 `XxxPage` 節點都必須「落在」對應的 `page_*` diagram（由各自章節定義其 states/transitions），Entry 只透過 `invokes` connector 連到該 page diagram 的 entry state。

## Hierarchy mapping (required)

章節標題可以是任何文字，但 diagram 最終只會落在兩類：Page / Feature（Entry 也是 Page）。

補充：若某個 Page 需要分多角色（例如 Member/Admin 或其他 spec 定義的角色）視角，它仍然屬於 `level=page`（只是 `Diagram.roles` 會不一樣），不會引入第三種類型。


### Diagram type inference

依段落資訊推導 diagram 層級（`Diagram.level`）與 id；推導順序如下（越上面優先級越高）：

1) Title heuristics（transition.md 的主要推導來源）
- 若段落標題包含 `Feature:`（不分大小寫）則視為 `feature`。
- 否則若段落標題包含 `Global App` 或 `Global`（不分大小寫）則視為 **Entry page**（`id=page_entry`）。
- 否則預設為 `page`。

2) Role/Base/Extends 補充規則（用於 page 變體識別，不改變 page/feature 分類）
- 若 Mermaid 內含 `%% extends: <PageId>` 且 `%% role: none` 以外，視為 role-specific page diagram（同一頁的角色差異圖）。
- 若 Mermaid 內含 `%% base: <PageId>`，視為 base page diagram（同一頁的共用圖）。

- Entry (former Global)
  - `level=page`
  - `id=page_entry`
  - `name=Entry`

- Page
  - `level=page`
  - `roles=[]`（若此章節是某角色視角的 page，則 roles 填該角色 id，見下一節）
  - `id=page_<pageId>`，其中 `<pageId>` 必須穩定可重現，建議推導規則如下：
    1. 取 `source.sectionTitle`（章節標題原文）。
    2. 移除編號前綴與裝飾符號（例如 `①`、`②`、`1.`、`( )` 之類）。
    3. 若結尾含 `Page`，可移除 `Page` 後再生成 id。
    4. 將剩餘文字做 ASCII-safe 正規化：轉小寫、非 `[a-z0-9]` 轉底線、連續底線壓縮、trim。
    5. 若結果為空，退回使用 `page_<order>`（order 為章節出現序）以確保可用。

- Role-specific Page（視角/角色子圖）
  - 標題可自由命名；建議使用 Base + Delta，並以 `%% role:` + `%% extends:` 明確標註。
  - `level=page`
  - `roles=[role_id]`
    - `Member` -> `member`
    - `Admin` -> `admin`
    - （可選）其他角色可使用 snake_case id
  - `id=page_<basePageId>_<roleId>`，其中 `<basePageId>` 優先取自 `%% extends: <PageId>` 的 `<PageId>`，再做 ASCII-safe 正規化。
    - 例如：`%% extends: ActivityListPage` + `%% role: Member` → `page_activity_listpage_member`（若你希望去掉 `Page` 字尾，可在正規化時移除）

- Feature
  - 標題可自由命名；建議在標題中包含 `Feature:` 以利推導
  - `level=feature`
  - `id=feature_<featureId>`（建議 snake_case）

### Parent relationship rules

- Entry 無 parent：`page_entry.parentDiagramId=null`
- 所有 Page diagram 的 parent 預設為 Entry：`page_*.parentDiagramId=page_entry`（不包含 `page_entry` 自己）
- Role-specific Page diagram 的 parent 必須為其 base page（去掉角色後的 page id）：
  - `page_activity_detail_member.parentDiagramId=page_activity_detail`
- Feature diagram 的 parent 預設為 Entry：`feature_*.parentDiagramId=page_entry`

（註：若未來要把 Feature 掛到某個特定 Page 底下，也可以，但必須在輸出中以 connectors 清楚表達觸發來源。）

## State rules

- State id 必須為全域唯一且可重現：
  - `page.Entry.<StateLabel>`
  - `page.<PageName>.<StateLabel>`
  - `page.<PageName>.<role>.<StateLabel>`
  - `feature.<FeatureName>.<StateLabel>`
- `type`：`[*] --> X` 則 X 為 `start`，`X --> [*]` 則 X 為 `end`，其餘為 `normal`。
- `tags` 必須包含 diagram 層級，若有角色則加上角色 id。

## Transition rules

- transition id 格式：`t.<diagramId>.<zeroPaddedSequence>`。
- `event` 為 `:` 後的標籤。
- `verify` 為所有 `%% verify:` 內容。
- `roles` 需繼承該 diagram 的角色設定。

## Cross-diagram rules

- `transitions` 必須保持在 diagram 內，不可跨 diagram；跨 diagram 關係只能用 `connectors`。

## Cross-diagram connector derivation (required)

新版文件中，跨頁面/跨功能的「對應點」以 **Navigation Action** 標記表示。為了讓 consumer 能畫出跨圖連線，輸出時必須盡可能補齊 state-to-state connectors。

Navigation Action 規則（對應新版 transition diagram 規範）：
- **跨 diagram 的頁面跳轉 trigger/action 一律使用 `navigate <route>`**
- `<route>` 必須是以 `/` 開頭的路由字串（例如 `/activities`、`/activities/:activityId`、`/admin/activities`）
- 禁止使用其他語法表達跨頁跳轉（例如 `go(/...)`、`goto`、`routeTo`、`redirect /...` 等）。
  - 轉換器仍可把它們當作一般事件字串保留在 `Transition.event`，但 **不得** 以它們推導跨圖 `invokes` connector（並建議將不符合規範的訊息寫入 `root.meta.warnings` 方便追查）。

- `contains` connectors
  - 只表達階層（parent/child），不表達 state-to-state
  - `from.stateId=null`、`to.stateId=null`

- `invokes` connectors（必須表達 state-to-state）
  - 當 Mermaid transition 明確代表「從 A 進入另一張圖 B」時，必須輸出一條 connector，且：
    - `from.diagramId` 為來源 diagram
    - `from.stateId` 為來源 state（action 發生所在 state；預設取該 transition 的 `from`）
    - `to.diagramId` 為目標 diagram
    - `to.stateId` 為目標 diagram 的 entry state（該圖的 `meta.entryStateId`）

建議推導規則（保守且可重現）：
- 若 transition 的 `event`（`:` 後）符合 `navigate <route>`，且能將 `<route>` 對應到某個 Page diagram，則建立 `invokes` connector。
  - **Route 對應建議做法（穩定且可重現）**：解析每個 Page diagram 標題下方的 `Route：` 行（例如 `Route：`/login``），建立 `route -> diagramId` 對照表（支援含參數的字串，例如 `/activities/:activityId`）。
- 若來源 diagram 為 `page_entry`，且 `to` state label 以 `...Page` 結尾（如 `LoginPage`, `ActivityListPage`），則：
  - `to` 僅用於輔助判斷目標（但 Entry diagram 的 states 仍 **不 materialize** 這些 `...Page` 狀態）
  - 優先以 `navigate <route>` 的 `<route>` 找目標 page；若缺少 route，才退回用 `to` label 去掉 `Page` 後，以章節標題做保守匹配。

最小必須支援的例子（對應你提出的需求）：
- `page.Entry.Member` / `page.Entry.Admin` -> 對應 Page diagram 的 entry state（例如 `page.ActivityList.Init`）

## Connector placement (required)

為了讓「每張圖都能獨立理解跨圖跳轉」，每條 connector 建議同時被放入：
- `from.diagramId` 的 `connectors`（outgoing）
- `to.diagramId` 的 `connectors`（incoming）

同一條 connector 的 `id` 必須保持一致（去重由 consumer 或產生器處理）。

## Spec extraction rules (required)

從 `spec.md` 萃取以下「最小必要摘要」（其餘 spec 內容只用於轉換推導，不需輸出到 JSON）：
- `productName`: 第一個 `#` 標題文字（需去除 `任務 Spec：` 等前綴）
- `goals`: 取自「產品目標」/「Product Goal」區塊的 bullet
- `roles`: 解析角色名稱並轉成 id（`member`、`admin` 或 snake_case）

若欄位缺失，輸出空陣列（不可省略欄位）。

## System id derivation (required)

產生兩個名稱：
- `spec.summary.productName`: 可含非 ASCII 的顯示名稱
- `system`: ASCII-safe 的系統 id，用於檔名

推導規則：
1) 取得第一個 `#` 標題作為 `productName`
2) `system` 優先採用靠近開頭的 ASCII 行；否則由 `productName` 萃取英數
3) 套用 TitleCase 並限制字元為 `[A-Za-z0-9._-]`，其餘替換為 `_`
4) 若結果為空則使用 `System`

## Runtime overlay semantics

不得在輸出 JSON 中包含 runtime overlay 或 coverage counters。
這些狀態由 consuming application 自行維護。

## Failure handling

若輸出缺少關鍵欄位，需指出 inputs 中對應的位置並請使用者修正後重跑。

