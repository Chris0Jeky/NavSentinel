# Review before sharing evidence

The Protection Center's **Export visible events** action opens a local preview.
It includes all matching records across journal pages, ordered chronologically.
The preview is a fixed snapshot: **Download reviewed file** saves exactly its
contents, including its original preparation timestamp. Refreshing the journal
cannot silently alter that file. Cancel or Escape discards the preview.

Hostnames and timestamps remain browsing information. Narrow the journal filters
before exporting if the preview includes activity you do not want to disclose.
Internal IDs, URL paths, queries, fragments and arbitrary stored metadata remain
excluded by the allowlisted format. Exports are limited to 5,000 records and
8 MiB. Nothing is uploaded, copied to the clipboard, or sent automatically.

To provide feedback voluntarily, download the reviewed file and attach it yourself
to a support report. An attachment to a public GitHub issue is public. The Lab's
Evidence workspace can import the file and keep separate user assessments; an
assessment is not a verified detector outcome.

This completes the preview-before-save portion of #591. Rich cleanup lifecycle
diagnostics, extension-local user labels and any future direct submission remain
separate work. No new page-data collection or runtime endpoint is introduced.

## Human Chrome check — AI-45

The owner loads or reloads this PR's exact built extension before checking it.
Automated disposable Chromium coverage does not claim this human acceptance.

1. Open Protection Center with retained events; filter the journal and choose
   **Export visible events**. The preview should include all matching events.
2. Tab through Cancel, Download and the read-only contents. Escape should cancel
   without a download and return focus to Export. Repeat using Cancel.
3. Review the hostnames and timestamps, then download. The JSON file should match
   the preview and import through the Lab Evidence workspace.
4. Check Forest, Paper and Midnight at normal and narrow window widths. The dialog
   should stay readable and both actions reachable.

Record the exact Git head, Chrome version and observed result in ACTION_ITEMS.md.
