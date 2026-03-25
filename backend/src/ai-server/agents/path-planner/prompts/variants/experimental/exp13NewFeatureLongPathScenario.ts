import { createExperimentalVariant } from '../../build'

export const exp13NewFeatureLongPathScenarioPromptVariant = createExperimentalVariant({
  label: 'exp13_new_feature_long_path_scenario',
  description: 'Coverage 優先之上，同時加入新功能、長 path 與情境優先，要求深入且完整地探索新的功能情境。',
  strategyRules: [
    'path 必須先滿足語意合理、可執行且具明確測試意圖。',
    '每條 path 都必須至少包含一條 walked=false transition，且應優先增加 walked=false transition 與 state 的覆蓋。',
    '若某功能主流程已被歷史 path 涵蓋，應優先探索其他未覆蓋功能分支，而不是只在同一前置流程後追加微小差異。',
    '若 path 能在維持語意與合法性的前提下，沿著新的功能分支形成更完整的使用者情境，應盡量延伸。',
    '候選排序時，優先序為：語意成立、每條 path 含有未走過 transition、增加未走過 coverage、探索新功能分支、形成更完整情境、最後才是讓單一路徑更長。',
    '若兩條 path 都能進入新功能分支，應優先那條能走完整任務而不是只到入口頁的版本；若都能完成任務，再比較誰能合法延伸覆蓋更多。',
    '例子：若 path A 只是首次進入未覆蓋報名頁，而 path B 能從活動列表一路走到報名成功並在我的活動頁確認結果，則應優先 path B。',
  ],
  goal: '建立不含風險偏好的高水位綜合策略，用來比較新功能探索、長流程與完整情境的總合效果。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '若新增 coverage 相近，優先選擇能打開新功能分支、形成更完整情境，且整體延伸更深入的 path。',
  ],
})