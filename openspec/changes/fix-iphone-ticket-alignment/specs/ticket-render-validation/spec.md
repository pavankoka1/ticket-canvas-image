# Spec Delta

## Purpose

Provide reproducible physical-device evidence of ticket alignment and distinguish actual displacement from rendering softness and shared canvas errors.

## ADDED Requirements

### Requirement: Reproducible phone evidence
The developer harness SHALL preserve executable capture and analysis scripts, result tables and a manifest identifying the commit, device, OS/browser versions, viewport, ratio, fonts, cache state and capture parameters. Missing provenance SHALL be explicit, not inferred. Existing baseline evidence SHALL be reproduced before rendering changes are evaluated.

#### Scenario: Baseline reproduction
- **WHEN** the preserved harness runs against the recorded unmodified application on the reference iPhone 16 Pro Max
- **THEN** it covers five presets, three ticket states, both renderers and three repeated DOM/canvas captures
- **AND** it reproduces the reported F0 findings or records and resolves a reproducibility discrepancy before evaluating a fix

### Requirement: DOM is the alignment reference
Each canvas SHALL be measured against its own live DOM at shared screenshot coordinates. Full-versus-optimized canvas comparison SHALL be secondary. Reports SHALL distinguish displacement, shape differences, softness and inconclusive measurements, and state the search resolution without claiming absolute pixel equality.

#### Scenario: Shared renderer error
- **WHEN** both canvas rows agree with each other but differ from their DOM references
- **THEN** the result is reported as a DOM mismatch rather than a pass

#### Scenario: Low-contrast or isolated glyph drift
- **WHEN** disabled text or one glyph within a number differs
- **THEN** analysis considers that text or glyph independently of whole-ticket error counts
- **AND** a colour-difference threshold or matching centroid alone cannot establish alignment

### Requirement: Controlled capture phases
Experiments SHALL record unmodified, intervention and restored phases, repeatability, absolute element positions and origin diagnostics. Screenshot scale SHALL be verified without resizing or independent ink recentering. Layout-origin evidence SHALL include ancestor transforms and zoom, not only the final bounding rectangle.

#### Scenario: Intervention with regenerated sprites
- **WHEN** a capture policy is tested with freshly generated artwork
- **THEN** the record verifies alignment was ready before measurement and capture
- **AND** it identifies whether each phase used fresh, retained or regenerated assets
- **AND** restoration is checked against the appropriate original control

### Requirement: Physical-device acceptance and unresolved cases
Acceptance of the iPhone correction SHALL require the physical-phone matrix. Desktop DPR emulation SHALL be labelled regression evidence only. Unresolved desktopSmall, multiplier, glyph and disc cases SHALL retain independent evidence and disposition; softness SHALL NOT conceal movement, clipping or changed geometry.

#### Scenario: Desktop emulation passes
- **WHEN** desktop emulation passes without a corresponding physical-phone run
- **THEN** the iPhone acceptance gate remains unverified

#### Scenario: Investigation finishes without a demonstrated fix
- **WHEN** an open case is investigated without eliminating confirmed displacement
- **THEN** it remains explicitly unresolved and cannot be reported as an all-presets alignment pass
- **AND** any proposed rendering fix requires its own controlled evidence before catalog adoption
