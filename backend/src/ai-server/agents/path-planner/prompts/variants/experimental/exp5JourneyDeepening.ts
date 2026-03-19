import { createExperimentalVariant } from '../../build'

export const exp5JourneyDeepeningPromptVariant = createExperimentalVariant({
  label: 'exp5_journey_deepening',
  description: '要求每條 path 都包含尚未走過的 transition，並偏好形成完整、真實、跨功能的使用者旅程，而不是只驗證局部片段。',
  strategyRules: [
    '每條 path 都必須至少包含一條 walked=false transition，且在保持語意合理的前提下盡可能延伸成完整旅程。',
    '生成的 path 應盡可能貼近真實使用者的完整操作流程，而不是只驗證單一局部功能或只有一兩步的局部跳轉。',
    '優先選擇可跨越多個頁面、多個功能節點、且在語意上像一條真實任務旅程的 path。',
    '長度不是唯一目標；path 必須同時具備使用者情境合理性、跨功能深度與驗證價值。',
    '例子：比起單純「開啟活動頁 -> 查看詳情」，更應優先「登入 -> 進入活動頁 -> 查看活動詳情 -> 完成報名 -> 到個人頁確認報名結果」這種完整旅程。',
    '例子：若某條候選雖然很長，但只是一直在同一頁切 tab 或往返已覆蓋狀態，則不算真正的旅程深化，不應優先。',
  ],
  goal: '測量把 coverage 與完整使用者旅程綁在一起時，是否能得到更有產品價值、也更接近真實使用流程的 path。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '當新增 coverage 相近時，優先選擇更像完整使用者旅程、且跨越更多功能節點的 path。',
    '例子：若兩條 path 的新增 coverage 接近，但其中一條涵蓋「登入、搜尋、查看、提交、確認」五段任務，而另一條只涵蓋單一頁面操作，應優先前者。',
  ],
})
