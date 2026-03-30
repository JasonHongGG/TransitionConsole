import { createExperimentalVariant } from '../../build'

export const exp1BaselinePromptVariant = createExperimentalVariant({
  label: 'exp1_baseline',
  description: 'Baseline，只要求 path 語意合理、有測試意義、容易理解與執行，不額外施加 coverage、新功能、長路徑、情境或風險偏好。',
  strategyRules: [
    '生成的 path 只要求語意合理、可執行、對測試有意義；不要額外偏好 coverage 最大、路徑最長、風險最高、或跨最多功能的路徑。',
    'pathName 與 semanticGoal 必須清楚說明這條 path 在驗證什麼，讓人只看名稱就知道這條 path 的測試目的。',
    '若多條 path 都合理，優先保留最容易理解、最不依賴隱含前提、最像單一明確測試情境的版本。',
    '不要為了看起來更完整就把多個弱相關流程硬接在一起；只要測試意圖開始分散，就應選擇更聚焦的版本。',
    '例子：若一條 path 是「登入後查看個人資料」，另一條是「登入後一路逛到多個頁面最後再看個人資料」，在本版本中應優先前者，因為它的測試意圖更單純、語意更集中。',
  ],
  goal: '建立最基礎的語意型 baseline，讓後續其他策略版本都能直接與它比較。',
  outputRules: [
    '若仍有合法且有測試價值的候選 path，paths 應盡量輸出到 maxPaths；不要過早停止在少量 path。',
    '每條 path 的第一個 edge 必須從 page_entry.meta.entryStateId 出發。',
    '即使本版本不強調 coverage，也不得輸出明顯重複、只是名稱不同但 edgeIds 幾乎相同的 path。',
    '例子：若某 diagram 內存在一條明確的「填寫表單 -> 送出成功」合法序列，只要語意完整，即可直接作為一條有效 path。',
  ],
})