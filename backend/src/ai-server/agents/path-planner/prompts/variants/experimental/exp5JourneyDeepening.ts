import { createExperimentalVariant } from '../../build'

export const exp5JourneyDeepeningPromptVariant = createExperimentalVariant({
  label: 'exp5_journey_deepening',
  description: '在版本 2 與 4 的基礎上，強調完整使用者旅程與跨功能深入探索。',
  strategyRules: [
    '沿用版本 2 與版本 4：每條 path 都必須至少包含一條 walked=false transition，且在有意義的前提下盡可能延伸。',
    '生成的 path 應盡可能貼近真實使用者的完整操作流程，而不是只驗證單一局部功能。',
    '優先選擇可跨越多個頁面、多個功能節點、且在語意上像一條真實任務旅程的 path，例如登入後進入活動頁、查看活動詳情、完成報名、再到個人頁查看結果。',
    '長度不是唯一目標；path 必須同時具備使用者情境合理性、跨功能深度與驗證價值。',
  ],
  goal: '測量把 coverage 與完整使用者旅程綁在一起時，是否能得到更有產品價值、也更接近真實使用流程的 path。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '當新增 coverage 相近時，優先選擇更像完整使用者旅程、且跨越更多功能節點的 path。',
  ],
})
