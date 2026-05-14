// CPU が使用するデフォルト評価重み (学習結果から)
// テストモードでファイル選択により上書き可能
export const DEFAULT_CPU_WEIGHTS = {
  own4: 80.53978822342256,
  own3clean: -11.9845329597825,
  own3: 41.9730342608032,
  own2clean: -0.5262752310649352,
  own2: 2.783766884981009,
  own1clean: 0.07999649644518886,
  maxSame2: 2.0987245747315257,
  maxSame3: -211.55260932250644,
  maxSame4: 0.704035312246933,
  twoPair: 16.0091865139433,
  straight: -1.8360772567294037,
  oppMul: 3.070923985980001,
  declareMinHand: 1.6542344213684381,
  // 訓練ファイル外のキーは DEFAULT_WEIGHTS の標準値
  threatBlock: 0.2763422626915938,
  pairBuildBonus: 1.6569799222278905,
  rankReserve: 0.1363824478772158,
  oppRankAvoid: -2.8038746613773955,
};
