/** Meta description для SEO: максимум maxLen символов, обрезка по последнему пробелу + «...». */
export function truncateMetaDescription(input: string, maxLen = 155): string {
  if (input.length <= maxLen) return input
  const reserve = 3
  const cut = input.slice(0, maxLen - reserve)
  const lastSpace = cut.lastIndexOf(' ')
  if (lastSpace > 12) return cut.slice(0, lastSpace) + '...'
  return cut + '...'
}
