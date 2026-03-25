import { createExperimentalVariant } from '../../build'

export const exp2CoverageFirstPromptVariant = createExperimentalVariant({
  label: 'exp2_coverage_first',
  description: 'Baseline 加上 coverage 優先，要求每條 path 都必須至少含有一條尚未走過的 transition，並把補足未走過 coverage 視為主要選徑原則。',
  strategyRules: [
    '生成的 path 應盡量涵蓋尚未走過的 transition 與 state，並明確把 walked=false 的 transition 視為主要探索目標。',
    '每條 path 都必須至少包含一條 walked=false 的 transition；若某條 path 完全由 walked=true transition 組成，即使語意再漂亮，也不可輸出。',
    '若存在多條候選 path，優先選擇新增 walked=false transition 較多者；若接近，再比較新增 walked=false state 較多者；若仍接近，再選擇較容易執行與理解者。',
    'coverage 優先不代表可以犧牲語意；只有在多條 path 都語意成立時，才用新增 coverage 多寡決定優先序。',
    '例子：若 path A 包含 3 個 walked=false transition，而 path B 只包含 1 個 walked=false transition，且兩者都合法，應優先 path A。',
    '例子：若 path C 與 path D 都各包含 2 個 walked=false transition，但 path C 會再經過 3 個新的 state，而 path D 只會經過 1 個新的 state，應優先 path C。',
  ],
  goal: '測量最直接的 coverage 導向策略，在不要求更長流程或更豐富情境的前提下，能多有效率地補足未走過區域。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '例子：若目前唯一尚未走過的 edge 是「checkout.submit -> checkout.success」，則輸出的每條 path 都至少要包含那條 edge 或其他 walked=false edge；不可只回傳登入、登出這類已覆蓋流程。',
  ],
})