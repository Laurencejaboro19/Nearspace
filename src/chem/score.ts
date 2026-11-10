/**
 * Composite ranking. Every sub-score is kept on the result so a ranking can always be explained.
 * Edit WEIGHTS for your project — they are a starting point, not a law.
 */
export interface ScoreParts {
  similarity: number;
  qed: number;
  synthesis: number;
  cleanliness: number;
  total: number;
}

export const WEIGHTS = {
  /** Structural relatedness to the parent. This is a SAR tool, so it dominates. */
  similarity: 0.4,
  /** Drug-likeness (QED). */
  qed: 0.25,
  /** How easy it looks to make (inverted SA heuristic). */
  synthesis: 0.2,
  /** Absence of reactive / promiscuity alerts. */
  cleanliness: 0.15,
};

export function compositeScore(input: {
  similarity: number;
  qed: number;
  saScoreHeuristic: number;
  alertCount: number;
}): ScoreParts {
  const similarity = clamp(input.similarity);
  const qed = clamp(input.qed);
  // SA heuristic runs 1 (easy) to 10 (hard); map to 1 (good) to 0 (bad).
  const synthesis = clamp((10 - input.saScoreHeuristic) / 9);
  const cleanliness = clamp(1 - input.alertCount * 0.34);

  const total =
    WEIGHTS.similarity * similarity +
    WEIGHTS.qed * qed +
    WEIGHTS.synthesis * synthesis +
    WEIGHTS.cleanliness * cleanliness;

  return { similarity, qed, synthesis, cleanliness, total: clamp(total) };
}

function clamp(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}
