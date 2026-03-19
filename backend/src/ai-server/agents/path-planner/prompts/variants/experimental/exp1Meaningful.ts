import { createExperimentalVariant } from '../../build'

export const exp1MeaningfulPromptVariant = createExperimentalVariant({
  label: 'exp1_meaningful',
  description: '僅要求 path 語意合理、有測試意義、容易理解與執行，不額外施加 coverage、長度、風險或組合最佳化策略。',
  strategyRules: [
    '生成的 path 只要求語意合理、可執行、對測試有意義；不要額外偏好 coverage 最大、路徑最長、風險最高、或跨最多功能的路徑。',
    'pathName 與 semanticGoal 必須清楚說明這條 path 在驗證什麼，讓人只看名稱就知道這條 path 的測試目的。',
    '若多條 path 都合理，優先保留最容易理解、最不依賴隱含前提、最像單一明確測試情境的版本。',
    '例子：若一條 path 是「登入後查看個人資料」，另一條是「登入後一路逛到多個頁面最後再看個人資料」，在本版本中應優先前者，因為它的測試意圖更單純、語意更集中。',
  ],
  goal: '建立最基礎的語意型 baseline，讓後續其他策略版本可以直接與它比較。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '例子：若某 diagram 內存在一條明確的「填寫表單 -> 送出成功」合法序列，只要語意完整，即可直接作為一條有效 path。',
  ],
})
