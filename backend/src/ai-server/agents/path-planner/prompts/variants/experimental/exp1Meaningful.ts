import { createExperimentalVariant } from '../../build'

export const exp1MeaningfulPromptVariant = createExperimentalVariant({
  label: 'exp1_meaningful',
  description: '僅要求 path 語意合理、有測試意義，不額外施加 coverage 或長度策略。',
  strategyRules: [
    '生成的 path 只要求語意合理、可執行、對測試有意義；不要加入額外的 coverage、長度、去重疊、風險或完整流程偏好。',
    'pathName 與 semanticGoal 應清楚描述這條 path 為何有意義，以及它代表哪一種使用情境或驗證意圖。',
    '若存在多條都合理的 path，可自由選擇，但應優先保留最容易讓人理解與執行的版本。',
  ],
  goal: '建立最基礎的語意型 baseline，讓後續其他策略版本可以直接與它比較。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
  ],
})
