import { createExperimentalVariant } from '../../build'

export const exp14NewFeatureLongPathRiskPromptVariant = createExperimentalVariant({
  label: 'exp14_new_feature_long_path_risk',
  description: 'Coverage 優先之上，同時加入新功能、長 path 與風險優先，要求長距離打穿新的高風險功能分支。',
  strategyRules: [
    'path 必須先滿足語意合理、可執行且具明確測試意圖。',
    '每條 path 都必須至少包含一條 walked=false transition，且應優先增加 walked=false coverage。',
    '若某功能主流程已被歷史 path 涵蓋，應優先探索其他未覆蓋功能分支。',
    '在這些新功能分支中，優先挑選風險更高、狀態變化更大、或更可能暴露缺陷的那一支。',
    '若該高風險分支還能在維持語意與合法性的前提下繼續延伸，則應盡量延伸，讓單一路徑覆蓋更多高價值節點。',
    '候選排序時，優先序為：語意成立、未走過 coverage、探索新功能分支、風險價值、最後才是路徑長度。',
    '例子：若一條 path 能從新進入的退款分支一路走到失敗、補救、再確認，而另一條只能短暫進入新分支後返回，應優先前者。',
  ],
  goal: '比較在新功能探索中再拉高路徑長度與風險密度，是否能進一步提高單條 path 的缺陷偵測價值。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '當新增 coverage 相近時，優先選擇能打開新功能分支、風險更高且整體更長的 path。',
  ],
})