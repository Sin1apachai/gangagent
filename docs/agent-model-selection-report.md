# Agent model selection

Verified on 2026-10-30. Agent profiles now have an optional model selection. Existing agents retain NULL (provider default); migration 0020 does not assign models or change existing account settings.

## Behavior and boundaries

- Codex options are visible model IDs/display names from the logged-in user's Worker CLI cache. The application reads only model metadata, never returns authentication files, and scopes the catalog to the caller's online Workers. This is a cached catalog, not a live entitlement check.
- Claude exposes the sonnet, opus and haiku family aliases. Aliases may resolve to newer versions over time. The application deliberately excludes Fable/best and extended-credit options from this picker.
- New non-default selections must appear in the caller's Worker catalog and match their provider. Legacy edits that omit model preserve the existing choice; changing provider without selecting a model resets to default.
- Task execution_context freezes the requested selection. Editing an agent later does not change the selection stored for an already-started task. Default/alias choices remain subject to provider-side resolution; this does not promise an immutable model snapshot.
- The Worker passes the frozen value as a separate --model argument while retaining subscription authentication and existing tool restrictions. It records requested_model in usage_metrics; task statistics label it as requested, not independently verified actual model.
- No API-key fallback, paid endpoint integration or automatic application-level replacement is introduced. Account entitlement, plan quota and external extra-usage settings still govern provider behavior. Unsupported selections can fail at the CLI.

The installed CLI help confirms --model support for both providers. Official references: [OpenAI model catalogs and cached catalogs](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [Claude model aliases, startup selection and usage-credit behavior](https://code.claude.com/docs/en/model-config). Claude documents that some Fable requests in non-interactive mode can bill usage credits without prompting; those options are excluded here.

## Verification

- Existing 86 HTTP integration tests passed. Three additional model tests passed against the final image: private catalogs/provider validation, default and legacy edits/provider switching, and frozen task selection with requested-model metrics.
- 32 Rust tests passed, including provider model validation and command argument checks retaining forced ChatGPT login. All 13 frontend domain/rendering tests passed.
- Actual browser created a Codex agent with a chosen model, reopened the saved choice, changed provider to Claude (resetting the old model), selected Sonnet and saved successfully.
- Production was backed up before migration. Fingerprints of 29 domain tables matched after excluding the new nullable column. Existing agents retained provider default. App, Worker and backup binaries match, and production catalog metadata is available.
- Tests used fixture inference and command construction validation. No live provider inference was requested; access to every listed model on the actual subscription has not been tested. Catalog listing and saving a profile do not consume an inference request.

Evidence: [agent-model-selection-proof.json](measurements/agent-model-selection-proof.json).
