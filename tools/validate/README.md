# Validators

**Contents:** `npm run validate` fails the build on · From M0 it also fails on

`npm run validate` fails the build on:
- content that violates its `@atlas/schema` schema, or content in a directory with no registered schema.

From M0 it also fails on:
- sentences with no claim;
- numbers without a population;
- retracted or blocked sources;
- assets without provenance;
- structure ids with no matching glTF node.
