---
schema: ts-optimize/rule@1
id: type-03
version: 1
name: Schema and type dual declaration
domain: types
batch: 8
wave: "R"
severity: warn
fix_risk: medium
fix_mode: assisted
grain: symbol
triage: agent
semantic_invariance: false
modes: [deep]
engines: [G]
requires: {}
adapter: symbols:schema-dual
primary_over: [type-10]
sources: ['CAT Pattern 2', 'SK Sin 2', 'STM §2 (boundary validation)']
---
## What
A runtime validator (`XSchema` built with zod, valibot, yup or arktype) declared next to a hand-written `interface X` / `type X = {...}` with the same base name in the same package, with no `z.infer<typeof XSchema>` (or the library's equivalent) reference. Over time one side gains a field and the other does not, so the type promises what the validator no longer enforces. Found by the symbol index, not by regex; it runs in wave `R` because fixing the cause removes duplicate guards and casts downstream.

## Triage
Keep when:
- The schema validates **input** and the interface is the **output** after `.transform`, `.default` or `.coerce`; the two are different types on purpose (compare `z.input` and `z.output`).
- The interface has methods, class members or generics a schema cannot express, or it is the public contract of a published package and its declaration emit must stay stable.
- The two share only a name by coincidence (different packages or layers: DTO versus domain model).
- The type comes from generated code (OpenAPI, GraphQL codegen, Prisma) and the schema is hand-written on top.
Read both declarations and list differing fields first; a difference is the drift this rule finds and must be shown in the finding, not hidden by the fix.

## Proposed change
In `{{file}}` ({{package}}), for `{{symbol}}`, make the schema the single source of truth and keep the exported name:
```diff
 export const UserProfileSchema = z.object({
   id: z.string().uuid(),
   email: z.string().email(),
 });
-export interface UserProfile {
-  id: string;
-  email: string;
-  displayName: string;
-}
+export type UserProfile = z.infer<typeof UserProfileSchema>;
```
Library forms: valibot `v.InferOutput<typeof XSchema>`, yup `InferType<typeof XSchema>`, arktype `typeof XSchema.infer`. If the interface had fields the schema lacks (`displayName` above), add them to the schema first (that is the drift, and a behavioural decision for the owner). Consumers in {{consumers}} keep importing the same name.

## Verification
Legs: typecheck (each consumer sees any changed optionality), test, build, declaration-emit when exported (an inferred type in a public signature can hit `TS2742`; annotate the exported symbol if so). Coverage must not drop.

## Pitfalls
- `exactOptionalPropertyTypes` and `.optional()`/`.nullish()` map differently from `?:`; check producers.
- `interface` merges and `extends`; a `type` alias does not. Search for `extends X` and declaration merging before replacing.
- Do not delete the schema to match the interface; the validator is the part that runs.
- Seam: a parallel-representation finding from type-10 on the same names is superseded by this one.
