import { createExperimentalVariant } from '../../build'

export const exp12ScenarioRiskPromptVariant = createExperimentalVariant({
  label: 'exp12_scenario_risk',
  description: 'Coverage 優先之上，同時加入情境優先與風險優先，要求優先探索真實任務情境中的高風險分支與例外流程。',
  strategyRules: [
    '每條 path 都必須至少包含一條 walked=false transition，並優先補足未覆蓋 coverage。',
    'path 應盡可能貼近真實使用者情境，不要只回傳脫離任務脈絡的單點失敗驗證。',
    '在多條情境型候選中，優先選擇風險更高、狀態改變更大、或更可能暴露缺陷的情境。',
    '候選排序時，先看 coverage 增益，再看是否形成完整情境，最後看該情境中的風險價值與狀態變化密度。',
    '若一條 path 雖然像完整任務，但全程都是低風險 happy path，而另一條可在合理情境下觸發拒絕、失敗、回滾或資料改寫，應優先後者。',
    '例子：相較於單純「登入後成功報名」，「登入後報名失敗 -> 調整條件 -> 再次提交 -> 確認結果」更符合本版本目標。',
  ],
  goal: '比較完整使用者情境與高風險探索同時成立時，是否能得到更貼近真實世界的高價值 path。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '每條 path 的第一個 edge 必須從 page_entry.meta.entryStateId 出發。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '當新增 coverage 相近時，優先選擇更像完整使用者情境且風險更高的 path。',
  ],
})