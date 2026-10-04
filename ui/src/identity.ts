/**
 * Whether a row should print a node's id under its name.
 *
 * On this fleet the id is the name's own slug ("[Metix]-DMIT-2" is
 * metix-dmit-2), so printing it under every name doubles each row's height to
 * say nothing new, and the table reads as a list of pairs. The id is printed
 * when it tells the operator something the name does not, such as a node
 * renamed after enrolment, whose id still carries the old name. The full id
 * is always the name's title and the side panel's subtitle, and the search
 * matches it either way.
 *
 * Copied from lattice-plugin-netguard ui/src/identity.ts; a chassis candidate.
 */
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/^node[_-]/, "")
    .replace(/[^a-z0-9]/g, "");
}

export function idAddsInformation(name: string, id: string): boolean {
  if (!id || !name || name === id) return false;
  return slug(name) !== slug(id);
}
