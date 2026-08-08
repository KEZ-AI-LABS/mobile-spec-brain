export interface AccessContext { subject: string; grants: readonly string[]; }
export interface ProtectedRecord<T> { acl: readonly string[]; value: T; }
/** Derived records are visible only when the caller satisfies every source ACL constraint. */
export function canRead(context: AccessContext, acl: readonly string[]): boolean { return acl.every((grant) => context.grants.includes(grant)); }
export function filterReadable<T>(context: AccessContext, records: readonly ProtectedRecord<T>[]): T[] { return records.filter((record) => canRead(context, record.acl)).map((record) => record.value); }
