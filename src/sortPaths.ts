// https://github.com/hughsk/path-sort
export function sortPaths(as: string, bs: string) {
  let a = as.split('/')
  let b = bs.split('/')
  let l = Math.max(a.length, b.length)
  for (let i = 0; i < l; i += 1) {
    if (!(i in a)) return -1
    if (!(i in b)) return +1
    if (a[i].toUpperCase() > b[i].toUpperCase()) return +1
    if (a[i].toUpperCase() < b[i].toUpperCase()) return -1
    if (a.length < b.length) return -1
    if (a.length > b.length) return +1
  }
  return 0
}
