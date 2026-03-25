import { createExperimentalVariant } from '../../build'

export const exp16LongPathScenarioRiskPromptVariant = createExperimentalVariant({
  label: 'exp16_long_path_scenario_risk',
  description: 'Coverage 優先之上，同時加入長 path、情境與風險優先，要求以完整且深入的高風險情境形成高密度測試路徑。',
  strategyRules: [
    'path 必須先滿足語意合理、可執行且具明確測試意圖。',
    '每條 path 都必須至少包含一條 walked=false transition，且應優先增加未走過 coverage。',
    '若 path 能在維持語意與合法性的前提下，沿著同一個使用者情境繼續延伸，並持續經過高風險狀態轉換，則應盡量延伸。',
    '優先保留既像完整使用者情境、又能跨越更多高風險節點的長路徑，而不是很多零碎的短風險片段。',
    '候選排序時，優先序為：語意成立、未走過 coverage、形成完整情境、風險價值、最後才是路徑長度；但若前三者相近，應優先更長者。',
    '若一條 path 很長但後半段風險密度很低，則不如稍短但高風險狀態轉換更集中的版本。',
    '例子：若可從登入一路走到提交、失敗、補救、重試與最終確認，並全程維持同一任務情境，則這類路徑最符合本版本目標。',
  ],
  goal: '比較長流程、完整情境與高風險探索結合時，是否能形成更高密度的高價值測試路徑。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '當新增 coverage 相近時，優先選擇更像完整情境、風險更高且總長度更長的 path。',
  ],
})