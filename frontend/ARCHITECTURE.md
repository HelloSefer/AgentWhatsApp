# Frontend Architecture

## Architecture name

The frontend uses a scalable modular, feature-based architecture with Next.js App Router route groups and layered separation between route composition, reusable UI, configuration, domain logic, and future data access.

## Top-level responsibilities

- `src/app`: route files, route groups, and global App Router conventions. Pages and layouts remain thin composition layers.
- `src/components`: reusable UI outside a single feature. `ui` contains installed shadcn components; `providers` contains global client providers; `layout` contains reusable application shells; `shared` contains small reusable primitives.
- `src/features`: feature-owned UI, domain logic, types, validation, and future feature services. Create a feature directory when a capability has real implementation work.
- `src/config`: static, product-level configuration such as route references and navigation.
- `src/lib`: generic library helpers such as class name composition.
- `src/hooks`, `src/services`, `src/store`, `src/types`, `src/schemas`, `src/constants`, and `src/utils`: add these only when they contain a real shared concern.

## Route groups

- `(marketing)`: public product and marketing routes. The current `/` route is defined here.
- `(auth)`: future authentication routes and their focused layout.
- `(dashboard)`: future authenticated application routes and their focused layout.

Route groups organize code without changing the public URL. A URL must have exactly one route definition.

## Component boundaries

Shared components belong in `src/components` only when they serve more than one route or feature. Components used only by one capability belong in `src/features/<feature>`. Do not duplicate types, constants, navigation arrays, or API logic across components.

Prefer composition to monolithic components. Keep pages and layouts thin, and move substantial sections or interaction into appropriately scoped components.

## Rendering and data rules

Server Components are the default. Add `"use client"` only when browser APIs, hooks, or interactive behavior require it. Static configuration belongs under `src/config` and must not contain JSX.

Future API integration must be centralized in dedicated service or feature data-access modules. Do not place endpoint calls, response contracts, or transport logic directly in UI components. Backend access is outside the frontend scope unless explicitly requested.
