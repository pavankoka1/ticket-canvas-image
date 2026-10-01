# Spec Delta

## Purpose

Keep ticket canvas output aligned with its live DOM reference while preserving reusable artwork and the existing ticket appearance across comparison and catalog views.

## ADDED Requirements

### Requirement: Stable ticket layout before capture
The system SHALL establish whole CSS-pixel effective ticket layout origins before measuring text or capturing artwork. Any fractional visual remainder SHALL be applied after layout and shared by the DOM and canvas presentation. Capture SHALL wait for the current font and layout generation to settle.

#### Scenario: Initial and changed comparison layout
- **WHEN** a comparison preset first renders or its viewport, zoom, or layout changes
- **THEN** both renderers wait for established origins and loaded fonts before capture
- **AND** a capture from a superseded layout cannot be published as ready
- **AND** ticket dimensions and cell geometry remain unchanged

#### Scenario: Origin repair on the reported phone
- **WHEN** all three ticket states in desktopMedium, mobileLarge and mobileCompact are captured at established whole layout origins on the reference iPhone
- **THEN** neither comparison row exhibits detected ID or amount displacement against its own live DOM at quarter-device-pixel search resolution
- **AND** cells, discs and multipliers acquire no new discrepancies

### Requirement: Shared header calibration
The system SHALL support device-measured header calibration shared by full-ticket and reusable-sprite rendering. Validated corrections SHALL affect only captured ID and amount artwork, exactly once, without changing the live reference. An ineffective or unvalidated measurement SHALL NOT be promoted into a rendering correction.

#### Scenario: Mobile headers
- **WHEN** the validated mobile header correction is used after whole-origin alignment on the reference iPhone
- **THEN** normal, gold and disabled header text has no displacement detected at quarter-device-pixel search resolution in either row
- **AND** previously passing presets remain passing

#### Scenario: Unresolved or unrelated text
- **WHEN** a baseline measurement is ineffective for desktopSmall or relates to a multiplier
- **THEN** the shared header mechanism does not silently apply that correction
- **AND** the unresolved case remains separately reported

### Requirement: Capture-compatible sprite reuse
The system SHALL reuse sprites only when their capture policy, layout, font, ratio and validated calibration are compatible. Capture changes SHALL invalidate incompatible persistent and in-memory identities without deleting unrelated stored data. Reuse SHALL produce the same validated geometry as a fresh capture.

#### Scenario: Old persistent artwork
- **WHEN** a page starts after an origin or header-calibration policy change
- **THEN** artwork captured under the previous policy is not used for the new render
- **AND** unrelated catalog or application records remain intact

#### Scenario: Reload and warm cache
- **WHEN** the comparison matrix is repeated with existing compatible sprites after a fresh capture
- **THEN** its per-element alignment results remain consistent with the fresh-capture run

### Requirement: Catalog alignment preserves reusable rendering
After comparison validation, catalog DOM tickets and canvas tickets SHALL use the validated origin and header behaviour. The catalog SHALL preserve reusable cell, badge, digit and amount artwork, existing DOM-band interactions and tile behaviour rather than capturing every ticket independently.

#### Scenario: Catalog handoff and scale
- **WHEN** a catalog of up to 1,000 tickets scrolls between live DOM and canvas, changes preset, adds tickets, or settles a draw gesture
- **THEN** settled tickets agree with the validated comparison geometry on the reference phone
- **AND** DOM-band holes, ticket ordering and visible gestures remain intact
- **AND** repeated numbers and amounts reuse compatible artwork
