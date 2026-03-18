import { createExperimentalVariant } from '../../build'

export const exp6ComprehensivePromptVariant = createExperimentalVariant({
  label: 'exp6_comprehensive',
  description: '綜合版本 1 到 5 的考量，兼顧語意、未走過 coverage、分支探索、長路徑與完整旅程。',
  strategyRules: [
    'path 必須先滿足語意合理、可執行且具明確測試意圖。',
    '每條 path 都必須至少包含一條 walked=false transition，且應優先增加 walked=false transition 與 state 的覆蓋。',
    '若某功能主流程已被歷史 path 涵蓋，應優先探索其他未覆蓋功能分支，而不是只在同一前置流程後追加微小差異。',
    '若 path 能在維持語意與合法性的前提下延伸，應盡量延伸，提升單條 path 的總覆蓋量。',
    '在 coverage 與長度之外，path 也應盡可能貼近實際使用者會完成的完整任務旅程，並深入跨功能探索整個系統。',
    '候選排序時，優先序為：語意成立、每條 path 含有未走過 transition、增加未走過 coverage、探索新功能分支、形成更完整的使用者旅程、最後才是降低無意義重疊。',
  ],
  goal: '建立一個完整綜合型策略，作為實驗版本中的高水位基準，用來比較單一偏好策略是否真的有額外價值。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '若新增 coverage 相近，優先選擇更能跨功能深入探索、且更像完整使用者旅程的 path。',
  ],
})
