import { createExperimentalVariant } from '../../build'

export const exp6ComprehensivePromptVariant = createExperimentalVariant({
  label: 'exp6_comprehensive',
  description: '綜合語意合理、未走過 coverage、分支探索、長路徑與完整旅程等多種因素的全面型策略，作為高水位綜合基準。',
  strategyRules: [
    'path 必須先滿足語意合理、可執行且具明確測試意圖。',
    '每條 path 都必須至少包含一條 walked=false transition，且應優先增加 walked=false transition 與 state 的覆蓋。',
    '若某功能主流程已被歷史 path 涵蓋，應優先探索其他未覆蓋功能分支，而不是只在同一前置流程後追加微小差異。',
    '若 path 能在維持語意與合法性的前提下延伸，應盡量延伸，提升單條 path 的總覆蓋量。',
    '在 coverage 與長度之外，path 也應盡可能貼近實際使用者會完成的完整任務旅程，並深入跨功能探索整個系統。',
    '候選排序時，優先序為：語意成立、每條 path 含有未走過 transition、增加未走過 coverage、探索新功能分支、形成更完整的使用者旅程、最後才是降低無意義重疊。',
    '例子：若 path A 是「登入 -> 首頁 -> 個人頁」而 path B 是「登入 -> 活動列表 -> 活動詳情 -> 報名 -> 付款 -> 確認頁」，且 path B 同時包含新 coverage 與跨功能深度，則應優先 path B。',
    '例子：若 path C 新增 coverage 很多但語意破碎、像是在多個無關頁面間跳來跳去，而 path D 的 coverage 略少但形成合理且完整的任務流程，應優先 path D。',
  ],
  goal: '建立一個完整綜合型策略，作為實驗版本中的高水位基準，用來比較單一偏好策略是否真的有額外價值。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '若新增 coverage 相近，優先選擇更能跨功能深入探索、且更像完整使用者旅程的 path。',
    '例子：若兩條 path 都新增差不多的未走過 edge，應優先那條同時能涵蓋新功能分支、較長合法序列、且形成完整任務閉環的 path。',
  ],
})
