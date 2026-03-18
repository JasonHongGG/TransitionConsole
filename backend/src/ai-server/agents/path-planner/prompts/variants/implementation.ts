import { createProductionVariant } from '../build'

export const implementationPromptVariant = createProductionVariant({
  label: 'implementation',
  description: '目前正式實作版本，保留 page_entry 起點限制與既有覆蓋優先策略。',
  strategyRules: [
    '允許使用已走過(walked=true)的 transition，但整體策略必須以優先涵蓋 walked=false 的 state/transition，且讓每條 path 盡可能延伸以涵蓋更多 state/transition 為優先。',
    'walked=true 代表已在前次 batch 或既有執行中覆蓋過；本次規劃必須以覆蓋 walked=false 的 state/transition 為主，不可把已覆蓋路徑重複輸出。',
    '同一次輸出的多條 path，必須盡量降低彼此重疊；若兩條 path 的主要 edge 序列高度相同，僅保留較短且新增覆蓋較高者。',
    '規劃排序時，優先序為：先最大化單條 path 新增的 walked=false transition 覆蓋，再最大化單條 path 新增的 walked=false state 覆蓋，再最大化該 path 總共涵蓋的 state/transition 數量，接著才最小化歷史重疊與本輪彼此重疊。',
    '若某條 path 可以在維持語意合理與連通合法的前提下繼續延伸，並覆蓋更多 state/transition，則不得過早結束；應優先選擇較長、覆蓋較完整的版本。',
    '只有在 path 再延伸後不會增加有價值 coverage、會破壞語意一致性、或已無合法可連通 transition 時，才可結束該 path。',
    '若某功能已有一條歷史 path 涵蓋其主要前置流程，則下一輪應優先選擇能探索其他未覆蓋功能分支的 path，而不是只在相同前置流程後面補一小段差異；例如已測過登入成功時，若註冊路徑可達且新增覆蓋更高，應優先於登入失敗路徑。',
  ],
  goal: '在 maxPaths 限制內，盡量回傳滿額且語意合理的測試路徑；每條路徑都應有明確名稱(pathName)與測試意圖(semanticGoal)，並盡可能優先補足未走過區域，同時讓單條 path 涵蓋更多 state/transition。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應盡量輸出到 maxPaths；不要因為 path 較長或前綴重疊就主動少產生 path。',
    '每條 path 的第一個 edge 必須從 page_entry.meta.entryStateId 出發。',
    '每條 path 至少要包含 1 個 walked=false 的 transition；若確實不存在任何可達的 walked=false transition，才可回傳已覆蓋路徑，且需最短。',
    '若可行，優先讓每條 path 的第一個未走過 transition 彼此不同，以提升跨 batch 新增覆蓋。',
    '若存在多條都可行且都有新增覆蓋的 path，優先選擇新增 coverage 更多、且能再延伸涵蓋更多 state/transition 的 path；只有在新增 coverage 與總覆蓋量接近時，才比較歷史重疊。',
    '若某條 path 雖然需要先共用一段已測前綴，但能通往更大塊未覆蓋區域，應接受該前綴，不可因為想降低重疊而過早換成覆蓋較少的新分支。',
    '每條 path 生成時，都應先問自己：是否還能沿著合法且語意合理的 transition 再繼續，並覆蓋更多 state/transition；如果答案是可以，則不應停止。',
  ],
})
