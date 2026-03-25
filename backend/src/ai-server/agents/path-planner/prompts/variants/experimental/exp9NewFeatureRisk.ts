import { createExperimentalVariant } from '../../build'

export const exp9NewFeatureRiskPromptVariant = createExperimentalVariant({
  label: 'exp9_new_feature_risk',
  description: 'Coverage 優先之上，同時加入新功能優先與風險優先，要求把配額優先花在新的高風險功能分支上。',
  strategyRules: [
    '每條 path 都必須至少包含一條 walked=false transition，並優先增加 walked=false coverage。',
    '若某功能主流程已存在歷史 path，下一輪應優先選擇能進入其他未覆蓋功能分支的 path。',
    '在多個新功能分支之間，優先選擇風險更高、狀態變化更大、或更可能暴露缺陷的那一支，而不是最平順的 happy path。',
    '只要仍有新的高風險分支未覆蓋，就不要先把配額拿去驗證新的低風險導覽流程。',
    '候選排序時，先看 coverage 增益，再看是否打開新功能分支，最後看該分支的風險密度與缺陷暴露機率。',
    '例子：若都能切到未覆蓋分支，則「退款失敗重試」或「權限不足拒絕」應優於單純的「進入新頁面後正常返回」。',
  ],
  goal: '比較當新功能探索與高風險優先結合時，是否能更快找到高價值缺陷熱區。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '當新增 coverage 相近時，優先選擇能探索新功能分支且風險更高的 path。',
  ],
})