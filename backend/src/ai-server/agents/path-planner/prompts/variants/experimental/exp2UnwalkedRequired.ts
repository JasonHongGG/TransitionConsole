import { createExperimentalVariant } from '../../build'

export const exp2UnwalkedRequiredPromptVariant = createExperimentalVariant({
  label: 'exp2_unwalked_required',
  description: '要求每條 path 都必須至少含有一條尚未走過的 transition，並優先補足未走過區域。',
  strategyRules: [
    '生成的 path 應盡量涵蓋尚未走過的 transition 與 state，並以 walked=false 的 transition 為主要探索目標。',
    '每條 path 都必須至少包含一條 walked=false 的 transition，且不可為了語意漂亮而只回傳已覆蓋路徑。',
    '若存在多條候選 path，優先選擇新增 walked=false transition 較多者；若接近，再比較新增 walked=false state 較多者。',
  ],
  goal: '測量最直接的 coverage 導向策略，在不要求更長流程的前提下，能多有效率地補足未走過區域。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
  ],
})
