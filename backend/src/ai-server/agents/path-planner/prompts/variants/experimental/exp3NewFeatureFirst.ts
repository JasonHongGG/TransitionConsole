import { createExperimentalVariant } from '../../build'

export const exp3NewFeatureFirstPromptVariant = createExperimentalVariant({
  label: 'exp3_new_feature_first',
  description: 'Baseline 與 coverage 優先之上，再加入新功能優先，要求 path 在 coverage 接近時主動探索歷史主流程外的未覆蓋功能分支。',
  strategyRules: [
    '生成的 path 應盡量涵蓋尚未走過的 transition 與 state，且每條 path 都必須至少包含一條 walked=false 的 transition。',
    '若某功能已存在歷史 path 涵蓋其主要前置流程，下一輪應優先選擇能通往其他未覆蓋功能分支的 path，而不是只在同一主流程尾端補上一點小差異。',
    '比較候選 path 時，先看新增未覆蓋區域的廣度，再看是否能打開新的功能分支，最後才看與既有主流程的重疊是否過高。',
    '新功能優先的意思是擴大探索面，不是強迫切到完全無關的分支；分支仍需與目前 path 的語意前提一致。',
    '例子：若系統已有「登入成功 -> 首頁 -> 個人頁」的已規劃或已執行 path，而另一條候選可走向「登入成功 -> 活動列表 -> 報名頁」，則後者更符合本版本目標，因為它探索了新的功能分支。',
    '例子：若 path A 與 path B 都新增 2 個 walked=false transition，但 path A 只是把既有登入主流程多延伸一步，而 path B 進入尚未探索的註冊、報名、退款或權限管理分支，應優先 path B。',
  ],
  goal: '測量在 coverage 優先下，主動偏向新功能分支是否能比單純追未走過 transition 更快擴大探索面。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '本實驗版本不要求 path 從 page_entry 開始；第一條 edge 只需是合法且語意合理的起點。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '若多條 path 新增 coverage 接近，優先保留主要前置流程重疊較低、能探索新功能分支者。',
    '例子：當「登入失敗提示」與「進入新頁面功能分支」帶來的新增 coverage 類似時，應優先後者，因為它能更快拓寬功能探索面。',
  ],
})