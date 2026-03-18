import { createExperimentalVariant } from '../../build'

export const exp7RiskFirstPromptVariant = createExperimentalVariant({
  label: 'exp7_risk_first',
  description: '風險導向策略，優先探索高風險與高狀態變化路徑，作為與完整旅程策略的對照組。',
  strategyRules: [
    'path 必須語意合理，且每條 path 都必須至少包含一條 walked=false transition。',
    '優先探索高風險區域：驗證失敗、權限切換、狀態寫入、交易或報名提交、不可逆操作、重要分支條件、以及會造成資料狀態改變的流程。',
    '若存在多條都能新增 coverage 的 path，優先選擇更可能暴露 bug 或規格歧義的 path，而不是最平順的 happy path。',
    '只要仍有高風險未覆蓋區域，不要把配額先花在低風險、重複性高的 path。',
  ],
  goal: '提供一個與完整旅程策略明顯不同的對照組，觀察風險導向是否能用較少 path 揪出更有價值的問題。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '若新增 coverage 相近，優先選擇風險更高、狀態變化更大、或更可能暴露缺陷的 path。',
  ],
})
