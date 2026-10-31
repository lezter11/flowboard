/**
 * The one rule for showing a person's name. Two people in a project can share a full name; the server numbers the later ones
 * (nameSuffix, 2 or more, the same for every viewer) and the web shows "Shubham Singh (2)". Absent and null both mean the name is
 * unique. The number is never made up here: no suffix from the server, no suffix on screen.
 */
export interface NamedPerson { displayName: string; nameSuffix?: number | null }

export function formatPersonName(person: NamedPerson | null | undefined, fallback = ''): string {
  if (!person) return fallback;
  return person.nameSuffix != null && person.nameSuffix >= 2 ? `${person.displayName} (${person.nameSuffix})` : person.displayName;
}

/** Screen-reader text: "Shubham Singh, number 2, Member". */
export function personAria(person: NamedPerson, role?: string): string {
  const parts = [person.displayName];
  if (person.nameSuffix != null && person.nameSuffix >= 2) parts.push(`number ${person.nameSuffix}`);
  if (role) parts.push(role);
  return parts.join(', ');
}
