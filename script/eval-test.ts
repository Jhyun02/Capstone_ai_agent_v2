/**
 * 파이프라인 평가 테스트 스크립트
 * 사용법: PIPELINE_MODE=legacy|enhanced npx tsx script/eval-test.ts
 */

const BASE_URL = "http://localhost:3000";

interface TestCase {
  id: number;
  question: string;
  datasetId: number;
  category: "easy" | "medium" | "hard" | "error_prone";
  description: string;
}

// 건강검진 데이터 (ID: 2) 기반 테스트 질문
const testCases: TestCase[] = [
  // === Easy: 단순 집계 ===
  {
    id: 1,
    question: "전체 건강검진 데이터 수는 몇 건인가요?",
    datasetId: 2,
    category: "easy",
    description: "단순 COUNT",
  },
  {
    id: 2,
    question: "성별코드별 인원수를 알려주세요",
    datasetId: 2,
    category: "easy",
    description: "GROUP BY 단순 집계",
  },
  {
    id: 3,
    question: "평균 신장은 얼마인가요?",
    datasetId: 2,
    category: "easy",
    description: "단순 AVG",
  },

  // === Medium: 조건부 집계, 다중 컬럼 ===
  {
    id: 4,
    question: "연령대코드별 평균 체중을 알려주세요",
    datasetId: 2,
    category: "medium",
    description: "GROUP BY + AVG + CAST",
  },
  {
    id: 5,
    question: "수축기혈압이 140 이상인 사람은 몇 명인가요?",
    datasetId: 2,
    category: "medium",
    description: "WHERE 조건 + CAST 필요",
  },
  {
    id: 6,
    question: "흡연상태별 평균 총콜레스테롤 수치를 보여주세요",
    datasetId: 2,
    category: "medium",
    description: "GROUP BY + AVG + CAST 다중",
  },
  {
    id: 7,
    question: "시도코드별 평균 BMI를 계산해주세요. BMI는 체중/(신장*신장)*10000 입니다",
    datasetId: 2,
    category: "medium",
    description: "복합 수식 + CAST",
  },

  // === Hard: 복잡한 조건, 서브쿼리 ===
  {
    id: 8,
    question: "성별코드가 1인 사람과 2인 사람의 평균 혈색소 차이를 알려주세요",
    datasetId: 2,
    category: "hard",
    description: "조건부 집계 비교",
  },
  {
    id: 9,
    question: "연령대코드별로 수축기혈압 140이상인 비율을 구해주세요",
    datasetId: 2,
    category: "hard",
    description: "조건부 비율 계산",
  },
  {
    id: 10,
    question: "총콜레스테롤이 200 이상이면서 HDL콜레스테롤이 40 미만인 사람의 수와 비율은?",
    datasetId: 2,
    category: "hard",
    description: "복합 WHERE + 비율 계산",
  },

  // === Error-prone: 오류 유발 가능성 높은 질문 ===
  {
    id: 11,
    question: "혈압이 높은 사람들의 평균 나이를 알려주세요",
    datasetId: 2,
    category: "error_prone",
    description: "모호한 컬럼명(혈압→수축기혈압, 나이→연령대코드)",
  },
  {
    id: 12,
    question: "BMI가 25 이상인 과체중 인원의 비율은 몇 퍼센트인가요?",
    datasetId: 2,
    category: "error_prone",
    description: "BMI 컬럼 없음, 계산 필요",
  },
  {
    id: 13,
    question: "당뇨 위험군(공복혈당 126 이상)의 성별 분포를 보여주세요",
    datasetId: 2,
    category: "error_prone",
    description: "컬럼명 매핑 필요(공복혈당→식전혈당(공복혈당))",
  },
  {
    id: 14,
    question: "대구에서 가장 많은 업종 상위 5개를 알려줘",
    datasetId: 8,
    category: "medium",
    description: "상가 데이터셋, GROUP BY + ORDER BY + LIMIT",
  },
  {
    id: 15,
    question: "행정동별 음식점 수를 많은 순으로 10개만 보여줘",
    datasetId: 8,
    category: "hard",
    description: "상가 데이터셋, 업종 필터 + GROUP BY + ORDER BY",
  },
];

interface TestResult {
  testId: number;
  question: string;
  category: string;
  success: boolean;
  hasData: boolean;
  error: string | null;
  latencyMs: number;
  sql: string;
}

async function runTest(tc: TestCase): Promise<TestResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/sql-chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: tc.question,
        datasetId: tc.datasetId,
      }),
    });

    const latencyMs = Date.now() - start;
    const body = await res.json() as any;

    if (!res.ok) {
      return {
        testId: tc.id,
        question: tc.question,
        category: tc.category,
        success: false,
        hasData: false,
        error: body.message || `HTTP ${res.status}`,
        latencyMs,
        sql: "",
      };
    }

    const hasData = Array.isArray(body.data) && body.data.length > 0;
    const hasError = !!body.error;

    return {
      testId: tc.id,
      question: tc.question,
      category: tc.category,
      success: !hasError && hasData,
      hasData,
      error: body.error || null,
      latencyMs,
      sql: body.sql || "",
    };
  } catch (e: any) {
    return {
      testId: tc.id,
      question: tc.question,
      category: tc.category,
      success: false,
      hasData: false,
      error: e.message,
      latencyMs: Date.now() - start,
      sql: "",
    };
  }
}

async function main() {
  const mode = process.env.PIPELINE_MODE || "unknown";
  console.log(`\n========================================`);
  console.log(`  파이프라인 평가 테스트 (${mode} 모드)`);
  console.log(`========================================\n`);

  const results: TestResult[] = [];

  for (const tc of testCases) {
    process.stdout.write(`[${tc.id}/${testCases.length}] ${tc.description}... `);
    const result = await runTest(tc);
    results.push(result);
    console.log(result.success ? "✅ 성공" : `❌ 실패 (${result.error?.slice(0, 60)})`);
    // rate limit 방지
    await new Promise(r => setTimeout(r, 2000));
  }

  // 결과 요약
  const total = results.length;
  const successCount = results.filter(r => r.success).length;
  const avgLatency = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / total);

  const byCategory = ["easy", "medium", "hard", "error_prone"].map(cat => {
    const catResults = results.filter(r => r.category === cat);
    const catSuccess = catResults.filter(r => r.success).length;
    return { category: cat, total: catResults.length, success: catSuccess, rate: Math.round(catSuccess / catResults.length * 100) };
  });

  console.log(`\n========== 결과 요약 (${mode}) ==========`);
  console.log(`전체 성공률: ${successCount}/${total} (${Math.round(successCount/total*100)}%)`);
  console.log(`평균 응답 시간: ${avgLatency}ms`);
  console.log(`\n난이도별:`);
  for (const c of byCategory) {
    console.log(`  ${c.category.padEnd(12)} ${c.success}/${c.total} (${c.rate}%)`);
  }

  // JSON 결과 저장
  const outputPath = `logs/eval-${mode}-${Date.now()}.json`;
  const { writeFileSync } = await import("fs");
  writeFileSync(outputPath, JSON.stringify({ mode, timestamp: new Date().toISOString(), summary: { total, successCount, successRate: Math.round(successCount/total*100), avgLatencyMs: avgLatency, byCategory }, results }, null, 2));
  console.log(`\n결과 저장: ${outputPath}`);
}

main().catch(console.error);
