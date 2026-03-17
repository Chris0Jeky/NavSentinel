# Checklists

## Daily Change Checklist

- [ ] build the extension with `npm run build`
- [ ] run `npm run test`
- [ ] run `npm run test:e2e` if the change touches behavior, messaging, storage, UI, or service-worker flow
- [ ] inspect the relevant Gym level manually if the change affects prompts or user-visible decisions
- [ ] update docs when changing settings, workflow, or threat assumptions

## Navigation Change Checklist

- [ ] verify `smart` mode behavior
- [ ] verify `strict` mode behavior
- [ ] verify `_blank` prompt behavior if links are involved
- [ ] verify delayed redirect and form-submit behavior if main-world patches are involved
- [ ] verify rollback behavior if top-level committed navigations are involved
- [ ] confirm allowlist flows still work

## Credential Change Checklist

- [ ] run `tests/credential-domain.test.ts`
- [ ] verify Level 11 manually
- [ ] verify trusted-domain add/remove behavior
- [ ] verify non-HTTPS and cross-site action behavior
- [ ] verify paste warning behavior if password-field event handling changed

## Popup And Options Checklist

- [ ] confirm mode selectors persist
- [ ] confirm trusted-domain actions update storage
- [ ] confirm event log renders without exceptions
- [ ] confirm import/export round trip still works
- [ ] confirm allowlist removal and clearing still work

## Release Checklist

- [ ] `npm run verify:versions`
- [ ] `npx tsc -p tsconfig.json --noEmit`
- [ ] `npm run build`
- [ ] `npm run test`
- [ ] `npm run test:e2e`
- [ ] `npm run package:ext`
- [ ] verify the artifact exists in `artifacts/`
- [ ] update release notes and docs if operator workflow changed

## PR Checklist

- [ ] keep commits scoped and readable
- [ ] summarize user-visible behavior changes
- [ ] include test results
- [ ] mention any skipped or env-gated tests
- [ ] call out residual risk honestly
