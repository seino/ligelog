/**
 * @file serializer-entry.ts
 * Public subpath entry point for `ligelog/serializer`.
 *
 * Exposes the core serialization functions so that ecosystem packages
 * (e.g. `@ligelog/redact`, `@ligelog/test`) can reuse them without
 * depending on internal module paths.
 *
 * @example
 * ```ts
 * import { serialize, encodeValue } from 'ligelog/serializer';
 * ```
 *
 * @packageDocumentation
 */

export { serialize, encodeValue } from './serializer';
