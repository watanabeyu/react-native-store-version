// チェックの結果の形と、そこから終了コードを決める部分（spec 9.3）。出力（output.ts）とチェック（checks/）が共有する

/** チェックの ID（spec 9.3。C5 / C6 は v1 の計画から削った） */
export type CheckId = 'C1' | 'C2' | 'C3' | 'C4' | 'C7' | 'C8';

/**
 * 結果の重さ。`error` / `warning` / `info` が指摘で、`ok`（問題なし）/ `skipped`（確かめる材料が無いので飛ばした）は
 * 指摘ではない（終了コードにも注釈にも関わらない）
 */
export type Level = 'error' | 'warning' | 'info' | 'ok' | 'skipped';

/** チェックの結果の 1 行。1 つのチェックが複数を返すことがある（C3 のプラットフォームごとなど） */
export type CheckEntry = {
  id: CheckId;
  level: Level;
  message: string;
};

/** 指摘の件数 */
export type Counts = { error: number; warning: number; info: number };

export const countEntries = (entries: readonly CheckEntry[]): Counts => {
  const counts: Counts = { error: 0, warning: 0, info: 0 };
  for (const { level } of entries) {
    if (level === 'error' || level === 'warning' || level === 'info') {
      counts[level] += 1;
    }
  }
  return counts;
};

/** 終了コード。error があれば 1、`strict` なら warning でも 1。info は常に 0 */
export const exitCodeOf = (counts: Counts, strict: boolean): 0 | 1 =>
  counts.error > 0 || (strict && counts.warning > 0) ? 1 : 0;
