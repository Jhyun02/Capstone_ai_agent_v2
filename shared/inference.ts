export type InferenceInputs = {
  recentUniqueQuestionCount: number;
  analyzableColumnCount: number;
  distinctUsedAnalyzableColumns: number;
  datasetRowCount: number;
};

export type InferenceStatus = {
  enabled: boolean;
  questionCount: number;
  minQuestions: number;
  usedColumnCount: number;
  requiredColumnCount: number;
  usedColumnRatio: number;
  requiredColumnRatio: number;
  analyzableColumnCount: number;
  datasetRowCount: number;
  blockedReasons: string[];
  notice: string;
  reliabilityWarning: string | null;
};

export function getAdaptiveMinQuestions(rowCount: number): number {
  if (rowCount <= 300) return 5;
  if (rowCount <= 1000) return 7;
  return 10;
}

export function getInferenceThreshold(
  analyzableColumnCount: number,
  rowCount: number,
): { ratio: number; minColumns: number } {
  let baseRatio: number;
  if (analyzableColumnCount <= 15) baseRatio = 0.3;
  else if (analyzableColumnCount <= 40) baseRatio = 0.2;
  else baseRatio = 0.15;

  let rawMin = Math.ceil(analyzableColumnCount * baseRatio);

  if (rowCount <= 300) rawMin = Math.max(rawMin - 2, 3);
  else if (rowCount <= 1000) rawMin = Math.max(rawMin - 1, 3);

  const minColumns = Math.max(3, Math.min(rawMin, 6));
  const ratio = analyzableColumnCount > 0 ? minColumns / analyzableColumnCount : 1;

  return { ratio, minColumns };
}

function getReliabilityWarning(rowCount: number): string | null {
  if (rowCount <= 300) return "표본 수가 작아 신뢰도가 낮습니다. 결과를 참고용으로 해석하세요.";
  if (rowCount <= 1000) return "표본 수가 충분하지 않아 결과 왜곡 가능성이 있습니다.";
  return null;
}

export function canEnableInference(inputs: InferenceInputs): InferenceStatus {
  const {
    recentUniqueQuestionCount,
    analyzableColumnCount,
    distinctUsedAnalyzableColumns,
    datasetRowCount,
  } = inputs;

  const minQuestions = getAdaptiveMinQuestions(datasetRowCount);
  const { ratio: requiredColumnRatio, minColumns: requiredColumnCount } =
    getInferenceThreshold(analyzableColumnCount, datasetRowCount);

  const usedColumnRatio =
    analyzableColumnCount > 0
      ? distinctUsedAnalyzableColumns / analyzableColumnCount
      : 0;

  const blockedReasons: string[] = [];

  if (recentUniqueQuestionCount < minQuestions) {
    blockedReasons.push(
      `최소 ${minQuestions}개 질문 필요 (현재 ${recentUniqueQuestionCount}개)`,
    );
  }
  if (analyzableColumnCount < 1) {
    blockedReasons.push("분석 가능한 수치형 컬럼이 없습니다.");
  }
  if (distinctUsedAnalyzableColumns < requiredColumnCount) {
    blockedReasons.push(
      `최소 ${requiredColumnCount}개 수치 컬럼 사용 필요 (현재 ${distinctUsedAnalyzableColumns}개)`,
    );
  }
  if (datasetRowCount < 1) {
    blockedReasons.push("데이터셋에 행이 없습니다.");
  }

  const enabled = blockedReasons.length === 0;

  const notice = enabled
    ? "인사이트를 생성할 수 있습니다."
    : blockedReasons.join(" / ");

  return {
    enabled,
    questionCount: recentUniqueQuestionCount,
    minQuestions,
    usedColumnCount: distinctUsedAnalyzableColumns,
    requiredColumnCount,
    usedColumnRatio,
    requiredColumnRatio,
    analyzableColumnCount,
    datasetRowCount,
    blockedReasons,
    notice,
    reliabilityWarning: getReliabilityWarning(datasetRowCount),
  };
}
