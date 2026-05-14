// CPU が使用するデフォルト評価重み (学習結果から)
// テストモードでファイル選択により上書き可能
export const DEFAULT_CPU_WEIGHTS = {
  own4: 31.92456913610046,
  own3clean: 10.198224361056845,
  own3: 267.59343623461075,
  own2clean: 29.858398932625697,
  own2: 95.04866676937986,
  own1clean: -5.483095460226739,
  maxSame2: 31.95141946139982,
  maxSame3: 1.8783632337527292,
  maxSame4: 68.73746055663536,
  twoPair: -0.8985470865226709,
  straight: -6.672160888225829,
  oppMul: 74.10657297221042,
  declareMinHand: 88.77106727347602,
  // 訓練ファイル外のキーは DEFAULT_WEIGHTS の標準値
  threatBlock: 200,
  pairBuildBonus: 30,
  rankReserve: 3,
  oppRankAvoid: 4,
};
