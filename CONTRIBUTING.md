# Contributing

This repository is optimized for iterative browser-extension work and Gym-driven verification.

## Environment

- Node.js 18+ recommended
- Chrome or Chromium for MV3 testing

## Install and build

```bash
npm install
npm run build
```

Load `extension/dist` in `chrome://extensions` with Developer Mode enabled.

## Common workflows

```bash
npm run watch
npm test
npm run test:e2e
npm run verify:versions
npm run package:ext
```

To serve the Gym locally:

```bash
npm run gym:serve
```

## Adding a Gym case

1. Add a focused HTML fixture under `gym/`.
2. Link it from `gym/index.html`.
3. Add or extend a Playwright spec under `tests/e2e/`.
4. Keep the case deterministic and explainable.

## Style

- Prefer small, testable modules.
- Keep content-script work bounded to the interaction being evaluated.
- Add reason codes for new decisions so the UI and logs remain explainable.
