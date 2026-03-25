import { createExperimentalVariant } from '../../build'

export const exp10LongPathScenarioPromptVariant = createExperimentalVariant({
  label: 'exp10_long_path_scenario',
  description: 'Coverage 優先之上，同時加入長 path 優先與情境優先，要求形成完整且深入的跨功能使用者情境。',
  strategyRules: [
    '每條 path 都必須至少包含一條 walked=false transition，並優先補足未走過 coverage。',
    '若某條 path 可以在維持語意合理與連通合法的前提下繼續延伸，且仍保有清楚的任務情境，則不得過早結束。',
    '優先保留既長、又像真實使用者情境的 path，而不是很長但沒有明確任務目的的路徑。',
    '候選排序時，先看 coverage 增益，再看是否形成完整情境，接著看在該情境下能否繼續延伸以增加總覆蓋。',
    '若一條 path 很長但後半段只是回到已覆蓋頁面繞圈，則不如稍短但更完整、情境更清晰的版本。',
    '例子：若「登入 -> 活動列表 -> 詳情 -> 報名 -> 我的活動確認」全段都合法且持續增加 coverage，便應優先保留這種完整長情境。',
  ],
  goal: '衡量較長流程與完整情境同時優先時，是否能帶來更高的產品價值與覆蓋效率。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '當新增 coverage 相近時，優先選擇更像完整使用者情境且總長度更長的 path。',
  ],
})