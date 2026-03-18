import { createExperimentalVariant } from '../../build'

export const exp4UnwalkedLongPathsPromptVariant = createExperimentalVariant({
  label: 'exp4_unwalked_long_paths',
  description: '在版本 2 的基礎上，要求 path 在維持意義的前提下盡可能延伸，以少量 path 取得更多 coverage。',
  strategyRules: [
    '沿用版本 2：生成的 path 應盡量涵蓋尚未走過的 transition 與 state，且每條 path 都必須至少包含一條 walked=false 的 transition。',
    '若某條 path 可以在維持語意合理與連通合法的前提下繼續延伸，並增加 coverage，則不得過早結束。',
    '評估候選 path 時，優先選擇能以較少 path 數量涵蓋更多 transition/state 的版本，也就是優先長而有意義的 path。',
    '只有在 path 再延伸後不再增加有價值 coverage、會破壞語意一致性、或已無合法可連通 transition 時，才可結束該 path。',
  ],
  goal: '測量傳統 transition-path coverage 思維下，偏好較長路徑是否能更有效率地提升整體覆蓋。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '當新增 coverage 相近時，優先選擇總長度更長、總覆蓋 state/transition 更多的 path。',
  ],
})
