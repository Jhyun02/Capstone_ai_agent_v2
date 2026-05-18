/**
 * DCAT 3.0 DQV 기반 데이터 품질 자동 평가 서비스
 *
 * CSV 업로드 시 완전성, 일관성, 유효성, 적시성을 자동 계산하고
 * DCAT 3.0 DQV 호환 메타데이터로 DB에 저장한다.
 */

import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import {
  datasets,
  datasetQualityMetrics,
  type ColumnInfo,
  type DcatColumnMetric,
  type DcatQualityMetadata,
  type ProvenanceInfo,
} from "@shared/schema";

// 스키마 캐시 무효화 콜백 (routes.ts에서 등록)
let invalidateSchemaCache: ((datasetId: string) => void) | null = null;

export function setSchemaCacheInvalidator(fn: (datasetId: string) => void) {
  invalidateSchemaCache = fn;
}

// === 가중치 상수 ===
const WEIGHT_COMPLETENESS = 0.4;
const WEIGHT_CONSISTENCY = 0.25;
const WEIGHT_VALIDITY = 0.25;
const WEIGHT_TIMELINESS = 0.1;

/**
 * 데이터셋의 품질 메트릭을 계산하고 DB에 저장한다.
 * 기존 quality-report 엔드포인트의 SQL 집계 로직을 재활용.
 */
