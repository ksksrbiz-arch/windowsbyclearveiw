# Stage 02 — Openings

## Inputs

`01-scope` output plus explicit opening information from the quote.

## Process

Create a stable opening ID/number for every quoted opening. Record product/type, quantity, dimensions, existing condition, installation method, flashing/water-management considerations, and notes. Keep unknowns explicit.

## Outputs

`openings.json` with one record per opening and evidence state for each field.

## Stop conditions

Opening count conflicts with quote quantity; dimensions are treated as measured when they are not; or installation method is guessed from an ambiguous product label.
