export function resolveBatchStatus(results) {
  const runs = Array.isArray(results) ? results : []
  if (runs.length === 0) return 'failed'
  const completed = runs.filter((result) => result?.status === 'completed').length
  if (completed === runs.length) return 'completed'
  if (completed > 0) return 'partial'
  return 'failed'
}

export function displayVariance(value) {
  return !value || value === '0' ? 'Not calculated' : value
}
