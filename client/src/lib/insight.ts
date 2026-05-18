import type { Message } from "@/hooks/use-chat";

export const INSIGHT_SYSTEM_PROMPT = `너는 데이터 분석가다.
아래 제공된 "사용자 질문들, 해당 질문에 대해 실행된 SQL, 그리고 그 결과 요약"만을 근거로 인사이트를 도출해야 한다.

반드시 다음 규칙을 지켜라:
1. 제공된 질문/SQL/결과에 등장하지 않은 컬럼이나 지표는 사용하지 말 것
2. 일반적인 상식이나 개인적인 추측은 배제하고, 숫자와 결과에 기반한 내용만 말할 것
3. 표본 수가 매우 작은 그룹(n < 10)에 대한 해석에는 반드시 "표본 수가 적어 신뢰도가 낮다"는 주의 문구를 포함할 것
4. 결측값이 많은 컬럼(null_ratio가 높음)이 있으면 결과 왜곡 가능성을 명확히 언급할 것
5. NULL 처리 방식(집계 시 제외/COALESCE 대체/IS NOT NULL 필터링)을 반드시 설명에 포함할 것
6. [결론 및 시사점]은 반드시 관찰된 수치에서 직접 도출된 액션만 작성할 것. 추측 기반 제언 금지.

응답은 반드시 [사용된 주요 컬럼] / [핵심 관찰] / [결론 및 시사점] / [주의 사항] 포맷을 따른다.`;

function isNumeric(value: unknown): boolean {
  if (value == null || value === "") return false;
  return !isNaN(Number(value));
}

export function summarizeQueryResult(data: any[]): string {
  if (!data || data.length === 0) return "결과 없음 (0행)";

  const rows = data;
  const cols = Object.keys(rows[0]);
  const lines: string[] = [`행 수: ${rows.length}`, `컬럼: ${cols.join(", ")}`];

  const numericCols: string[] = [];
  const categoricalCols: string[] = [];

  for (const col of cols) {
    const nonNull = rows.map((r) => r[col]).filter((v) => v != null && v !== "");
    const numCount = nonNull.filter(isNumeric).length;
    if (nonNull.length > 0 && numCount / nonNull.length >= 0.8) {
      numericCols.push(col);
    } else {
      categoricalCols.push(col);
    }
  }

  // 수치형 요약 (최대 5개)
  for (const col of numericCols.slice(0, 5)) {
    const vals = rows.map((r) => Number(r[col])).filter((v) => !isNaN(v));
    if (vals.length === 0) continue;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
    lines.push(`${col}(min=${min}, max=${max}, avg=${avg})`);
  }

  // 범주형 상위값 (최대 5개, 고유값 10개 초과 컬럼 제외)
  for (const col of categoricalCols.slice(0, 5)) {
    const freq: Record<string, number> = {};
    for (const r of rows) {
      const v = String(r[col] ?? "");
      freq[v] = (freq[v] || 0) + 1;
    }
    const unique = Object.keys(freq);
    if (unique.length > 10) continue;
    const top = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${k}(${v})`)
      .join(", ");
    lines.push(`${col}: ${top}`);
  }

  // 결측 요약
  const nullStats: { col: string; ratio: number }[] = [];
  for (const col of cols) {
    const nullCount = rows.filter((r) => r[col] == null || r[col] === "").length;
    const ratio = nullCount / rows.length;
    if (ratio > 0) nullStats.push({ col, ratio });
  }
  if (nullStats.length > 0) {
    const sorted = nullStats.sort((a, b) => b.ratio - a.ratio).slice(0, 5);
    lines.push(`결측: ${sorted.map((s) => `${s.col}(${(s.ratio * 100).toFixed(1)}%)`).join(", ")}`);
  }

  // 샘플 3행
  const sample = rows.slice(0, 3);
  lines.push(`샘플: ${JSON.stringify(sample)}`);

  return lines.join("\n");
}

export function summarizeNullHandlingFromSql(sql: string): string {
  const methods: string[] = [];
  const upper = sql.toUpperCase();

  if (/SUM\s*\(|AVG\s*\(|MIN\s*\(|MAX\s*\(/.test(upper)) {
    methods.push("집계 함수에서 NULL 자동 제외");
  }
  if (sql.includes("coalesce(") || sql.includes("COALESCE(")) {
    methods.push("COALESCE를 통한 NULL 대체");
  }
  if (/IS\s+NOT\s+NULL/i.test(sql)) {
    methods.push("WHERE ... IS NOT NULL 필터링");
  }

  return methods.length > 0 ? methods.join(", ") : "별도 NULL 처리 없음";
}

export function buildInsightUserPrompt(
  messages: Message[],
  usedAnalyzableColumnsList: string[],
  reliabilityWarning: string | null,
): string {
  const qaEntries = messages
    .filter((m) => m.role === "assistant" && m.sql?.trim())
    .slice(-15);

  const historyLines: string[] = [];

  qaEntries.forEach((assistantMsg, i) => {
    const idx = messages.indexOf(assistantMsg);
    const userMsg = messages
      .slice(0, idx)
      .reverse()
      .find((m) => m.role === "user");

    historyLines.push(`#${i + 1}`);
    historyLines.push(`질문: ${userMsg?.content || "(질문 없음)"}`);
    historyLines.push(`SQL: ${assistantMsg.sql}`);
    historyLines.push(`결과 요약:\n${summarizeQueryResult(assistantMsg.data || [])}`);
    historyLines.push(`NULL 처리 방식: ${summarizeNullHandlingFromSql(assistantMsg.sql || "")}`);
    historyLines.push("");
  });

  let prompt = `아래는 사용자가 지금까지 이 데이터셋에 대해 던진 질문들과,
각 질문에 대해 실행된 SQL, 그리고 그 결과 요약입니다.

[질문 및 결과 히스토리]
${historyLines.join("\n")}
[자주 사용된 주요 컬럼]
${usedAnalyzableColumnsList.map((c) => `- ${c}`).join("\n")}`;

  if (reliabilityWarning) {
    prompt += `\n\n[표본/신뢰도 경고]\n- ${reliabilityWarning}`;
  }

  prompt += `\n
위 정보만을 기반으로 다음을 수행해줘:

1. 자주 사용된 주요 컬럼/지표를 정리하고,
2. 데이터에서 일관되게 관찰되는 패턴 3~5가지를 도출하며,
3. 관찰된 패턴을 종합해 "그래서 어떻게 해야 하는가"에 대한 결론과 구체적 제언을 제시하고,
4. 데이터 해석 시 주의해야 할 한계점(표본 수, 편향, 결측 영향)을 정리해줘.
5. 결측이 많은 컬럼이 있다면 왜곡 가능성을 명확히 언급하고 NULL 처리 방식을 설명해줘.

출력 형식:
[사용된 주요 컬럼]
- ...

[핵심 관찰]
- ...

[결론 및 시사점]
- 관찰 근거를 명시하며 "따라서 ~해야 한다" 형태로 작성
- 수치 근거 없는 제언 금지

[주의 사항]
- ...

제약:
- 제공된 정보 밖의 내용을 추측하거나 새로운 지표/컬럼을 만들어내지 말 것
- 수치 또는 결과에 근거가 없는 문장은 포함하지 말 것
- [주의 사항]에는 경고/한계점만 작성할 것`;

  return prompt;
}

export function extractColumnsFromSql(sql: string): string[] {
  const columns: string[] = [];
  const pattern = /data->>'([^']+)'/g;
  let match;
  while ((match = pattern.exec(sql)) !== null) {
    if (!columns.includes(match[1])) columns.push(match[1]);
  }
  return columns;
}
