// A set of open/expanded ids (collapsible groups): `toggle` flips one, `add` opens one without closing it.
// Backed by an array so `has` in a template stays reactive.
export function useToggleSet() {
  const items = ref<string[]>([])
  const has = (id: string) => items.value.includes(id)
  function add(id: string) {
    if (!has(id)) items.value.push(id)
  }
  function toggle(id: string) {
    const i = items.value.indexOf(id)
    if (i >= 0) items.value.splice(i, 1)
    else items.value.push(id)
  }
  return { items, has, add, toggle }
}
