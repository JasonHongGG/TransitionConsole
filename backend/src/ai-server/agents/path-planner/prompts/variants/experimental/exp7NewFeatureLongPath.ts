import { createExperimentalVariant } from '../../build'

export const exp7NewFeatureLongPathPromptVariant = createExperimentalVariant({
  label: 'exp7_new_feature_long_path',
  description: 'Coverage 優先之上，同時加入新功能優先與長 path 優先，要求以較長且仍有意義的流程打開新的功能分支。',
  strategyRules: [
    '每條 path 都必須至少包含一條 walked=false transition，並優先增加 walked=false transition 與 state 的覆蓋。',
    '當某功能主流程已被歷史 path 涵蓋時，應優先選擇能通往其他未覆蓋功能分支的 path，而不是只在原主流程尾端多延伸一步。',
    '若某條通往新功能分支的 path 還能在維持語意合理與連通合法的前提下繼續延伸，並增加 coverage，則不得過早結束。',
    '候選排序時，先看語意成立與 coverage 增益，再看是否打開新功能分支，接著看單一路徑能否持續延伸帶來更多有效 coverage。',
    '若某條 path 雖然很長，但後半段只是重複已知主流程，則不如較短但真正進入新功能分支的版本。',
    '例子：若一條 path 可從登入後進入全新報名分支，並一路延伸到確認頁，則它應優於只在已知首頁流程多逛兩步的長路徑。',
  ],
  goal: '比較「拓展新功能面」與「延長單一路徑」同時成立時，是否能更快提升覆蓋效率。',
  outputRules: [
    '若仍有可達的未覆蓋 state/transition，paths 應輸出到 maxPaths；只要 coverage 尚未達到 100%，就不應少於 maxPaths 條 path。',
    '每條 path 的第一個 edge 必須從 page_entry.meta.entryStateId 出發。',
    '每條 path 至少要包含 1 個 walked=false 的 transition。',
    '若完全不存在任何合法且可達的 walked=false transition，回傳 {"paths": []}。',
    '當新增 coverage 相近時，優先選擇能進入新功能分支且整體長度更長、總覆蓋更多的 path。',
  ],
})