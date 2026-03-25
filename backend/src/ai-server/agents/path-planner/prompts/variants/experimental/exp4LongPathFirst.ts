import { createExperimentalVariant } from '../../build'

export const exp4LongPathFirstPromptVariant = createExperimentalVariant({
  label: 'exp4_long_path_first',
  description: 'Baseline 與 coverage 優先之上，再加入長 path 優先，要求在維持語意合理與連通合法的前提下盡可能延伸路徑，以少量 path 取得更多 coverage。',
  strategyRules: [
    '生成的 path 應盡量涵蓋尚未走過的 transition 與 state，且每條 path 都必須至少包含一條 walked=false 的 transition。',
    '若某條 path 可以在維持語意合理與連通合法的前提下繼續延伸，並增加 coverage，則不得過早結束。',
    '評估候選 path 時，優先選擇能以較少 path 數量涵蓋更多 transition 與 state 的版本，也就是優先長而有意義的 path。',
    '只有在 path 再延伸後不再增加有價值 coverage、會破壞語意一致性、或已無合法可連通 transition 時，才可結束該 path。',
    '長 path 優先不代表無限延伸；若後半段只是在已覆蓋區域繞圈或靠弱語意連接，應及時停止。',
    '例子：若「登入 -> 首頁 -> 活動列表 -> 活動詳情 -> 報名表單 -> 報名成功」整段都是合法且持續新增 coverage，就不應只在「活動詳情」就結束。',
    '例子：若延伸下一步只會回到已覆蓋頁面繞圈、或需要不合理地跳到無關功能，則應停止延伸，保留目前已形成的完整長路徑。',
  ],
  goal: '測量傳統 transition-path coverage 思維下，偏好較長路徑是否能更有效率地提升整體覆蓋。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '當新增 coverage 相近時，優先選擇總長度更長、總覆蓋 state/transition 更多的 path。',
    '例子：若 path A 與 path B 都新增 3 個 walked=false transition，但 path A 還多經過 2 個新的 state 且整體流程仍合理，應優先 path A。',
  ],
})