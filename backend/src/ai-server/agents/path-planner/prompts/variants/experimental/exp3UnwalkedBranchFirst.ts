import { createExperimentalVariant } from '../../build'

export const exp3UnwalkedBranchFirstPromptVariant = createExperimentalVariant({
  label: 'exp3_unwalked_branch_first',
  description: '在版本 2 的基礎上，額外優先探索歷史主流程外的未覆蓋功能分支。',
  strategyRules: [
    '沿用版本 2：生成的 path 應盡量涵蓋尚未走過的 transition 與 state，且每條 path 都必須至少包含一條 walked=false 的 transition。',
    '若某功能已有一條歷史 path 涵蓋其主要前置流程，下一輪應優先選擇能探索其他未覆蓋功能分支的 path，而不是只在相同前置流程後面補一小段差異。',
    '例如已測過登入成功時，若註冊路徑可達且新增覆蓋更高，應優先於登入失敗路徑。',
    '比較候選 path 時，先看新增未覆蓋區域的廣度，再看與歷史主流程的重疊是否過高。',
  ],
  goal: '測量在 coverage 優先下，主動偏向新功能分支是否能比單純追未走過 transition 更快擴大探索面。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '若多條 path 新增 coverage 接近，優先保留主要前置流程重疊較低、能探索新功能分支者。',
  ],
})
