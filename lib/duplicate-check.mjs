export function findDuplicateGroups(evidence) {
  const groups = new Map()
  for (const row of Array.isArray(evidence) ? evidence : []) {
    const reference = normalize(row.reference)
    if (!reference) continue
    const key = [reference, normalize(row.currency), normalize(row.amount)].join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({
      key,
      reference: rows[0].reference,
      currency: rows[0].currency,
      amount: rows[0].amount,
      rows,
    }))
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase()
}
