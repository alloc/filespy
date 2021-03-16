// Adapted from https://github.com/hughsk/path-sort
export function sortPaths(as: string, bs: string) {
  let a = as.split('/')
  let b = bs.split('/')
  let l = Math.min(a.length, b.length)
  for (let i = 0; i < l; i += 1) {
    let ac = a[i].toUpperCase()
    let bc = b[i].toUpperCase()
    if (ac > bc) return +1
    if (ac < bc) return -1
  }
  return a.length - b.length
}