export async function computeQualityMetrics(datasetId: number): Promise<void> {
  const dataset = await db
    .select()
    .from(datasets)
    .where(eq(datasets.id, datasetId))
    .limit(1);

  if (dataset.length === 0) return;
  const ds = dataset[0];
  if (ds.dataType !== "structured" || !ds.columnInfo) return;

  const columnInfo: ColumnInfo[] = JSON.parse(ds.columnInfo);
  if (columnInfo.length === 0) return;

  const useSampling = ds.rowCount > 10000;
  const sampleCte = useSampling
    ? `WITH sampled AS (SELECT * FROM structured_data WHERE dataset_id = ${datasetId} ORDER BY RANDOM() LIMIT 10000)`
    : `WITH sampled AS (SELECT * FROM structured_data WHERE dataset_id = ${datasetId})`;
  const tableName = "sampled";

  // 메인 집계 쿼리 동적 생성 (routes.ts quality-report 로직 재활용)
  const selectParts: string[] = [`COUNT(*) AS total_count`];

  for (const col of columnInfo) {
    const colKey = col.name.replace(/'/g, "''");
    const colAlias = col.name.replace(/[^a-zA-Z0-9_\uAC00-\uD7A3]/g, "_");

    // null/빈값 카운트
    selectParts.push(
      `SUM(CASE WHEN data->>'${colKey}' IS NULL OR TRIM(data->>'${colKey}') = '' THEN 1 ELSE 0 END) AS "${colAlias}_null"`,
    );
    // 고유값 수
    selectParts.push(
      `COUNT(DISTINCT data->>'${colKey}') AS "${colAlias}_unique"`,
    );

    if (col.type === "number") {
      selectParts.push(
        `SUM(CASE WHEN data->>'${colKey}' IS NOT NULL AND TRIM(data->>'${colKey}') != '' AND data->>'${colKey}' ~ '^-?[0-9,]+\\.?[0-9]*$' THEN 1 ELSE 0 END) AS "${colAlias}_type_match"`,
      );
      const numFilter = `data->>'${colKey}' IS NOT NULL AND TRIM(data->>'${colKey}') != '' AND REGEXP_REPLACE(TRIM(data->>'${colKey}'), ',', '', 'g') ~ '^-?[0-9]+\\.?[0-9]*$'`;
      const numCast = `CAST(REGEXP_REPLACE(TRIM(data->>'${colKey}'), ',', '', 'g') AS DOUBLE PRECISION)`;
      selectParts.push(
        `AVG(CASE WHEN ${numFilter} THEN ${numCast} END) AS "${colAlias}_mean"`,
      );
      selectParts.push(
        `STDDEV(CASE WHEN ${numFilter} THEN ${numCast} END) AS "${colAlias}_stddev"`,
      );
    } else if (col.type === "date") {
      selectParts.push(
        `SUM(CASE WHEN data->>'${colKey}' IS NOT NULL AND TRIM(data->>'${colKey}') != '' AND data->>'${colKey}' ~ '^\\d{4}[-/]\\d{2}[-/]\\d{2}' THEN 1 ELSE 0 END) AS "${colAlias}_type_match"`,
      );
      selectParts.push(`MAX(data->>'${colKey}') AS "${colAlias}_max_date"`);
    } else if (col.type === "boolean") {
      selectParts.push(
        `SUM(CASE WHEN data->>'${colKey}' IS NOT NULL AND TRIM(data->>'${colKey}') != '' AND LOWER(TRIM(data->>'${colKey}')) IN ('true','false','yes','no','1','0','y','n','예','아니오') THEN 1 ELSE 0 END) AS "${colAlias}_type_match"`,
      );
    }
  }

  const mainQuery = `${sampleCte} SELECT ${selectParts.join(", ")} FROM ${tableName}`;
  const mainResult = await db.execute(sql.raw(mainQuery));
  const stats = (mainResult as any).rows[0];
  const totalCount = parseInt(stats.total_count);

  if (totalCount === 0) return;

  // 숫자 컬럼 이상치 카운트
  const outlierCounts: Record<string, number> = {};
  const numCols = columnInfo.filter((c) => c.type === "number");
  for (const col of numCols) {
    const colAlias = col.name.replace(/[^a-zA-Z0-9_\uAC00-\uD7A3]/g, "_");
    const mean = parseFloat(stats[`${colAlias}_mean`]);
    const stddev = parseFloat(stats[`${colAlias}_stddev`]);
    if (!isNaN(mean) && !isNaN(stddev) && stddev > 0) {
      const colKey = col.name.replace(/'/g, "''");
      const outlierQuery = `${sampleCte} SELECT COUNT(*) AS cnt FROM ${tableName} WHERE data->>'${colKey}' IS NOT NULL AND TRIM(data->>'${colKey}') != '' AND data->>'${colKey}' ~ '^-?[0-9,]+\\.?[0-9]*$' AND ABS(CAST(REGEXP_REPLACE(TRIM(data->>'${colKey}'), ',', '', 'g') AS DOUBLE PRECISION) - ${mean}) > 3 * ${stddev}`;
      const outlierResult = await db.execute(sql.raw(outlierQuery));
      outlierCounts[col.name] = parseInt((outlierResult as any).rows[0].cnt);
    } else {
      outlierCounts[col.name] = 0;
    }
  }

  // 컬럼별 메트릭 계산
  const columnMetrics: DcatColumnMetric[] = columnInfo.map((col) => {
    const colAlias = col.name.replace(/[^a-zA-Z0-9_\uAC00-\uD7A3]/g, "_");
    const nullCount = parseInt(stats[`${colAlias}_null`]) || 0;
    const nonNullCount = totalCount - nullCount;
    const completeness = totalCount > 0 ? Math.round((nonNullCount / totalCount) * 100) : 0;
    const nullRatio = totalCount > 0 ? nullCount / totalCount : 0;

    let typeConsistency = 100;
    if (col.type !== "text" && nonNullCount > 0) {
      const typeMatch = parseInt(stats[`${colAlias}_type_match`]) || 0;
      typeConsistency = Math.round((typeMatch / nonNullCount) * 100);
    }

    // 유효성: 타입 일치율 + 이상치 비율 기반
    let validity = typeConsistency;
    if (col.type === "number" && nonNullCount > 0) {
      const outliers = outlierCounts[col.name] || 0;
      const outlierPenalty = Math.round((outliers / nonNullCount) * 100);
      validity = Math.max(0, typeConsistency - outlierPenalty);
    }

    // 컬럼별 경고 생성
    const warnings: string[] = [];
    if (nullRatio > 0.2) {
      warnings.push(`null ${Math.round(nullRatio * 100)}% → COALESCE 사용 권장`);
    }
    if (typeConsistency < 90 && col.type !== "text") {
      warnings.push(`타입 불일치 ${100 - typeConsistency}% → CAST 시 주의`);
    }
    if (col.type === "number" && (outlierCounts[col.name] || 0) > 0) {
      warnings.push(`이상치 ${outlierCounts[col.name]}건 (3σ 기준)`);
    }

    return {
      name: col.name,
      type: col.type,
      completeness,
      typeConsistency,
      validity,
      nullRatio: Math.round(nullRatio * 1000) / 1000,
      outlierCount: col.type === "number" ? outlierCounts[col.name] || 0 : undefined,
      warnings,
    };
  });

  // 차원별 종합 점수 계산
  const avgCompleteness = columnMetrics.reduce((s, c) => s + c.completeness, 0) / columnMetrics.length;
  const avgConsistency = columnMetrics.reduce((s, c) => s + c.typeConsistency, 0) / columnMetrics.length;
  const avgValidity = columnMetrics.reduce((s, c) => s + c.validity, 0) / columnMetrics.length;

  // 적시성: 날짜 컬럼의 최신 날짜와 현재의 차이 기반
  let timeliness: number | null = null;
  const dateCols = columnInfo.filter((c) => c.type === "date");
  if (dateCols.length > 0) {
    let maxTimeliness = 0;
    for (const col of dateCols) {
      const colAlias = col.name.replace(/[^a-zA-Z0-9_\uAC00-\uD7A3]/g, "_");
      const maxDate = stats[`${colAlias}_max_date`];
      if (maxDate) {
        const daysDiff = (Date.now() - new Date(maxDate).getTime()) / (1000 * 60 * 60 * 24);
        // 30일 이내 = 100, 365일 이상 = 0, 선형 감소
        const score = Math.max(0, Math.min(100, Math.round(100 - (daysDiff / 365) * 100)));
        maxTimeliness = Math.max(maxTimeliness, score);
      }
    }
    timeliness = maxTimeliness;
  }

  // 종합 점수 (가중 평균)
  let overallScore: number;
  if (timeliness !== null) {
    overallScore = Math.round(
      avgCompleteness * WEIGHT_COMPLETENESS +
      avgConsistency * WEIGHT_CONSISTENCY +
      avgValidity * WEIGHT_VALIDITY +
      timeliness * WEIGHT_TIMELINESS,
    );
  } else {
    // 적시성 없으면 나머지 가중치 재분배 (4:2.5:2.5 → 비율 유지)
    const totalWeight = WEIGHT_COMPLETENESS + WEIGHT_CONSISTENCY + WEIGHT_VALIDITY;
    overallScore = Math.round(
      avgCompleteness * (WEIGHT_COMPLETENESS / totalWeight) +
      avgConsistency * (WEIGHT_CONSISTENCY / totalWeight) +
      avgValidity * (WEIGHT_VALIDITY / totalWeight),
    );
  }

  // 경고 요약 생성
  const qualityWarnings = generateQualityWarnings(columnMetrics, overallScore);

  // DCAT 3.0 DQV JSON-LD 메타데이터 생성
  const dcatMetadata = buildDcatMetadata(
    avgCompleteness, avgConsistency, avgValidity, timeliness, overallScore,
  );

  // DB에 UPSERT
  const existing = await db
    .select()
    .from(datasetQualityMetrics)
    .where(eq(datasetQualityMetrics.datasetId, datasetId))
    .limit(1);

  const values = {
    datasetId,
    completeness: String(Math.round(avgCompleteness)),
    consistency: String(Math.round(avgConsistency)),
    validity: String(Math.round(avgValidity)),
    timeliness: timeliness !== null ? String(timeliness) : null,
    overallScore: String(overallScore),
    columnMetrics,
    dcatMetadata,
    qualityWarnings,
    measuredAt: new Date(),
  };

  if (existing.length > 0) {
    await db
      .update(datasetQualityMetrics)
      .set(values)
      .where(eq(datasetQualityMetrics.datasetId, datasetId));
  } else {
    await db.insert(datasetQualityMetrics).values(values);
  }

  // 스키마 캐시 무효화
  if (invalidateSchemaCache) {
    invalidateSchemaCache(String(datasetId));
  }

  console.log(`[DQV] 데이터셋 ${datasetId} 품질 분석 완료: 종합 ${overallScore}점`);
}

/**
 * 컬럼별 경고를 LLM 프롬프트용 문자열로 생성
 */
function generateQualityWarnings(
  columnMetrics: DcatColumnMetric[],
  overallScore: number,
): string {
  const lines: string[] = [`[데이터 품질 주의사항] (품질 점수: ${overallScore}/100)`];

  for (const col of columnMetrics) {
    for (const warning of col.warnings) {
      lines.push(`- 컬럼 '${col.name}': ${warning}`);
    }
  }

  if (lines.length === 1) {
    lines.push("- 특별한 품질 이슈 없음");
  }

  return lines.join("\n");
}

/**
 * DCAT 3.0 DQV 호환 JSON-LD 메타데이터 생성
 */
function buildDcatMetadata(
  completeness: number,
  consistency: number,
  validity: number,
  timeliness: number | null,
  overallScore: number,
): DcatQualityMetadata {
  const metadata: DcatQualityMetadata = {
    "@context": {
      dqv: "http://www.w3.org/ns/dqv#",
      dcat: "http://www.w3.org/ns/dcat#",
    },
    "@type": "dqv:QualityMeasurement",
    dimensions: {
      completeness: { value: Math.round(completeness), metric: "dqv:completenessMetric" },
      consistency: { value: Math.round(consistency), metric: "dqv:consistencyMetric" },
      validity: { value: Math.round(validity), metric: "dqv:validityMetric" },
    },
    overallScore,
    measuredAt: new Date().toISOString(),
  };

  if (timeliness !== null) {
    metadata.dimensions.timeliness = { value: timeliness, metric: "dqv:timelinessMetric" };
  }

  return metadata;
}

/**
 * DB에서 품질 경고 문자열 조회 (LLM 프롬프트 주입용)
 */
export async function getQualityContext(datasetId: number): Promise<string | null> {
  const result = await db
    .select({ qualityWarnings: datasetQualityMetrics.qualityWarnings })
    .from(datasetQualityMetrics)
    .where(eq(datasetQualityMetrics.datasetId, datasetId))
    .limit(1);

  return result.length > 0 ? result[0].qualityWarnings : null;
}

/**
 * 출처 각주 정보 생성
 */
export async function getProvenanceInfo(datasetId: number): Promise<ProvenanceInfo | null> {
  const result = await db
    .select()
    .from(datasets)
    .leftJoin(datasetQualityMetrics, eq(datasets.id, datasetQualityMetrics.datasetId))
    .where(eq(datasets.id, datasetId))
    .limit(1);

  if (result.length === 0) return null;

  const ds = result[0].datasets;
  const qm = result[0].dataset_quality_metrics;

  // 품질 메트릭에서 경고 추출
  const warnings: string[] = [];
  if (qm?.columnMetrics) {
    const metrics = qm.columnMetrics as DcatColumnMetric[];
    for (const col of metrics) {
      for (const w of col.warnings) {
        warnings.push(`'${col.name}' ${w}`);
      }
    }
  }

  return {
    datasetName: ds.name,
    rowCount: ds.rowCount,
    qualityScore: qm ? parseInt(String(qm.overallScore)) : -1,
    measuredAt: qm?.measuredAt?.toISOString() || "",
    warnings,
  };
}
