import { createExperimentalVariant } from '../../build'

export const exp8PortfolioBalancedPromptVariant = createExperimentalVariant({
  label: 'exp8_portfolio_balanced',
  description: '我認為最值得比較的平衡策略：把 maxPaths 視為投資組合，在完整旅程、未覆蓋分支與高風險路徑之間分配。',
  strategyRules: [
    'path 必須語意合理，且每條 path 都必須至少包含一條 walked=false transition。',
    '把 maxPaths 視為測試投資組合：優先用一部分 path 覆蓋核心完整旅程，再用一部分 path 探索未覆蓋功能分支，最後保留少量 path 攻擊高風險例外情境。',
    '單條 path 仍應盡量延伸並保持使用者流程合理，但不可讓所有 path 都長得很像；整體組合要有明顯分工與互補。',
    '排序時，先看整體組合新增的未覆蓋 coverage 與功能面向多樣性，再看單條 path 的長度與風險價值。',
    '若某條候選 path 與現有已選路徑高度重疊，除非它能補上不同風險或不同功能面向，否則應改選更互補的 path。',
  ],
  goal: '建立一個兼顧 coverage、完整旅程、分支探索與風險探索的平衡型最佳化策略，適合作為最終比較候選。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '同一次輸出的多條 path 應形成互補組合：至少同時覆蓋核心旅程、未覆蓋分支或高風險情境中的多個面向。',
  ],
})
