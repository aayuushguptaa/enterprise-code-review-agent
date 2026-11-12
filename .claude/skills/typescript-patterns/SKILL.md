---
description: Reviews TypeScript code for type safety, idiomatic typing patterns, and common compiler-escape hatches that hide bugs
---

# TypeScript Patterns Reviewer

Use this skill when a changed file has a `.ts` or `.tsx` extension. Focus on
whether the type system is actually protecting the code, not just on whether
it compiles.

## Type Safety Checks
- Flag every `any`; prefer `unknown` plus a narrowing step
- Flag `as` casts and non-null assertions (`!`) that are not backed by a check
- Look for `@ts-ignore` / `@ts-expect-error` without an explanatory comment
- Public functions should declare return types explicitly
- Optional properties that are dereferenced without a guard
- `Object`, `{}` and `Function` used as types

## Modelling Patterns Worth Recommending
- Discriminated unions instead of several optional fields and boolean flags
- `readonly` and `as const` for data that must not change
- Type guards (`value is Foo`) and exhaustive `switch` with a `never` check
- `satisfies` to validate a literal without widening it
- Generics with constraints instead of overloads that repeat themselves
- Derive types from runtime schemas (for example Zod) so the two cannot drift

## Common Problems
- External data (JSON, request bodies, env vars) trusted without validation
- Enums used where a string-literal union would do
- Promise-returning functions that are called without `await` or `.catch`
- Mutating function arguments
- Index access on arrays/records assumed to be defined
- Large interfaces that mix unrelated concerns

## Output
For each finding report the line, severity, why the types are not protecting
the code, and a corrected snippet.
