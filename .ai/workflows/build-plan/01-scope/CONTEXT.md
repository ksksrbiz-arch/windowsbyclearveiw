# Stage 01 — Scope

## Inputs

Quote header, customer/project metadata, quote items, descriptions, quantities, and source snapshot.

## Process

Extract only commitments actually present in the quote. Normalize line items without changing their meaning. Identify project type, replacement/new construction indicators, and any explicit installation assumptions.

## Outputs

`scope.json` containing:
- quote id/version/source hash or snapshot;
- normalized scope items;
- explicit project facts;
- unresolved scope questions;
- evidence state for every non-trivial inference.

## Stop conditions

Quote data is internally contradictory, required scope is absent, or a proposed interpretation would change price/material/order/install obligations.
