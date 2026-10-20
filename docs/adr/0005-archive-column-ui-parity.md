# 0005. Archive column gets full UI parity; archive stays a location

Date: 2026-07-09 · Status: accepted · Amends: 0002's presentation

## Context

ADR 0002 kept the Archive column drag-inert ("no archive status to drag
into"). In practice the asymmetry cost more than it protected: archived
cards couldn't be selected, right-clicked, or dragged.

## Decision

On disk nothing changes — archive remains the `archived/` folder, never a
status value. In the UI the column is a first-class citizen: drag in
(= archive, confirmed), drag out to a live column (= restore with that
column's status, confirmed when the batch holds archived cards — an explicit
override of the restore-is-exempt rule for the drag gesture only), one
selection domain across live+archived with per-card skips.

## Consequences

The location/status split is now purely a persistence concept; users never
see it. dragPlan (selection.js) is the single confirm-matrix decider.
