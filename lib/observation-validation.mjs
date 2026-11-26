const categories = new Set([
  'duplicate_reference',
  'unmatched_reference',
  'amount_inconsistency',
  'fee_review',
  'refund_review',
  'settlement_review',
  'fx_review',
  'unsupported_claim',
])

export function validateObservations(observations, evidence) {
  const evidenceById = new Map(evidence.map((row) => [row.id, row]))
  const recordIds = new Set(evidence.map((row) => row.recordId))

  return (Array.isArray(observations) ? observations : [])
    .slice(0, 25)
    .filter((item) =>
      item !== null &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      categories.has(item.category) &&
      Array.isArray(item.recordIds) &&
      Array.isArray(item.evidence) &&
      item.recordIds.length > 0 &&
      item.evidence.length > 0 &&
      item.recordIds.every((id) => recordIds.has(id)) &&
      item.evidence.every((id) => {
        const source = evidenceById.get(id)
        return source && item.recordIds.includes(source.recordId)
      }) &&
      typeof item.explanation === 'string' &&
      item.explanation.trim().length > 0 &&
      item.explanation.length <= 500 &&
      Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1,
    )
    .map((item) => ({
      category: item.category,
      recordIds: item.recordIds,
      evidence: item.evidence,
      explanation: item.explanation,
      confidence: item.confidence,
      status: 'unverified',
    }))
}
