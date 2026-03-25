import { createExperimentalVariant } from '../../build'

export const exp8NewFeatureScenarioPromptVariant = createExperimentalVariant({
  label: 'exp8_new_feature_scenario',
  description: 'Coverage 優先之上，同時加入新功能優先與情境優先，要求用完整任務情境切入尚未覆蓋的新功能分支。',
  strategyRules: [
    '每條 path 都必須至少包含一條 walked=false transition，並優先補足未走過區域。',
    '若某功能主流程已存在歷史 path，下一輪應優先選擇能打開其他未覆蓋功能分支的 path。',
    '在選擇新功能分支時，優先保留能形成完整使用者情境的版本，而不是只在新頁面上做一兩步局部操作就結束。',
    '候選排序時，先看 coverage 增益，再看是否切入新功能分支，接著看該分支是否形成清楚、真實、可執行的任務情境。',
    '若一條 path 雖然進入新功能分支，但只停在入口頁，而另一條可一路完成該分支中的主要任務，應優先後者。',
    '例子：若都能進入未覆蓋的報名功能，則「活動列表 -> 活動詳情 -> 報名 -> 確認結果」應優於只到「活動詳情」就停止的版本。',
  ],
  goal: '比較當新功能探索與完整使用者情境同時優先時，是否能產生更有價值且更可執行的 path。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '當新增 coverage 相近時，優先選擇能探索新功能分支且更像完整使用者情境的 path。',
  ],
})