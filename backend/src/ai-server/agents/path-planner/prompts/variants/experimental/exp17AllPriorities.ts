import { createExperimentalVariant } from '../../build'

export const exp17AllPrioritiesPromptVariant = createExperimentalVariant({
  label: 'exp17_all_priorities',
  description: '完整綜合版：Baseline 與 coverage 優先之上，同時加入新功能、長 path、情境與風險四種偏好，作為 experimental matrix 的最高水位版本。',
  strategyRules: [
    'path 必須先滿足語意合理、可執行且具明確測試意圖。',
    '每條 path 都必須至少包含一條 walked=false transition，且應優先增加 walked=false transition 與 state 的覆蓋。',
    '若某功能主流程已被歷史 path 涵蓋，應優先探索其他未覆蓋功能分支，而不是只在同一前置流程後追加微小差異。',
    '若 path 能在維持語意與合法性的前提下延伸，且延伸後仍能保持完整情境、增加 coverage 或穿越更高風險節點，應盡量延伸。',
    '在 coverage 與長度之外，path 應盡可能貼近實際使用者會完成的完整任務情境，並深入探索整個系統。',
    '若多條 path 都能打開新功能分支，優先保留那條同時具備更完整情境、更高風險價值、且整體更能擴大覆蓋的版本。',
    '候選排序時，優先序為：語意成立、每條 path 含有未走過 transition、增加未走過 coverage、探索新功能分支、形成完整情境、風險價值、最後才是延長單一路徑與降低無意義重疊。',
    '例子：若 path A 是「登入 -> 首頁 -> 個人頁」而 path B 是「登入 -> 活動列表 -> 活動詳情 -> 報名 -> 付款 -> 確認頁」，且 path B 同時包含新 coverage、新功能探索、完整情境與高風險提交節點，則應優先 path B。',
    '例子：若 path C 新增 coverage 很多但語意破碎、像是在多個無關頁面間跳來跳去，而 path D 的 coverage 略少但形成合理且完整的高風險任務流程，應優先 path D。',
  ],
  goal: '建立包含所有偏好的最高水位綜合策略，作為整個 experimental matrix 的最終比較基準。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '每條 path 的第一個 edge 必須從 page_entry.meta.entryStateId 出發。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '若新增 coverage 相近，優先選擇更能打開新功能分支、形成完整情境、包含更高風險節點且整體更深入的 path。',
    '多條 path 應形成互補組合：不要全部都壓在同一主流程，應同時兼顧新功能探索、情境完整性與高風險區域。',
  ],
})