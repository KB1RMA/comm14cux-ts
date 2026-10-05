# Agent instructions

These rules apply to any AI coding agent or assistant working in this repository. They exist to keep the project compliant with the GNU GPL v3. When a rule conflicts with a task, stop and ask the maintainer instead of working around it.

## Licence

- This project is licensed **`GPL-3.0-only`**. Never write `GPL-3.0-or-later`, `GPL-3.0+`, or any other licence identifier. The upstream code it derives from is GPL v3 without an "or later" clause, so this project cannot offer later versions either.
- Never modify, shorten or replace `LICENSE`. It is the verbatim GPL v3 text from gnu.org.
- `package.json` (and any other package manifest) must declare `"license": "GPL-3.0-only"`.

## File headers

Every source file needs a header. Use the form that matches the file's origin.

**Files ported or adapted from libcomm14cux** (any file whose logic, constants, memory offsets or structure come from the C source):

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, <YEAR>.
```

**Files written from scratch for this project:**

```ts
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) <YEAR> comm14cux-ts contributors
```

- Never remove or weaken an existing copyright or attribution line.
- When in doubt about a file's origin, use the "derived" header. Over-attributing is safe; under-attributing is not.
- GPL v3 §5(a) requires a notice that derived files were modified, with a date. When substantially changing a derived file in a later year, add that year to its "Ported … and modified" line.

## Dependencies

Code that is bundled or shipped with this library must be under a GPL-3.0-compatible licence. Check the licence of every new runtime dependency before adding it.

- **Allowed:** MIT, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, Apache-2.0, Zlib, CC0-1.0, Unlicense, MPL-2.0, LGPL-2.1-or-later, LGPL-3.0, GPL-2.0-or-later, GPL-3.0.
- **Ask the maintainer first:** AGPL-3.0, any licence not listed here, and anything with no licence at all.
- **Never add:** GPL-2.0-only, EPL-1.0, CDDL, SSPL, BUSL, BSD-4-Clause, any Creative Commons "NonCommercial" or "NoDerivatives" licence, or proprietary code.

Development-only tools that are not shipped (test runners, linters, build tools) do not have to be GPL-compatible, but must not be bundled into published output.

## Copying code

- Do not paste code from other projects, Stack Overflow answers, blog posts or other sources unless its licence is on the allowed list above. When you do, keep its copyright notice and add it to the credits in `README.md`.
- Do not reproduce code from memory of other projects. Write it fresh or port it from libcomm14cux with the derived header.

## Source availability

- Published packages must let users get the complete corresponding source: include the TypeScript sources and source maps in the npm package, and keep the `repository` field in `package.json` pointing at the public repo.
- Never publish only minified or obfuscated output.

## Upstream projects

- Do not open issues, pull requests or patches against libcomm14cux or RoverGauge from this repository. Those projects prohibit AI-generated contributions.
- Keep the credits and "not affiliated with or endorsed by" statement in `README.md` intact.

## Names and trademarks

- "Rover", "Land Rover", "Lucas" and "RoverGauge" are other parties' names and trademarks. Do not use them in package names, module names, identifiers that appear in the public API, or branding. Describing compatibility in prose ("for the Lucas 14CUX ECU") is fine.

## Warranty

- Do not add text that implies a warranty or fitness for purpose. GPL v3 §15–16 disclaim both, and the README's safety section must stay.
