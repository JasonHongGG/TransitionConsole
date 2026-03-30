import { createExperimentalVariant } from '../../build'

export const exp11LongPathRiskPromptVariant = createExperimentalVariant({
  label: 'exp11_long_path_risk',
  description: 'Coverage 優先之上，同時加入長 path 優先與風險優先，要求用較長流程穿越高風險狀態轉換與重要副作用。',
  strategyRules: [
    '每條 path 都必須至少包含一條 walked=false transition，並優先增加未覆蓋 coverage。',
    '只要某條高風險 path 還能在維持語意合理與連通合法的前提下繼續延伸，並增加 coverage，就不應過早結束。',
    '優先探索會經過提交、回滾、刪除、取消、退款、權限變化或其他狀態寫入的長路徑，而不是只測一個短短的失敗提示。',
    '候選排序時，先看 coverage 增益，再看風險價值，接著看是否能在高風險脈絡中形成更長、更有密度的有效路徑。',
    '若一條 path 很長但多數步驟都屬於低風險重複導覽，則不如稍短但高風險事件更密集的版本。',
    '例子：若可以從登入一路走到提交、失敗處理、重試與最終狀態確認，則它通常比單點驗證「失敗提示出現」更符合本版本目標。',
  ],
  goal: '比較長路徑與高風險優先結合時，是否能在單條 path 內更有效地累積有價值 coverage。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '每條 path 的第一個 edge 必須從 page_entry.meta.entryStateId 出發。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '當新增 coverage 相近時，優先選擇風險更高且總長度更長的 path。',
  ],
})