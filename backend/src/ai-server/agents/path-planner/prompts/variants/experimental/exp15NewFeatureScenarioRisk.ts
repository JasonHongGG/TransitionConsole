import { createExperimentalVariant } from '../../build'

export const exp15NewFeatureScenarioRiskPromptVariant = createExperimentalVariant({
  label: 'exp15_new_feature_scenario_risk',
  description: 'Coverage 優先之上，同時加入新功能、情境與風險優先，要求探索新的高風險真實使用者情境。',
  strategyRules: [
    'path 必須先滿足語意合理、可執行且具明確測試意圖。',
    '每條 path 都必須至少包含一條 walked=false transition，且應優先增加未走過 coverage。',
    '若某功能主流程已被歷史 path 涵蓋，應優先探索其他未覆蓋功能分支。',
    '在新功能分支之中，優先保留能形成完整使用者情境、且風險更高的版本，而不是只進入新頁面後立刻結束。',
    '候選排序時，優先序為：語意成立、未走過 coverage、探索新功能分支、形成完整情境、風險價值、最後才是降低重疊。',
    '若一條 path 能在新功能分支中觸發拒絕、失敗、回滾、資料改寫或權限邊界，而另一條只是同分支的平順 happy path，應優先前者。',
    '例子：比起單純首次進入管理功能頁，更應優先「首次進入管理分支 -> 嘗試異常操作 -> 觸發權限或狀態驗證 -> 確認結果」這種情境。',
  ],
  goal: '比較在新功能探索時，同時要求完整情境與高風險價值，是否能得到最值得優先執行的 path。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '每條 path 的第一個 edge 必須從 page_entry.meta.entryStateId 出發。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '當新增 coverage 相近時，優先選擇能探索新功能分支、形成更完整情境且風險更高的 path。',
  ],
})