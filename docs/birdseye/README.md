# Birdeye Operations Guide

## Overview

Birdeye is a knowledge map system for shipyard-cp that enables efficient navigation and discovery of documentation relationships. It provides three layers of abstraction:

1. **index.json** - Foundation data with node listings and adjacency relationships (Edges)
2. **caps/** - Capsule summaries for each node (summary, deps_out, deps_in, risks, etc.)
3. **hot.json** - Hot list of primary nodes for immediate reference

## Directory Structure

```
docs/birdseye/
├── README.md          # This file
├── index.json         # Node listings and edges
├── hot.json           # Primary nodes for immediate reference
└── caps/              # Capsule summaries
    ├── README.md.json
    ├── RUNBOOK.md.json
    ├── REQUIREMENTS.md.json
    └── ... (other capsules)
```

## Node Roles

| Role | Description |
|------|-------------|
| `overview` | Project overview and getting started |
| `operations` | Implementation and operational procedures |
| `requirements` | Requirements definitions |
| `specification` | Technical specifications |
| `guide` | Implementation guides and preparation |

## Using Birdeye

### For LLMs

1. Start with `hot.json` to identify primary entry points
2. Read `index.json` to understand node relationships
3. Load relevant capsule files for detailed context

### For Humans

1. Refer to `docs/BIRDSEYE.md` for a human-readable navigation guide
2. Use hot list for quick access to key documents
3. Follow edges to discover related documentation

## Updating Birdeye

### When to Update

- When adding new documentation files
- When changing document relationships
- When project structure changes
- After major requirement changes

### Update Procedure

1. Update `index.json` with new/modified nodes and edges
2. Create/update capsule files in `caps/`
3. Update `hot.json` if primary nodes change
4. Regenerate `docs/BIRDSEYE.md` if structure changes significantly

### Capsule Generation

Each capsule JSON should contain:

```json
{
  "id": "document-path",
  "role": "role-type",
  "public_api": ["exported concepts"],
  "summary": "Concise document summary",
  "deps_out": ["referenced documents"],
  "deps_in": ["referencing documents"],
  "risks": ["identified risks"],
  "tests": ["test items"],
  "generated_at": "serial number"
}
```

## Validation

### JSON Validation

```bash
# Validate index.json
node -e "JSON.parse(require('fs').readFileSync('docs/birdseye/index.json'))"

# Validate hot.json
node -e "JSON.parse(require('fs').readFileSync('docs/birdseye/hot.json'))"

# Validate all capsules
for f in docs/birdseye/caps/*.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f'))"
done
```

### Link Integrity

- Verify all `deps_out` paths exist in `index.json`
- Verify all capsule IDs match entries in `index.json`
- Verify BIRDSEYE.md links point to existing documents

## Maintenance Notes

- Keep capsules concise (max 500 characters for summary)
- Update edges when documents are renamed or moved
- Remove stale capsules when documents are deleted
- Maintain bidirectional consistency in deps_out/deps_in